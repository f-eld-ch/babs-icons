#!/usr/bin/env node
// Vectorise raster (embedded-PNG) icons in sources/ using potrace.
// Replaces each <image href="data:image/png;base64,..."/> with traced <path> elements.
//
// Usage:
//   node packages/pipeline/src/trace.ts [--ids 1101,8202] [--dry-run] [--force]
//
// --ids <list>  Comma-separated icon IDs to process (default: all raster icons)
// --dry-run     Show what would happen without writing files
// --force       Write even icons that exceed the complexity threshold

import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { indexAll } from "./source-index.ts";
import { LANGS, type Lang } from "./naming.ts";

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const SOURCES = join(ROOT, "sources");

// ── Complexity thresholds ─────────────────────────────────────────────────────
// Icons above either limit are flagged as "complex" and skipped unless --force.
// Thresholds are aggregated across all color layers in the multi-color output.
const MAX_PATHS    = 150;     // total <path> elements across all color layers
const MAX_CMDS     = 2_000;   // total path commands (M L C Q A Z …)
const MAX_D_BYTES  = 50_000;  // total byte length of all d="…" values

// ── Color tracing constants ───────────────────────────────────────────────────
const QUANT_STEP = 64;  // channel quantization step for palette discovery
const MAX_COLORS = 12;  // reject images with more distinct colors than this

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log([
    "Usage: node packages/pipeline/src/trace.ts [options]",
    "",
    "Options:",
    "  --ids <id1,id2,...>  Only trace icons with these IDs (default: all raster icons)",
    "  --dry-run            Preview without writing any files",
    "  --force              Write even complex icons (exceed complexity threshold)",
    "",
    "Exit codes:  0 = all processed icons converted; 1 = any failure or complex icon",
  ].join("\n"));
  process.exit(0);
}

const DRY_RUN = args.includes("--dry-run");
const FORCE   = args.includes("--force");

