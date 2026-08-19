#!/usr/bin/env node --experimental-strip-types
/**
 * Normalize SVG symbol files to a uniform square canvas with transparent background.
 *
 * Usage:
 *   node --experimental-strip-types normalize-svgs.ts [options]
 *
 * Options:
 *   --size <n>      Target viewBox size in units (default: 100)
 *   --padding <n>   Padding as a fraction 0–0.5 (default: 0.05)
 *   --inplace       Overwrite originals instead of writing to normalized/
 *   --dir <path>    Root directory to scan (default: ./babs)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { optimize, type Config, type CustomPlugin, type XastElement } from "svgo";
import { PATTERN_RE } from "./naming.ts";

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag: string, def: string) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? (args[idx + 1] ?? def) : def;
};

const TARGET_SIZE = parseFloat(getArg("--size", "100"));
const PADDING_RATIO = parseFloat(getArg("--padding", "0.05"));
const INPLACE = args.includes("--inplace");
const ROOT_DIR = getArg("--dir", "sources");
const OUT_DIR = "./normalized";

// ── Inkscape: crop to actual drawing bounds ───────────────────────────────────

/**
 * Run Inkscape with --export-area-drawing to crop the SVG to the bounding box
 * of its actual drawn content, discarding artboard whitespace.
 * Returns the cropped SVG string, or null on failure.
 */
function cropToDrawing(svgPath: string): string | null {
  const result = spawnSync(
    "inkscape",
    ["--export-area-drawing", "--export-plain-svg", "--export-filename=-", svgPath],
    { encoding: "utf-8", timeout: 15_000 }
  );
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  return result.stdout;
}

// ── SVGO: center content in a square canvas ───────────────────────────────────

/**
 * Custom SVGO plugin: reads the viewBox (which after Inkscape cropping represents
 * the exact drawn content bounds), computes a uniform-scale + centering transform,
 * wraps all drawable children in a <g>, and sets a square viewBox.
 */
function makeCenterPlugin(targetSize: number, paddingRatio: number): CustomPlugin {
  return {
    name: "centerAndNormalize",
    fn: () => ({
      element: {
        enter(node, parentNode) {
          if (node.name !== "svg" || parentNode.type !== "root") return;

          const vbStr = node.attributes["viewBox"] ?? "";
          const parts = vbStr.trim().split(/[\s,]+/).map(Number);

          let vbX = 0, vbY = 0, vbW = 0, vbH = 0;
          if (parts.length === 4 && parts.every(isFinite)) {
            [vbX, vbY, vbW, vbH] = parts as [number, number, number, number];
          } else {
            vbW = parseFloat(node.attributes["width"] ?? String(targetSize));
            vbH = parseFloat(node.attributes["height"] ?? String(targetSize));
          }

          if (!isFinite(vbW) || !isFinite(vbH) || vbW <= 0 || vbH <= 0) return;

          const contentSize = targetSize * (1 - 2 * paddingRatio);
          const padding = targetSize * paddingRatio;
          const scale = contentSize / Math.max(vbW, vbH);
          const tx = padding + (contentSize - vbW * scale) / 2 - vbX * scale;
          const ty = padding + (contentSize - vbH * scale) / 2 - vbY * scale;

          const defs = node.children.filter(
            (c) => c.type === "element" && (c as XastElement).name === "defs"
          );
          const drawables = node.children.filter(
            (c) => !(c.type === "element" && (c as XastElement).name === "defs")
          );

          const g = {
            type: "element" as const,
            name: "g",
            attributes: {
              transform: `translate(${tx.toFixed(4)},${ty.toFixed(4)}) scale(${scale.toFixed(6)})`,
            },
            children: drawables,
            parentNode: node,
          };
          drawables.forEach((c) => {
            if ("parentNode" in c) (c as any).parentNode = g;
          });

          node.children = [...defs, g];
          node.attributes["viewBox"] = `0 0 ${targetSize} ${targetSize}`;
          delete node.attributes["width"];
          delete node.attributes["height"];
          delete node.attributes["style"];
          delete node.attributes["x"];
          delete node.attributes["y"];
        },
      },
    }),
  };
}

