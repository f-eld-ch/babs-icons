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
const ALIAS_PINS = join(ROOT, "corrections/aliases.json");
const NAMES_LOCK = join(ROOT, "corrections/names.lock.json");
const REACT_NAMED = join(ROOT, "packages/react/src/named.ts");

let failures = 0;
function fail(msg: string): void {
  console.error(`  FAIL: ${msg}`);
  failures++;
}
function pass(msg: string): void {
  console.log(`  OK:   ${msg}`);
}

// ── Load index ────────────────────────────────────────────────────────────────
interface SymFiles { lang: string; svg: string }
interface PatternVariantEntry { identical: boolean; files: Partial<Record<string, SymFiles>> }
interface SymEntry {
  id: string;
  identical: boolean;
  files: Record<string, SymFiles>;
  patterns?: Partial<Record<"a" | "b", PatternVariantEntry>>;
}
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

// ── Pattern invariants ────────────────────────────────────────────────────────
const SVG_DIR = join(ROOT, "packages/svg/svg");
const symbolsWithPattern = allSymbols.filter((s) => s.patterns?.a);
const symbolsWithPatternB = allSymbols.filter((s) => s.patterns?.b);

// Every pattern SVG path must exist on disk
let patternPathsOk = true;
for (const sym of symbolsWithPattern) {
  for (const variant of (["a", "b"] as const)) {
    const pv = sym.patterns?.[variant];
    if (!pv) continue;
    for (const [lang, entry] of Object.entries(pv.files)) {
      if (!entry) continue;
      const p = join(SVG_DIR, entry.svg.replace(/^svg\//, ""));
      if (!existsSync(p)) {
        fail(`pattern svg missing: ${sym.id} variant=${variant} lang=${lang} → ${entry.svg}`);
        patternPathsOk = false;
      }
    }
  }
}
if (patternPathsOk && symbolsWithPattern.length > 0) {
  pass(`pattern svg paths exist (${symbolsWithPattern.length} symbols with patterns)`);
}

// Only 1113 should have a "b" variant
const bIds = symbolsWithPatternB.map((s) => s.id);
if (bIds.length > 0 && !(bIds.length === 1 && bIds[0] === "1113")) {
  fail(`expected only "1113" to have pattern variant b, got: ${bIds.join(", ")}`);
} else if (bIds.length > 0) {
  pass(`only "1113" has pattern variant b`);
}

// Sprite JSON must contain all expected pattern keys
if (spriteKeySets.length === 3) {
  const deKeys = spriteKeySets[0]!;
  const expectedPatternKeys: string[] = [];
  for (const sym of symbolsWithPattern) {
    if (sym.patterns?.a) expectedPatternKeys.push(`${sym.id}-pattern`);
    if (sym.patterns?.b) expectedPatternKeys.push(`${sym.id}-pattern-b`);
  }
  let patternKeysOk = true;
  for (const k of expectedPatternKeys) {
    if (!deKeys.has(k)) {
      fail(`expected pattern sprite key "${k}" not found in babs-de.json`);
      patternKeysOk = false;
    }
  }
  if (patternKeysOk && expectedPatternKeys.length > 0) {
    pass(`sprite sheets contain all ${expectedPatternKeys.length} pattern keys`);
  }
}

// ── Naming invariants ─────────────────────────────────────────────────────────
{
  const lock = JSON.parse(readFileSync(NAMES_LOCK, "utf8")) as {
    canonical: Record<string, string>;
    aliases: Record<string, string>;
    retired: Record<string, string[]>;
  };
  const pins = JSON.parse(readFileSync(ALIAS_PINS, "utf8")) as Record<string, string>;

  const allIdsList = allSymbols.map((s) => s.id);

  // 1. Completeness — every id has a canonical and alias entry.
  const missingAlias = allIdsList.filter((id) => !lock.aliases[id]);
  if (missingAlias.length > 0) {
    fail(`names.lock.json missing aliases for: ${missingAlias.join(", ")} — run yarn icons:gen-core`);
  } else {
    pass("names.lock.json has alias for every icon");
  }

  // 2. Canonical form — lock.canonical[id] must equal "babs" + id.
  for (const id of allIdsList) {
    const expected = `babs${id}`;
    if (lock.canonical[id] !== expected) {
      fail(`names.lock.json canonical["${id}"] = "${lock.canonical[id]}" (expected "${expected}")`);
    }
  }

  // 3. Orphan check — every key in lock + pins must still exist in index.json.
  const indexIds = new Set(allIdsList);
  for (const id of [...Object.keys(lock.aliases), ...Object.keys(lock.canonical), ...Object.keys(lock.retired)]) {
    if (!indexIds.has(id)) fail(`names.lock.json: id "${id}" not in index.json — orphaned entry`);
  }
  for (const id of Object.keys(pins)) {
    if (!indexIds.has(id)) fail(`corrections/aliases.json: id "${id}" not in index.json — orphaned entry`);
  }

  // 4. Global uniqueness — all assigned names (canonical + live aliases + retired) must be unique.
  const nameToId = new Map<string, string>();
  let collisionFound = false;
  const checkUnique = (name: string, id: string, source: string): void => {
    if (nameToId.has(name) && nameToId.get(name) !== id) {
      fail(`naming collision: "${name}" assigned to both "${nameToId.get(name)}" and "${id}" (${source})`);
      collisionFound = true;
    } else {
      nameToId.set(name, id);
    }
  };
  for (const [id, name] of Object.entries(lock.canonical)) checkUnique(name, id, "canonical");
  for (const [id, name] of Object.entries(lock.aliases)) checkUnique(name, id, "aliases");
  for (const [id, names] of Object.entries(lock.retired)) {
    for (const name of names) checkUnique(name, id, "retired");
  }
  if (!collisionFound) pass("all naming keys are globally unique");

  // 5. Identifier validity — every alias matches /^babs[A-Za-z0-9]+$/.
  const ALIAS_RE = /^babs[A-Za-z0-9]+$/;
  const invalidAliases = Object.entries(lock.aliases).filter(([, name]) => !ALIAS_RE.test(name));
  if (invalidAliases.length > 0) {
    fail(`aliases with invalid identifier form: ${invalidAliases.map(([id, n]) => `${id}→${n}`).join(", ")}`);
  } else {
    pass("all aliases are valid JS identifiers");
  }

  // 6. named.ts barrel agrees with lock.aliases.
  if (!existsSync(REACT_NAMED)) {
    fail("packages/react/src/named.ts is missing — run yarn icons:gen-react");
  } else {
    const namedSrc = readFileSync(REACT_NAMED, "utf8");
    const namedRe = /export \{ babs(\S+?) as (\w+) \}/g;
    const barrelAliases = new Map<string, string>(); // id → alias
    let m: RegExpExecArray | null;
    while ((m = namedRe.exec(namedSrc)) !== null) barrelAliases.set(m[1]!, m[2]!);
    let barrelOk = true;
    for (const id of allIdsList) {
      const expected = lock.aliases[id];
      const actual = barrelAliases.get(id);
      if (expected !== actual) {
        fail(`named.ts: "${id}" exports "${actual ?? "(missing)"}", lock expects "${expected}"`);
        barrelOk = false;
      }
    }
    if (barrelOk) pass(`packages/react/src/named.ts matches names.lock.json (${allIdsList.length} entries)`);
  }
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
