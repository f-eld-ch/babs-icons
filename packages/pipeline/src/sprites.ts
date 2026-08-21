#!/usr/bin/env node
// Generates sprite sheets for babs-de, babs-fr, babs-it
// Reads packages/svg/svg/ + index.json, writes packages/sprites/dist/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { compareNumeric } from "./naming.ts";
import { loadMarkers, markerSvg, type Marker } from "./markers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const SVG_INDEX = join(ROOT, "packages/svg/index.json");
const SVG_DIR = join(ROOT, "packages/svg/svg");
const SPRITES_DIST = join(ROOT, "packages/sprites/dist");
const LAYOUT_LOCK = join(ROOT, "packages/sprites/layout.lock.json");
const PIXEL_HASH = join(ROOT, "packages/sprites/pixels.sha256.json");

const CELL_1X = 32;
const PAD_1X = 2;
const GRID_1X = CELL_1X + PAD_1X * 2; // 36
const CELL_2X = 64;
const PAD_2X = 4;
const GRID_2X = CELL_2X + PAD_2X * 2; // 72

const LANGS = ["de", "fr", "it"] as const;
type Lang = (typeof LANGS)[number];

// ── Parse arguments ──────────────────────────────────────────────────────────
const CHECK = process.argv.includes("--check");

// ── Load index ───────────────────────────────────────────────────────────────
interface SymFiles {
  lang: string;
  svg: string;
}
interface PatternVariantEntry {
  identical: boolean;
  files: Partial<Record<Lang, SymFiles>>;
}
interface SymEntry {
  id: string;
  identical: boolean;
  files: Partial<Record<Lang, SymFiles>>;
  patterns?: Partial<Record<"a", PatternVariantEntry>>;
}
interface IndexJson {
  categories: Array<{
    number: string;
    symbols?: SymEntry[];
    subcategories?: Array<{ number: string; symbols: SymEntry[] }>;
  }>;
}

const index = JSON.parse(readFileSync(SVG_INDEX, "utf8")) as IndexJson;
const allSymbols: SymEntry[] = [];
for (const cat of index.categories) {
  for (const sym of cat.symbols ?? []) allSymbols.push(sym);
  for (const sub of cat.subcategories ?? []) for (const sym of sub.symbols) allSymbols.push(sym);
}

const allSymbolIds = allSymbols.map((s) => s.id);

// Pattern keys: "<id>-pattern", sorted and appended after symbol IDs.
const allPatternKeys: string[] = [];
for (const sym of allSymbols) {
  if (sym.patterns?.a) allPatternKeys.push(`${sym.id}-pattern`);
}
allPatternKeys.sort(compareNumeric);

// Markers — sprite-only, language-neutral, must never reach packages/react or packages/svg
const markers = loadMarkers();
const allMarkerKeys = markers.map((m) => m.key);
const markerByKey = new Map<string, Marker>(markers.map((m) => [m.key, m]));

const allKeys = [...allSymbolIds, ...allPatternKeys, ...allMarkerKeys];

// ── Layout lock ───────────────────────────────────────────────────────────────
interface LayoutLock {
  version: number;
  cell: number;
  cols: number;
  keys: string[];
}

let layoutLock: LayoutLock;
if (existsSync(LAYOUT_LOCK)) {
  layoutLock = JSON.parse(readFileSync(LAYOUT_LOCK, "utf8")) as LayoutLock;
  // Append any new keys (symbols or patterns) not yet in the lock
  const locked = new Set(layoutLock.keys);
  for (const key of allKeys) {
    if (!locked.has(key)) layoutLock.keys.push(key);
  }
} else {
  const n = allKeys.length;
  const cols = Math.ceil(Math.sqrt(n));
  layoutLock = { version: 1, cell: GRID_1X, cols, keys: [...allKeys] };
}

const { cols, keys } = layoutLock;
const rows = Math.ceil(keys.length / cols);
const sheetW1X = cols * GRID_1X;
const sheetH1X = rows * GRID_1X;
const sheetW2X = cols * GRID_2X;
const sheetH2X = rows * GRID_2X;

