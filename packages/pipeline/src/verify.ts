#!/usr/bin/env node
// Semantic invariant checks over all generated outputs.
// Run after icons:gen-core + icons:gen-react + icons:sprites.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMarkers, markerSvg } from "./markers.ts";

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
interface SymFiles {
  lang: string;
  svg: string;
}
interface PatternVariantEntry {
  identical: boolean;
  files: Partial<Record<string, SymFiles>>;
}
interface SymEntry {
  id: string;
  identical: boolean;
  files: Record<string, SymFiles>;
  patterns?: Partial<Record<"a" | "b", PatternVariantEntry>>;
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
    if (!fr.has(k) || !it.has(k)) {
      fail(`sprite key "${k}" present in de but missing in fr or it`);
      identical = false;
    }
  }
  for (const k of fr) {
    if (!de.has(k)) {
      fail(`sprite key "${k}" present in fr but missing in de`);
      identical = false;
    }
  }
  if (identical) pass("sprite key sets are identical across de/fr/it");
}

// ── Pattern invariants ────────────────────────────────────────────────────────
const SVG_DIR = join(ROOT, "packages/svg/svg");

// Collect symbols that have at least one pattern variant (a or b).
// Bug fix: the old filter `s.patterns?.a` missed symbols with only a "b" variant.
const symbolsWithAnyPattern = allSymbols.filter((s) => s.patterns?.a || s.patterns?.b);
const symbolsWithPatternB = allSymbols.filter((s) => s.patterns?.b);

