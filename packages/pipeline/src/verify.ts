#!/usr/bin/env node
// Semantic invariant checks over all generated outputs.
// Run after icons:gen-core + icons:gen-react + icons:sprites.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const SVG_INDEX = join(ROOT, "packages/svg/index.json");
const CORE_META = join(ROOT, "packages/core/src/generated/meta.ts");
const SPRITES_DIST = join(ROOT, "packages/sprites/dist");
const CORRECTIONS = join(ROOT, "corrections/labels.json");

let failures = 0;
function fail(msg: string): void {
  console.error(`  FAIL: ${msg}`);
  failures++;
}
function pass(msg: string): void {
  console.log(`  OK:   ${msg}`);
}

// ── Load index ────────────────────────────────────────────────────────────────
interface SymEntry { id: string; identical: boolean; files: Record<string, { lang: string; svg: string }> }
interface IndexJson { categories: Array<{ number: string; symbols?: SymEntry[]; subcategories?: Array<{ number: string; symbols: SymEntry[] }> }> }

const index = JSON.parse(readFileSync(SVG_INDEX, "utf8")) as IndexJson;
const allSymbols: SymEntry[] = [];
for (const cat of index.categories) {
  for (const sym of cat.symbols ?? []) allSymbols.push(sym);
  for (const sub of cat.subcategories ?? []) for (const sym of sub.symbols) allSymbols.push(sym);
}
const allIds = new Set(allSymbols.map((s) => s.id));

console.log("verify: checking invariants...");

// ── Corrections orphan check ──────────────────────────────────────────────────
if (existsSync(CORRECTIONS)) {
  const corrections = JSON.parse(readFileSync(CORRECTIONS, "utf8")) as Record<string, unknown>;
  for (const id of Object.keys(corrections)) {
    if (!allIds.has(id)) {
      fail(`corrections/labels.json: "${id}" not found in index.json`);
    }
  }
  pass(`corrections orphan check (${Object.keys(corrections).length} entries)`);
}

// ── generated/meta.ts exists ─────────────────────────────────────────────────
if (!existsSync(CORE_META)) {
  fail("packages/core/src/generated/meta.ts is missing — run icons:gen-core");
} else {
  pass("packages/core/src/generated/meta.ts exists");
}

// ── Sprite sheets ─────────────────────────────────────────────────────────────
const LANGS = ["de", "fr", "it"] as const;
const SUFFIXES = ["", "@2x"] as const;
const EXTS = ["json", "png"] as const;

let spriteKeySets: Set<string>[] = [];
for (const lang of LANGS) {
  const jsonPath = join(SPRITES_DIST, `babs-${lang}.json`);
  if (!existsSync(jsonPath)) {
    fail(`babs-${lang}.json missing from sprites/dist — run icons:sprites`);
    continue;
  }
  const spriteJson = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
  const keys = new Set(Object.keys(spriteJson));

  // Non-empty
  if (keys.size === 0) {
    fail(`babs-${lang}.json has zero entries`);
  } else {
    pass(`babs-${lang}.json has ${keys.size} entries`);
  }
  spriteKeySets.push(keys);

  // All PNG/JSON variants exist
  for (const suffix of SUFFIXES) {
    for (const ext of EXTS) {
      const f = `babs-${lang}${suffix}.${ext}`;
      if (!existsSync(join(SPRITES_DIST, f))) {
        fail(`${f} missing from sprites/dist`);
      }
    }
  }
}

// Key sets must be identical across languages
if (spriteKeySets.length === 3) {
  const [de, fr, it] = spriteKeySets as [Set<string>, Set<string>, Set<string>];
  let identical = true;
  for (const k of de) {
    if (!fr.has(k) || !it.has(k)) { fail(`sprite key "${k}" present in de but missing in fr or it`); identical = false; }
  }
  for (const k of fr) {
    if (!de.has(k)) { fail(`sprite key "${k}" present in fr but missing in de`); identical = false; }
  }
  if (identical) pass("sprite key sets are identical across de/fr/it");
}

// ── React icons ────────────────────────────────────────────────────────────────
const iconsDir = join(ROOT, "packages/react/src/icons");
if (!existsSync(iconsDir)) {
  fail("packages/react/src/icons/ is missing — run icons:gen-react");
} else {
  const { readdirSync } = await import("node:fs");
  const iconFiles = readdirSync(iconsDir).filter((f) => f.endsWith(".tsx"));
  if (iconFiles.length === 0) {
    fail("packages/react/src/icons/ is empty");
  } else {
    pass(`packages/react/src/icons/ has ${iconFiles.length} generated icon modules`);
  }
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log("");
if (failures === 0) {
  console.log(`verify: all checks passed`);
} else {
  console.error(`verify: ${failures} check(s) FAILED`);
  process.exitCode = 1;
}