// ── Rasterize one SVG ─────────────────────────────────────────────────────────
async function rasterize(svgContent: string, cell: number, _pad: number): Promise<Buffer> {
  const fitSize = cell * 4; // 4× supersampling
  let fixedSvg = svgContent
    .replace(/xlink:href="data:img\/png;/g, 'href="data:image/png;')
    .replace(/xlink:href="data:image\/png;/g, 'href="data:image/png;');
  try {
    const r = new Resvg(fixedSvg, { fitTo: { mode: "width", value: fitSize } });
    const rgba = r.render();
    // Downscale to cell×cell
    const buf = await sharp(Buffer.from(rgba.pixels), {
      raw: { width: rgba.width, height: rgba.height, channels: 4 },
    })
      .resize(cell, cell, { kernel: "lanczos3", fit: "fill" })
      .raw()
      .toBuffer();
    return buf;
  } catch {
    // Return transparent cell on failure
    return Buffer.alloc(cell * cell * 4, 0);
  }
}

// ── Blit RGBA buffer into sheet ───────────────────────────────────────────────
function blit(
  sheet: Buffer,
  cellBuf: Buffer,
  col: number,
  row: number,
  gridSize: number,
  cell: number,
  pad: number,
  sheetW: number,
): void {
  const x0 = col * gridSize + pad;
  const y0 = row * gridSize + pad;
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const srcOff = (y * cell + x) * 4;
      const dstOff = ((y0 + y) * sheetW + (x0 + x)) * 4;
      sheet[dstOff] = cellBuf[srcOff] ?? 0;
      sheet[dstOff + 1] = cellBuf[srcOff + 1] ?? 0;
      sheet[dstOff + 2] = cellBuf[srcOff + 2] ?? 0;
      sheet[dstOff + 3] = cellBuf[srcOff + 3] ?? 0;
    }
  }
}