// Every pattern SVG path must exist on disk.
// Bug fix: iterate symbolsWithAnyPattern, not symbolsWithPattern, so b-only variants are covered.
let patternPathsOk = true;
for (const sym of symbolsWithAnyPattern) {
  for (const variant of ["a", "b"] as const) {
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
if (patternPathsOk && symbolsWithAnyPattern.length > 0) {
  pass(`pattern svg paths exist (${symbolsWithAnyPattern.length} symbols with patterns)`);
}

// Bug fix: replace the hardcoded "1113-only" b-variant whitelist with a structural check.
// Any symbol may gain a b variant in future; the check should enforce structural consistency,
// not catalogue facts. We simply assert that b-variant symbols also have an a variant
// (b is always an alternate to a, never the sole variant).
let bVariantOk = true;
for (const sym of symbolsWithPatternB) {
  if (!sym.patterns?.a) {
    fail(`symbol "${sym.id}" has pattern variant b but no variant a — b is always paired with a`);
    bVariantOk = false;
  }
}
if (bVariantOk && symbolsWithPatternB.length > 0) {
  pass(`pattern b-variants all have a paired a-variant (${symbolsWithPatternB.length} symbols)`);
}

// Sprite JSON must contain all expected pattern keys.
// Bug fix: iterate symbolsWithAnyPattern so b-only keys are also asserted.
if (spriteKeySets.length === 3) {
  const deKeys = spriteKeySets[0]!;
  const expectedPatternKeys: string[] = [];
  for (const sym of symbolsWithAnyPattern) {
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

// ── Marker invariants ─────────────────────────────────────────────────────────
{
  // Check 0 (implicit): loadMarkers() throws on a malformed manifest.
  const markers = loadMarkers();
  const markerIds = new Set(markers.map((m) => m.id));
  const markerKeys = new Set(markers.map((m) => m.key));

  // 1. Every marker's source SVG exists on disk.
  let svgOk = true;
  for (const m of markers) {
    if (!existsSync(m.absPath)) {
      fail(`marker "${m.id}": source SVG not found: ${m.absPath}`);
      svgOk = false;
    }
  }
  if (svgOk) pass(`marker source SVGs exist (${markers.length} markers)`);

  // 2. Every declared recolour rule matches ≥1 attribute (also validates assertCanonicalColors).
  let recolorOk = true;
  for (const m of markers) {
    if (m.recolor && Object.keys(m.recolor).length > 0) {
      try {
        markerSvg(m);
      } catch (e) {
        fail(`marker "${m.id}": ${(e as Error).message}`);
        recolorOk = false;
      }
    }
  }
  if (recolorOk) pass("marker recolour rules all hit ≥1 attribute");

  // 3. Every marker key present in all three sprite sheets.
  if (spriteKeySets.length === 3) {
    let presentOk = true;
    for (const key of markerKeys) {
      for (let i = 0; i < 3; i++) {
        const lang = ["de", "fr", "it"][i]!;
        if (!spriteKeySets[i]!.has(key)) {
          fail(`marker key "${key}" not found in babs-${lang}.json`);
          presentOk = false;
        }
      }
    }
    if (presentOk) pass(`all ${markers.length} marker keys present in all three sprite sheets`);
  }

  // 4. Closed set: no "marker-" prefixed key in the de sheet that isn't declared.
  if (spriteKeySets.length > 0) {
    const deKeys = spriteKeySets[0]!;
    let closedOk = true;
    for (const key of deKeys) {
      if (key.startsWith("marker-") && !markerKeys.has(key)) {
        fail(
          `sprite key "${key}" has "marker-" prefix but is not declared in markers/markers.json`,
        );
        closedOk = false;
      }
    }
    if (closedOk) pass("sprite marker-prefix keys form a closed set (no undeclared extras)");
  }

  // 5. Language-neutral: pixel hashes for each marker key are identical across de/fr/it.
  const PIXEL_HASH = join(ROOT, "packages/sprites/pixels.sha256.json");
  if (existsSync(PIXEL_HASH)) {
    const px = JSON.parse(readFileSync(PIXEL_HASH, "utf8")) as {
      langs: Record<string, Record<string, string>>;
    };
    let hashOk = true;
    for (const m of markers) {
      const de = px.langs["de"]?.[m.key];
      const fr = px.langs["fr"]?.[m.key];
      const it = px.langs["it"]?.[m.key];
      if (!de) {
        fail(`marker "${m.key}": missing hash in pixels.sha256.json (de)`);
        hashOk = false;
        continue;
      }
      if (de !== fr) {
        fail(`marker "${m.key}": de/fr pixel hashes differ — marker is not language-neutral`);
        hashOk = false;
      }
      if (de !== it) {
        fail(`marker "${m.key}": de/it pixel hashes differ — marker is not language-neutral`);
        hashOk = false;
      }
    }
    if (hashOk) pass(`marker pixel hashes are identical across de/fr/it`);
  }

  // 6. Sheet geometry matches declared mode: width===32 for icon, 36 for pattern.
  if (spriteKeySets.length > 0) {
    const deJsonPath = join(SPRITES_DIST, "babs-de.json");
    if (existsSync(deJsonPath)) {
      const deSprite = JSON.parse(readFileSync(deJsonPath, "utf8")) as Record<
        string,
        { width: number }
      >;
      let geomOk = true;
      for (const m of markers) {
        const entry = deSprite[m.key];
        if (!entry) continue; // caught by check 3
        const expectedW = m.mode === "pattern" ? 36 : 32;
        if (entry.width !== expectedW) {
          fail(
            `marker "${m.key}": mode="${m.mode}" expects width=${expectedW}, sprite has width=${entry.width}`,
          );
          geomOk = false;
        }
      }
      if (geomOk) pass("marker sprite geometry matches declared mode");
    }
  }

  // 7. Disjointness: no marker id overlaps with index.json ids, and no id ends in -pattern/-pattern-b.
  let disjointOk = true;
  for (const id of markerIds) {
    if (allIds.has(id)) {
      fail(`marker id "${id}" collides with a catalogue icon id in index.json`);
      disjointOk = false;
    }
    if (/-pattern(-b)?$/.test(id)) {
      fail(
        `marker id "${id}" ends with "-pattern" or "-pattern-b" — would collide with PATTERN_KEY_RE`,
      );
      disjointOk = false;
    }
  }
  if (disjointOk) pass("marker ids are disjoint from catalogue ids and have no -pattern suffix");

  // 8. Explicit exclusion from babs-react and babs-assets.

  // 8a. packages/react/src/icons/*.tsx stems must equal index.json ids exactly
  //     (closes the extra-export hole in general; catches markers as a special case).
  const iconsDir2 = join(ROOT, "packages/react/src/icons");
  if (existsSync(iconsDir2)) {
    const stemSet = new Set(
      readdirSync(iconsDir2)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => basename(f, ".tsx")),
    );
    const idSet = new Set(allIds);
    let setEqOk = true;
    for (const stem of stemSet) {
      if (!idSet.has(stem)) {
        fail(
          `packages/react/src/icons/${stem}.tsx exists but "${stem}" is not in index.json — stale or leaked file`,
        );
        setEqOk = false;
      }
    }
    for (const id of idSet) {
      if (!stemSet.has(id)) {
        fail(`index.json id "${id}" has no corresponding packages/react/src/icons/${id}.tsx`);
        setEqOk = false;
      }
    }
    if (setEqOk) pass("packages/react/src/icons/ stems === index.json ids (exact set equality)");
  }

  // 8b. Scoped tripwire: none of named.ts/icons.ts/all.ts contains any concrete marker-<id> string.
  const REACT_BARRELS = ["named.ts", "icons.ts", "all.ts"].map((f) =>
    join(ROOT, "packages/react/src", f),
  );
  let barrelOk = true;
  for (const m of markers) {
    const concreteKey = m.key; // e.g. "marker-chevron-blue"
    for (const barrelPath of REACT_BARRELS) {
      if (!existsSync(barrelPath)) continue;
      const src = readFileSync(barrelPath, "utf8");
      if (src.includes(`"${concreteKey}"`) || src.includes(`'${concreteKey}'`)) {
        fail(
          `marker key "${concreteKey}" found in ${basename(barrelPath)} — markers must not reach babs-react`,
        );
        barrelOk = false;
      }
    }
  }
  if (barrelOk) pass("no marker sprite keys found in react barrel files");

  // 8c. No "marker-" key in packages/svg/index.json.
  const SVG_INDEX2 = join(ROOT, "packages/svg/index.json");
  const rawIndex = readFileSync(SVG_INDEX2, "utf8");
  let indexCleanOk = true;
  for (const m of markers) {
    if (rawIndex.includes(`"${m.key}"`) || rawIndex.includes(`"${m.id}"`)) {
      fail(
        `marker id/key "${m.id}" found in packages/svg/index.json — markers must not enter the catalogue`,
      );
      indexCleanOk = false;
    }
  }
  if (indexCleanOk) pass("no marker ids/keys in packages/svg/index.json");
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
    fail(
      `names.lock.json missing aliases for: ${missingAlias.join(", ")} — run yarn icons:gen-core`,
    );
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
  for (const id of [
    ...Object.keys(lock.aliases),
    ...Object.keys(lock.canonical),
    ...Object.keys(lock.retired),
  ]) {
    if (!indexIds.has(id)) fail(`names.lock.json: id "${id}" not in index.json — orphaned entry`);
  }
  for (const id of Object.keys(pins)) {
    if (!indexIds.has(id))
      fail(`corrections/aliases.json: id "${id}" not in index.json — orphaned entry`);
  }

  // 4. Global uniqueness — all assigned names (canonical + live aliases + retired) must be unique.
  const nameToId = new Map<string, string>();
  let collisionFound = false;
  const checkUnique = (name: string, id: string, source: string): void => {
    if (nameToId.has(name) && nameToId.get(name) !== id) {
      fail(
        `naming collision: "${name}" assigned to both "${nameToId.get(name)}" and "${id}" (${source})`,
      );
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
    fail(
      `aliases with invalid identifier form: ${invalidAliases.map(([id, n]) => `${id}→${n}`).join(", ")}`,
    );
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
    if (barrelOk)
      pass(`packages/react/src/named.ts matches names.lock.json (${allIdsList.length} entries)`);
  }
}

// ── React icons ────────────────────────────────────────────────────────────────
const iconsDir = join(ROOT, "packages/react/src/icons");
if (!existsSync(iconsDir)) {
  fail("packages/react/src/icons/ is missing — run icons:gen-react");
} else {
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
