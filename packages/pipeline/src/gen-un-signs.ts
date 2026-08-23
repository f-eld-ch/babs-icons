#!/usr/bin/env node
// Generates the un-signs sprite sheet: one entry per ADR Kemler (Gefahrennummer) code.
//
// Each sprite entry is named "{kemler}" (e.g. "80", "X338").
// The icon shows the Kemler number baked into the upper box; the lower box is kept
// empty so MapLibre can fill it via icon-text-fit for the UN number (Stoffnummer).
//
// Output: packages/sprites/dist/un-signs{,@2x,@3x}.{png,json}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { KEMLER_CODES } from "../../core/src/kemler-codes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const TEMPLATE_SVG = join(ROOT, "sources/de/2.Gefahren/09b-Gefahrentafel mit UN-Nummer.svg");
const SPRITES_DIST = join(ROOT, "packages/sprites/dist");

// ── Cell geometry (matches sprites.ts) ───────────────────────────────────────
const CELL_1X = 48;
const PAD_1X = 3;
const GRID_1X = CELL_1X + PAD_1X * 2;
const CELL_2X = CELL_1X * 2;
const PAD_2X = PAD_1X * 2;
const GRID_2X = CELL_2X + PAD_2X * 2;
const CELL_3X = CELL_1X * 3;
const PAD_3X = PAD_1X * 3;
const GRID_3X = CELL_3X + PAD_3X * 2;
const COLS = 10;

// ── Text-fit constants for the lower box (Stoffnummer / UN number) ────────────
// Values are SVG viewBox percentages (0-100) converted to pixels at each resolution.
// Geometry derived from the border path in the template SVG:
//   frame: x [6,93], y [23,78]; divider at y≈50 → lower box y [50,78].
const LOWER_BOX_PCT = {
  content: [8, 52, 92, 76] as [number, number, number, number],
  stretchX: [[8, 92]] as [number, number][],
  stretchY: [[52, 76]] as [number, number][],
};
function pct2px(v: number, cell: number): number {
  return Math.round((v / 100) * cell);
}
function lowerBoxFit(cell: number) {
  const s = (v: number) => pct2px(v, cell);
  return {
    content: LOWER_BOX_PCT.content.map(s) as [number, number, number, number],
    stretchX: LOWER_BOX_PCT.stretchX.map(([a, b]) => [s(a), s(b)] as [number, number]),
    stretchY: LOWER_BOX_PCT.stretchY.map(([a, b]) => [s(a), s(b)] as [number, number]),
  };
}

// ── SVG template substitution ─────────────────────────────────────────────────
function buildSvg(templateSvg: string, kemler: string): string {
  // Replace Gefahrennummer (tspan3, currently "80") with the Kemler code.
  let svg = templateSvg.replace(/(<tspan\b[^>]*\bid="tspan3"[^>]*>)[^<]*/, `$1${kemler}`);
  // Empty the Stoffnummer (tspan3-5, currently "1789") — MapLibre fills it via text-fit.
  svg = svg.replace(/(<tspan\b[^>]*\bid="tspan3-5"[^>]*>)[^<]*/, `$1`);
  return svg;
}

// ── Rasterize SVG to RGBA buffer ──────────────────────────────────────────────
async function rasterize(svgContent: string, cell: number): Promise<Buffer> {
  const fitSize = cell * 4; // 4× supersampling
  const r = new Resvg(svgContent, {
    fitTo: { mode: "width", value: fitSize },
    font: {
      // FreeSans Bold is the font used in the template SVG.
      // Liberation Sans Bold is loaded as a metric-compatible fallback for CI environments.
      loadSystemFonts: true,
      defaultFontFamily: "FreeSans",
    },
  });
  const rgba = r.render();
  return sharp(Buffer.from(rgba.pixels), {
    raw: { width: rgba.width, height: rgba.height, channels: 4 },
  })
    .resize(cell, cell, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer();
}

// ── Blit RGBA cell buffer into sheet ─────────────────────────────────────────
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

// ── Write one resolution ──────────────────────────────────────────────────────
async function writeResolution(
  keys: string[],
  svgs: Map<string, string>,
  cell: number,
  pad: number,
  grid: number,
  pixelRatio: number,
  suffix: string,
): Promise<void> {
  const rows = Math.ceil(keys.length / COLS);
  const sheetW = COLS * grid;
  const sheetH = rows * grid;
  const sheet = Buffer.alloc(sheetW * sheetH * 4, 0);

  const fit = lowerBoxFit(cell);
  const json: Record<string, object> = {};

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const svg = svgs.get(key)!;

    const cellBuf = await rasterize(svg, cell);
    blit(sheet, cellBuf, col, row, grid, cell, pad, sheetW);

    json[key] = {
      width: cell,
      height: cell,
      x: col * grid + pad,
      y: row * grid + pad,
      pixelRatio,
      content: fit.content,
      stretchX: fit.stretchX,
      stretchY: fit.stretchY,
    };
  }

  // Encode sheet RGBA → PNG
  const png = await sharp(sheet, {
    raw: { width: sheetW, height: sheetH, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const base = join(SPRITES_DIST, `un-signs${suffix}`);
  writeFileSync(`${base}.png`, png);
  writeFileSync(`${base}.json`, JSON.stringify(json, null, 2));
  console.log(`  ${base}.png  (${sheetW}×${sheetH})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const templateSvg = readFileSync(TEMPLATE_SVG, "utf8");

const keys: string[] = KEMLER_CODES.map((k) => `${k}`);
const svgs = new Map<string, string>(
  KEMLER_CODES.map((k) => [`${k}`, buildSvg(templateSvg, k)]),
);

mkdirSync(SPRITES_DIST, { recursive: true });

console.log(`Generating un-signs sprite — ${keys.length} Kemler codes`);

await writeResolution(keys, svgs, CELL_1X, PAD_1X, GRID_1X, 1, "");
await writeResolution(keys, svgs, CELL_2X, PAD_2X, GRID_2X, 2, "@2x");
await writeResolution(keys, svgs, CELL_3X, PAD_3X, GRID_3X, 3, "@3x");

console.log("Done.");