// ── Get SVG file for icon + lang ─────────────────────────────────────────────
function getSvgPath(sym: SymEntry, lang: Lang): string {
  const rel =
    sym.files[lang]?.svg ?? sym.files.de?.svg ?? sym.files.fr?.svg ?? sym.files.it?.svg ?? "";
  return join(SVG_DIR, rel.replace(/^svg\//, ""));
}

function getPatternSvgPath(sym: SymEntry, variant: "a", lang: Lang): string {
  const pv = sym.patterns?.[variant];
  if (!pv) return "";
  const rel = pv.files[lang]?.svg ?? pv.files.de?.svg ?? pv.files.fr?.svg ?? pv.files.it?.svg ?? "";
  return join(SVG_DIR, rel.replace(/^svg\//, ""));
}

const PATTERN_KEY_RE = /^(.+)-pattern$/;

// ── Generate one sprite sheet ─────────────────────────────────────────────────
async function genSheet(lang: Lang): Promise<{
  spriteJson: Record<string, unknown>;
  pixelHashes: Record<string, string>;
  ok: boolean;
}> {
  const sheet1X = Buffer.alloc(sheetW1X * sheetH1X * 4, 0);
  const sheet2X = Buffer.alloc(sheetW2X * sheetH2X * 4, 0);
  const spriteJson: Record<string, unknown> = {};
  const pixelHashes: Record<string, string> = {};

  const symMap = new Map(allSymbols.map((s) => [s.id, s]));

  for (let idx = 0; idx < keys.length; idx++) {
    const key = keys[idx]!;

    // Markers are checked FIRST: an exact manifest lookup cannot false-positive,
    // whereas PATTERN_KEY_RE is greedy and would claim a future "marker-…-pattern" key.
    let svgContent: string;
    let seamless: boolean;

    const marker = markerByKey.get(key);
    if (marker) {
      // Language-neutral: use the pre-cached (possibly recoloured) SVG for all sheets.
      svgContent = markerSvgCache.get(key)!;
      seamless = marker.mode === "pattern";
    } else {
      // Detect pattern key vs symbol key
      const pm = key.match(PATTERN_KEY_RE);
      const symId = pm ? pm[1]! : key;
      const patVariant: "a" | null = pm ? "a" : null;

      const sym = symMap.get(symId);
      if (!sym) continue; // removed icon — leave transparent hole

      const svgPath = patVariant ? getPatternSvgPath(sym, patVariant, lang) : getSvgPath(sym, lang);

      if (!svgPath || !existsSync(svgPath)) {
        console.warn(`  MISSING svg: ${svgPath || key}`);
        continue;
      }
      svgContent = readFileSync(svgPath, "utf8");
      seamless = patVariant !== null;
    }

    // Patterns and pattern-mode markers tile seam-free (pad=0, full grid cell).
    const cellW1 = seamless ? GRID_1X : CELL_1X;
    const pad1 = seamless ? 0 : PAD_1X;
    const cellW2 = seamless ? GRID_2X : CELL_2X;
    const pad2 = seamless ? 0 : PAD_2X;

    const col = idx % cols;
    const row = Math.floor(idx / cols);

    const [buf1X, buf2X] = await Promise.all([
      rasterize(svgContent, cellW1, pad1),
      rasterize(svgContent, cellW2, pad2),
    ]);

    blit(sheet1X, buf1X, col, row, GRID_1X, cellW1, pad1, sheetW1X);
    blit(sheet2X, buf2X, col, row, GRID_2X, cellW2, pad2, sheetW2X);

    const hash = createHash("sha256").update(buf1X).digest("hex");
    pixelHashes[key] = hash;

    spriteJson[key] = {
      width: cellW1,
      height: cellW1,
      x: col * GRID_1X + pad1,
      y: row * GRID_1X + pad1,
      pixelRatio: 1,
    };
  }

  // Encode PNGs
  const [png1X, png2X] = await Promise.all([
    sharp(sheet1X, { raw: { width: sheetW1X, height: sheetH1X, channels: 4 } })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer(),
    sharp(sheet2X, { raw: { width: sheetW2X, height: sheetH2X, channels: 4 } })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer(),
  ]);

  const name = `babs-${lang}`;
  // @1x JSON: keys already populated above
  const json1X = JSON.stringify(sortKeys(spriteJson), null, 2) + "\n";
  // @2x JSON: same keys, doubled dimensions (derived from 1x to handle per-entry sizes)
  const json2X =
    JSON.stringify(
      sortKeys(
        Object.fromEntries(
          Object.entries(spriteJson).map(([k, v]) => {
            const v1 = v as { width: number; height: number; x: number; y: number };
            return [
              k,
              {
                width: v1.width * 2,
                height: v1.height * 2,
                x: v1.x * 2,
                y: v1.y * 2,
                pixelRatio: 2,
              },
            ];
          }),
        ),
      ),
      null,
      2,
    ) + "\n";

  if (CHECK) {
    let ok = true;
    for (const [fn, data] of [
      [`${name}.json`, json1X],
      [`${name}@2x.json`, json2X],
      [`${name}.png`, png1X],
      [`${name}@2x.png`, png2X],
    ] as Array<[string, string | Buffer]>) {
      const p = join(SPRITES_DIST, fn);
      if (!existsSync(p)) {
        console.error(`MISSING: ${fn}`);
        ok = false;
        continue;
      }
      const existing = readFileSync(p);
      if (Buffer.compare(Buffer.from(data), existing) !== 0) {
        console.error(`DRIFT:   ${fn}`);
        ok = false;
      }
    }
    return { spriteJson, pixelHashes, ok };
  } else {
    writeFileSync(join(SPRITES_DIST, `${name}.json`), json1X);
    writeFileSync(join(SPRITES_DIST, `${name}@2x.json`), json2X);
    writeFileSync(join(SPRITES_DIST, `${name}.png`), png1X);
    writeFileSync(join(SPRITES_DIST, `${name}@2x.png`), png2X);
    return { spriteJson, pixelHashes, ok: true };
  }
}

function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ) as Record<string, T>;
}

// ── Main ──────────────────────────────────────────────────────────────────────
mkdirSync(SPRITES_DIST, { recursive: true });

console.log(
  `sprites: generating ${allSymbolIds.length} icons + ${allPatternKeys.length} patterns + ${allMarkerKeys.length} markers, ${cols}×${rows} grid (${sheetW1X}×${sheetH1X} @1x)`,
);

// Pre-read and recolour all marker SVGs once, outside the per-language loop.
// This guarantees all three sheets are pixel-identical for markers, and throws
// on a stale recolour rule before any rasterising begins.
const markerSvgCache = new Map<string, string>(markers.map((m) => [m.key, markerSvg(m)]));

const pixelHashesByLang: Partial<Record<Lang, Record<string, string>>> = {};
let overallOk = true;

for (const lang of LANGS) {
  process.stdout.write(`  babs-${lang}...`);
  const { pixelHashes, ok: sheetOk } = await genSheet(lang);
  if (!sheetOk) overallOk = false;
  pixelHashesByLang[lang] = pixelHashes;
  process.stdout.write(" done\n");
}

if (!CHECK) {
  // Write layout.lock.json
  const lockOut =
    JSON.stringify(
      {
        version: layoutLock.version,
        cell: layoutLock.cell,
        cols: layoutLock.cols,
        keys: layoutLock.keys,
      },
      null,
      2,
    ) + "\n";
  writeFileSync(LAYOUT_LOCK, lockOut);

  // Write pixels.sha256.json
  const pixOut: Record<string, Record<string, string>> = {};
  for (const lang of LANGS) {
    pixOut[lang] = pixelHashesByLang[lang] ?? {};
  }
  writeFileSync(
    PIXEL_HASH,
    JSON.stringify({ algorithm: "sha256", cell: CELL_1X, langs: pixOut }, null, 2) + "\n",
  );

  console.log(`sprites: done — layout.lock.json + pixels.sha256.json written`);
} else if (overallOk) {
  console.log("sprites: OK (no drift)");
} else {
  process.exitCode = 1;
}
