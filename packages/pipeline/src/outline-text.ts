#!/usr/bin/env node
// Convert <text> in sources/ to outlined <path> elements using Inkscape, so icons render
// identically in browsers that lack FreeSans / Nimbus Sans.
//
// Usage:
//   node packages/pipeline/src/outline-text.ts [--dry-run]
//
// Files listed in KEEP_TEXT are skipped: they are templates whose text is edited downstream.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const SOURCES = join(ROOT, "sources");
const DRY_RUN = process.argv.includes("--dry-run");

// gen-un-signs.ts fills the Kemler number into the de template's tspans; fr/it stay
// byte-identical to it so flatten.ts keeps deduplicating them.
const KEEP_TEXT = /\/(2\.Gefahren|2\.Dangers|2\.Pericoli)\/09b-/;

function* walkSvgs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkSvgs(full);
    else if (entry.endsWith(".svg")) yield full;
  }
}

let converted = 0,
  failed = 0;
for (const file of walkSvgs(SOURCES)) {
  const rel = relative(SOURCES, file);
  if (KEEP_TEXT.test(rel)) continue;
  if (!/<text[\s>]/.test(readFileSync(file, "utf-8"))) continue;

  if (DRY_RUN) {
    console.log(`would convert ${rel}`);
    converted++;
    continue;
  }
  const r = spawnSync(
    "inkscape",
    ["--export-text-to-path", "--export-plain-svg", "--export-filename=-", file],
    { encoding: "utf-8", timeout: 15_000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0 || !r.stdout?.trim() || /<text[\s>]/.test(r.stdout)) {
    console.log(`✗ ${rel}`);
    failed++;
    continue;
  }
  writeFileSync(file, r.stdout, "utf-8");
  converted++;
}

console.log(`${DRY_RUN ? "Would convert" : "Converted"} ${converted} file(s), ${failed} failed`);
if (failed) process.exit(1);