function getArg(flag: string): string | undefined {
  const eq = args.find(a => a.startsWith(`${flag}=`))?.slice(flag.length + 1);
  if (eq !== undefined) return eq;
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const idsRaw  = getArg("--ids");
const ID_FILTER: Set<string> | null = idsRaw
  ? new Set(idsRaw.split(",").map(s => s.trim()).filter(Boolean))
  : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Walk forward from `from` in `s`, tracking quote state, until a `/>` sequence
 * that is not inside an attribute value. Returns the position AFTER `/>`.
 * Returns -1 if no such sequence is found.
 */
function selfClosingEnd(s: string, from: number): number {
  let inQ = false;
  let qc  = '"';
  for (let i = from; i < s.length - 1; i++) {
    const c = s[i]!;
    if (inQ) {
      if (c === qc) inQ = false;
    } else if (c === '"' || c === "'") {
      inQ = true; qc = c;
    } else if (c === '/' && s[i + 1] === '>') {
      return i + 2;
    }
  }
  return -1;
}

/**
 * Locate the embedded-PNG base64 payload in an SVG string.
 * Returns the payload and the byte offsets of the entire <image .../> element,
 * or undefined when the SVG has no embedded PNG.
 *
 * Handles both:
 *   href="data:image/png;base64,..."   (valid MIME)
 *   xlink:href="data:img/png;base64,..." (invalid MIME but present in upstream data)
 */
function findEmbeddedPng(
  svg: string,
): { b64: string; imgStart: number; imgEnd: number } | undefined {
  const imgStart = svg.indexOf('<image');
  if (imgStart === -1) return undefined;

  // Match the href attribute, supporting both xlink: prefix and both MIME spellings.
  // We slice from imgStart to avoid matching an <image> in a different context.
  const local = svg.slice(imgStart, imgStart + 200_000); // cap the search window
  const hrefRe = /(?:xlink:)?href="data:im(?:age|g)\/png;base64,/;
  const hm = local.match(hrefRe);
  if (!hm || hm.index === undefined) return undefined;

  const b64Start = imgStart + hm.index + hm[0].length;
  // base64 data cannot contain `"`, so the closing `"` is unambiguous
  const b64End = svg.indexOf('"', b64Start);
  if (b64End === -1) return undefined;
  const b64 = svg.slice(b64Start, b64End);

  const imgEnd = selfClosingEnd(svg, imgStart);
  if (imgEnd === -1) return undefined;

  return { b64, imgStart, imgEnd };
}

// ── Color types ───────────────────────────────────────────────────────────────

interface RgbColor { r: number; g: number; b: number }

function toHex(c: RgbColor): string {
  const h = (v: number): string => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function colorDistSq(a: RgbColor, b: RgbColor): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function luminance(c: RgbColor): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

// ── PNG decoding ──────────────────────────────────────────────────────────────

interface DecodedPng { pixels: Buffer; width: number; height: number }

/** Decode a PNG to raw 3-channel RGB pixels with alpha flattened onto white. */
async function decodePng(pngBuf: Buffer): Promise<DecodedPng> {
  const { data, info } = await sharp(pngBuf)
    .flatten({ background: "#ffffff" })
    .toColorspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height };
}

// ── Palette discovery ─────────────────────────────────────────────────────────

/**
 * Find the primary color palette by quantizing pixels into QUANT_STEP-sized buckets
 * and keeping only colors that appear in at least 0.5% of pixels.
 * Returns colors sorted lightest-first (background → fills → outlines).
 */
function findPalette(decoded: DecodedPng): RgbColor[] {
  const { pixels, width, height } = decoded;
  const totalPx = width * height;
  const minPx = Math.max(200, Math.floor(totalPx * 0.005));
  const counts = new Map<string, { color: RgbColor; count: number }>();

  for (let i = 0; i < pixels.length; i += 3) {
    const r = Math.min(255, Math.round(pixels[i]! / QUANT_STEP) * QUANT_STEP);
    const g = Math.min(255, Math.round(pixels[i + 1]! / QUANT_STEP) * QUANT_STEP);
    const b = Math.min(255, Math.round(pixels[i + 2]! / QUANT_STEP) * QUANT_STEP);
    const key = `${r}:${g}:${b}`;
    const e = counts.get(key);
    if (e) e.count++;
    else counts.set(key, { color: { r, g, b }, count: 1 });
  }

  return [...counts.values()]
    .filter(e => e.count >= minPx)
    .map(e => e.color)
    // Lightest first → darkest last: white background renders first, black outlines on top.
    .sort((a, b) => luminance(b.color) - luminance(a.color));
}

// ── Per-color masking ─────────────────────────────────────────────────────────

/**
 * Build a binary PPM mask for one palette color.
 * Each pixel is assigned to its nearest palette color (L2 distance in RGB).
 * Pixels assigned to targetColor become black; all others become white.
 */
function makeColorMaskPpm(decoded: DecodedPng, targetColor: RgbColor, palette: RgbColor[]): Buffer {
  const { pixels, width, height } = decoded;
  const n = width * height;
  const maskRgb = Buffer.alloc(n * 3, 255); // white

  for (let i = 0; i < n; i++) {
    const pr = pixels[i * 3]!;
    const pg = pixels[i * 3 + 1]!;
    const pb = pixels[i * 3 + 2]!;
    const pixel: RgbColor = { r: pr, g: pg, b: pb };

    let bestDist = Infinity;
    let bestColor = palette[0]!;
    for (const c of palette) {
      const d = colorDistSq(pixel, c);
      if (d < bestDist) { bestDist = d; bestColor = c; }
    }

    if (bestColor.r === targetColor.r && bestColor.g === targetColor.g && bestColor.b === targetColor.b) {
      maskRgb[i * 3] = 0;
      maskRgb[i * 3 + 1] = 0;
      maskRgb[i * 3 + 2] = 0;
    }
  }

  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  return Buffer.concat([header, maskRgb]);
}

// ── Potrace helpers ───────────────────────────────────────────────────────────

/** Run potrace on a PPM file; return the full SVG string or null on failure. */
function runPotrace(ppmPath: string): string | null {
  const r = spawnSync(
    "potrace",
    [
      "--svg",
      "--turdsize", "20",
      "--alphamax", "1.0",
      "--opttolerance", "0.5",
      "-o", "-",
      ppmPath,
    ],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  return r.stdout;
}

/** Extract individual <path .../> elements from potrace SVG output. */
function extractPaths(potraceSvg: string): string[] {
  const paths: string[] = [];
  const re = /<path [^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(potraceSvg)) !== null) paths.push(m[0]);
  return paths;
}

/** Count path commands in concatenated d="…" strings. */
function countCmds(pathDatas: string): number {
  return (pathDatas.match(/[MmLlHhVvCcSsQqTtAaZz]/g) ?? []).length;
}

// ── Multi-color assembly ──────────────────────────────────────────────────────

interface ColorLayer { color: RgbColor; paths: string[] }

interface TraceResult {
  colorLayers: ColorLayer[];
  transform: string;
  width: number;
  height: number;
}

/**
 * Trace a decoded PNG using per-color masking. Each color in the palette gets its
 * own potrace pass producing paths with the correct fill; layers are ordered
 * lightest-first so black outlines appear on top of colored fills.
 *
 * Returns "too-many-colors" if the palette exceeds MAX_COLORS (photographic image).
 */
async function traceMultiColor(decoded: DecodedPng, tmpPpm: string): Promise<TraceResult | null | "too-many-colors"> {
  const palette = findPalette(decoded);
  if (palette.length === 0) return null;
  if (palette.length > MAX_COLORS) return "too-many-colors";

  const transform = `translate(0,${decoded.height}) scale(0.1,-0.1)`;
  const colorLayers: ColorLayer[] = [];

  for (const color of palette) {
    const maskPpm = makeColorMaskPpm(decoded, color, palette);
    writeFileSync(tmpPpm, maskPpm);
    const potraceSvg = runPotrace(tmpPpm);
    if (!potraceSvg) continue;
    const paths = extractPaths(potraceSvg);
    if (paths.length > 0) colorLayers.push({ color, paths });
  }

  if (colorLayers.length === 0) return null;
  return { colorLayers, transform, width: decoded.width, height: decoded.height };
}

/** Assemble traced color layers into a single SVG group element. */
function assembleColorGroup(result: TraceResult): string {
  const inner = result.colorLayers
    .map(l => `<g fill="${toHex(l.color)}" stroke="none">\n${l.paths.join("\n")}\n</g>`)
    .join("\n");
  return `<g transform="${result.transform}">\n${inner}\n</g>`;
}

// ── Build the list of files to process ───────────────────────────────────────
const indices = indexAll({ srcRoot: SOURCES });

interface FileEntry { id: string; lang: Lang; path: string }
const toProcess: FileEntry[] = [];
const seenPaths = new Set<string>();

for (const lang of LANGS) {
  const langMap = indices[lang];
  for (const [id, entry] of langMap) {
    if (ID_FILTER && !ID_FILTER.has(id)) continue;
    if (seenPaths.has(entry.path)) continue; // same file served for multiple IDs (shouldn't happen, but guard)
    seenPaths.add(entry.path);
    toProcess.push({ id, lang, path: entry.path });
  }
}

// Deterministic order: id, then lang
toProcess.sort((a, b) => {
  const byCat = a.id.localeCompare(b.id);
  return byCat !== 0 ? byCat : a.lang.localeCompare(b.lang);
});

// ── Main loop ─────────────────────────────────────────────────────────────────
let nConverted = 0;
let nComplex   = 0;
let nFailed    = 0;
let nNoRaster  = 0;

const complexList: string[] = [];

console.log(`trace: scanning ${toProcess.length} source files${DRY_RUN ? " (dry-run)" : ""}...`);
console.log();

const tmpDir = mkdtempSync(join(tmpdir(), "babs-trace-"));
const tmpPpm = join(tmpDir, "icon.ppm");

try {
  for (const { id, lang, path: filePath } of toProcess) {
    // Relative path for display (strip the root prefix)
    const rel = filePath.slice(ROOT.length).replace(/^\/+/, "");

    const svgContent = readFileSync(filePath, "utf8");
    const found = findEmbeddedPng(svgContent);

    if (!found) {
      nNoRaster++;
      continue; // vector icon — silently skip
    }

    const { b64, imgStart, imgEnd } = found;
    const pngBuf = Buffer.from(b64, "base64");

    // Decode PNG to raw pixels
    let decoded: DecodedPng;
    try {
      decoded = await decodePng(pngBuf);
    } catch (e) {
      console.log(`✗ FAILED    [${id}/${lang}] ${rel}`);
      console.log(`             sharp error: ${(e as Error).message}`);
      nFailed++;
      continue;
    }

    // Multi-color trace: one potrace pass per palette color
    const traceResult = await traceMultiColor(decoded, tmpPpm);

    if (traceResult === "too-many-colors") {
      console.log(`⚠ COMPLEX   [${id}/${lang}] ${rel}`);
      console.log(`             too many distinct colors (>${MAX_COLORS}) — skipped (photographic image?)`);
      complexList.push(`[${id}/${lang}]: too many colors`);
      nComplex++;
      continue;
    }

    if (traceResult === null) {
      console.log(`✗ FAILED    [${id}/${lang}] ${rel}`);
      console.log(`             potrace produced no paths`);
      nFailed++;
      continue;
    }

    // Complexity metrics (aggregated across all color layers)
    const allPaths = traceResult.colorLayers.flatMap(l => l.paths);
    const allD     = allPaths.join("");
    const pathCnt  = allPaths.length;
    const cmdCnt   = countCmds(allD);
    const dBytes   = allD.length;
    const isComplex = !FORCE && (pathCnt > MAX_PATHS || cmdCnt > MAX_CMDS || dBytes > MAX_D_BYTES);

    if (isComplex) {
      console.log(`⚠ COMPLEX   [${id}/${lang}] ${rel}`);
      console.log(`             ${pathCnt} paths · ${cmdCnt} cmds · ${dBytes} d-chars — skipped (use --force to write)`);
      complexList.push(`[${id}/${lang}]: ${pathCnt} paths, ${cmdCnt} cmds, ${dBytes} d-chars`);
      nComplex++;
      continue;
    }

    const potraceGroup = assembleColorGroup(traceResult);

    // Build new SVG: replace <image .../> with the multi-color potrace <g>...</g>
    const newSvg = svgContent.slice(0, imgStart) + potraceGroup + svgContent.slice(imgEnd);

    const colorSummary = traceResult.colorLayers.map(l => toHex(l.color)).join("+");
    console.log(`✓ CONVERTED  [${id}/${lang}] ${rel}`);
    console.log(`             ${pathCnt} paths · ${cmdCnt} cmds · ${decoded.width}×${decoded.height} px · colors: ${colorSummary}`);

    if (!DRY_RUN) {
      writeFileSync(filePath, newSvg, "utf8");
    }
    nConverted++;
  }
} finally {
  // Clean up temp files
  try { unlinkSync(tmpPpm); } catch {}
  try { rmdirSync(tmpDir); } catch {}
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log();
console.log("─".repeat(64));
console.log("trace summary:");
console.log(`  ✓ converted:  ${nConverted}${DRY_RUN ? "  (dry-run — not written)" : ""}`);
if (nNoRaster > 0) console.log(`  - skipped:    ${nNoRaster}  (vector icons, no embedded PNG)`);
if (nComplex  > 0) {
  console.log(`  ⚠ complex:   ${nComplex}  (needs manual review or re-run with --force)`);
  for (const s of complexList) console.log(`      ${s}`);
}
if (nFailed   > 0) console.log(`  ✗ failed:     ${nFailed}`);

if (nFailed > 0 || nComplex > 0) process.exitCode = 1;