function makeSvgoConfig(targetSize: number, paddingRatio: number): Config {
  return {
    plugins: [
      "removeDoctype",
      "removeXMLProcInst",
      "removeComments",
      "removeMetadata",
      "removeEditorsNSData",
      "cleanupAttrs",
      "removeEmptyAttrs",
      "removeEmptyContainers",
      "removeUselessDefs",
      // Remove opaque white background rects at the SVG root level
      {
        name: "removeWhiteBackground",
        fn: () => ({
          element: {
            enter(node, parentNode) {
              if (node.name !== "rect") return;
              const fill = (node.attributes["fill"] ?? "").toLowerCase();
              const style = (node.attributes["style"] ?? "").toLowerCase();
              const isWhite =
                fill === "#fff" || fill === "#ffffff" || fill === "white" ||
                style.includes("#fff") || style.includes("white");
              if (isWhite && parentNode.type === "element" && parentNode.name === "svg") {
                parentNode.children = parentNode.children.filter((c) => c !== node);
              }
            },
          },
        }),
      } satisfies CustomPlugin,
      makeCenterPlugin(targetSize, paddingRatio),
    ],
  };
}

// ── File traversal ────────────────────────────────────────────────────────────

function* walkSvgs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkSvgs(full);
    } else if (entry.endsWith(".svg") && entry !== "sprite.svg") {
      yield full;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const files = [...walkSvgs(ROOT_DIR)];
const svgoConfig        = makeSvgoConfig(TARGET_SIZE, PADDING_RATIO);
const svgoPatternConfig = makeSvgoConfig(TARGET_SIZE, 0);

console.log(`Found ${files.length} SVG files`);
console.log(`Canvas: ${TARGET_SIZE}×${TARGET_SIZE}, padding: ${PADDING_RATIO * 100}%`);
console.log(INPLACE ? "Mode: INPLACE" : `Output: ${OUT_DIR}/`);
console.log();

let ok = 0, failed = 0;

for (const [i, file] of files.entries()) {
  const rel = relative(ROOT_DIR, file);
  const label = `[${i + 1}/${files.length}] ${rel}`;

  const isPattern = PATTERN_RE.test(file);

  // Patterns already tile edge-to-edge and must not be cropped or inset.
  // For regular symbols, Inkscape crops the SVG to actual drawn content bounds
  // to eliminate artboard whitespace that would otherwise cause them to appear tiny.
  let svgInput: string;
  if (isPattern) {
    svgInput = readFileSync(file, "utf-8");
  } else {
    const cropped = cropToDrawing(file);
    if (!cropped) {
      console.log(`${label}  ✗ Inkscape failed`);
      failed++;
      continue;
    }
    svgInput = cropped;
  }

  // Step 2: SVGO cleans up and centers the content in a square canvas.
  const cfg = isPattern ? svgoPatternConfig : svgoConfig;
  let result: { data: string };
  try {
    result = optimize(svgInput, { ...cfg, path: file });
  } catch (e) {
    console.log(`${label}  ✗ optimize error: ${(e as Error).message}`);
    failed++;
    continue;
  }

  const outPath = INPLACE ? file : join(OUT_DIR, relative(ROOT_DIR, file));
  try {
    if (!INPLACE) mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, result.data, "utf-8");
    console.log(`${label}  ✓`);
    ok++;
  } catch {
    console.log(`${label}  ✗ write error`);
    failed++;
  }
}

console.log(`\nDone — ${ok} normalized, ${failed} failed`);
if (!INPLACE) {
  console.log(`\nReview output in: ${OUT_DIR}/`);
  console.log("Re-run with --inplace to overwrite originals when satisfied.");
}
