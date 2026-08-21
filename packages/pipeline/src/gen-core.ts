#!/usr/bin/env node
// Reads packages/svg/index.json + corrections/ and generates packages/core/src/generated/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAliases } from "./aliases.ts";
import { compareNumeric } from "./naming.ts";
import { loadMarkers } from "./markers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const SVG_INDEX = join(ROOT, "packages/svg/index.json");
const CORRECTIONS = join(ROOT, "corrections/labels.json");
const ALIAS_PINS = join(ROOT, "corrections/aliases.json");
const NAMES_LOCK = join(ROOT, "corrections/names.lock.json");
const SVG_DIR = join(ROOT, "packages/svg/svg");
const CORE_GEN = join(ROOT, "packages/core/src/generated");
const LANGS = ["de", "fr", "it"] as const;
type Lang = (typeof LANGS)[number];

// ── Parse arguments ──────────────────────────────────────────────────────────
const CHECK = process.argv.includes("--check");

// ── Load inputs ──────────────────────────────────────────────────────────────
interface SymbolEntry {
  id: string;
  identical: boolean;
  label: Record<Lang, string>;
  files: Record<Lang, { lang: string; svg: string }>;
  patterns?: Partial<Record<"a", unknown>>;
}
interface SubcatEntry {
  number: string;
  name: Record<Lang, string>;
  symbols: SymbolEntry[];
}
interface CatEntry {
  number: string;
  name: Record<Lang, string>;
  symbols?: SymbolEntry[];
  subcategories?: SubcatEntry[];
}
interface IndexJson {
  categories: CatEntry[];
}

const index = JSON.parse(readFileSync(SVG_INDEX, "utf8")) as IndexJson;
const corrections = JSON.parse(readFileSync(CORRECTIONS, "utf8")) as Record<
  string,
  Partial<Record<Lang, string>> & { note?: string }
>;
const pins = JSON.parse(readFileSync(ALIAS_PINS, "utf8")) as Record<string, string>;
interface NamesLock {
  _comment?: string;
  canonical: Record<string, string>;
  aliases: Record<string, string>;
  retired: Record<string, string[]>;
}
const namesLock: NamesLock = JSON.parse(readFileSync(NAMES_LOCK, "utf8")) as NamesLock;

// ── Flatten symbols with category/group context ───────────────────────────────
interface RichSymbol extends SymbolEntry {
  catNum: string;
  groupNum: string;
  catLabels: Record<Lang, string>;
  groupLabels: Record<Lang, string>;
}

const richSymbols: RichSymbol[] = [];
for (const cat of index.categories) {
  if (cat.symbols) {
    // flat category — synthetic group N+"1"
    const gn = cat.number + "1";
    for (const sym of cat.symbols) {
      richSymbols.push({
        ...sym,
        catNum: cat.number,
        groupNum: gn,
        catLabels: cat.name as Record<Lang, string>,
        groupLabels: cat.name as Record<Lang, string>,
      });
    }
  } else {
    for (const sub of cat.subcategories ?? []) {
      for (const sym of sub.symbols) {
        richSymbols.push({
          ...sym,
          catNum: cat.number,
          groupNum: sub.number,
          catLabels: cat.name as Record<Lang, string>,
          groupLabels: sub.name as Record<Lang, string>,
        });
      }
    }
  }
}

// ── Detect raster (svg file contains <image) ──────────────────────────────────
function isRaster(svgRelPath: string): boolean {
  try {
    const content = readFileSync(join(SVG_DIR, svgRelPath.replace(/^svg\//, "")), "utf8");
    return content.includes("<image");
  } catch {
    return false;
  }
}

// ── Alias computation ─────────────────────────────────────────────────────────
// Validate pins: every id in aliases.json must exist in index.json (orphan guard run early
// so errors are reported before we write anything).
{
  const idSet = new Set(richSymbols.map((s) => s.id));
  for (const id of Object.keys(pins)) {
    if (!idSet.has(id)) {
      console.error(
        `ERROR: corrections/aliases.json: "${id}" not found in index.json — orphaned entry`,
      );
      process.exit(1);
    }
  }
  // Detect conflict: aliases.json requests a rename that the lock has already frozen.
  for (const [id, requestedName] of Object.entries(pins)) {
    const lockedName = namesLock.aliases[id];
    if (lockedName !== undefined && lockedName !== requestedName) {
      console.error(
        `ERROR: "${id}" is locked as "${lockedName}" but corrections/aliases.json requests "${requestedName}".\n` +
          `Renaming a frozen export name is a breaking change. To proceed, add the old name to\n` +
          `corrections/names.lock.json "retired" and then re-run yarn icons:gen-core.`,
      );
      process.exit(1);
    }
  }
}

const aliases = buildAliases(richSymbols, corrections, namesLock.aliases, pins);

// Update lock: assign canonical and alias entries for any new ids.
const newLockEntries: string[] = [];
for (const sym of richSymbols) {
  if (!namesLock.canonical[sym.id]) {
    namesLock.canonical[sym.id] = `babs${sym.id}`;
    newLockEntries.push(sym.id);
  }
  if (!namesLock.aliases[sym.id]) {
    namesLock.aliases[sym.id] = aliases.get(sym.id)!;
  }
}

// ── Determine graphicLangs for each symbol ────────────────────────────────────
// identical=true → ["de"]; identical=false → check fr vs it content
function getGraphicLangs(sym: SymbolEntry): Lang[] {
  if (sym.identical) return ["de"];
  // Compare de/fr/it SVG content hashes
  const content: Record<Lang, string> = { de: "", fr: "", it: "" };
  for (const lang of LANGS) {
    const rel = sym.files[lang]?.svg;
    if (rel) {
      try {
        content[lang] = readFileSync(join(SVG_DIR, rel.replace(/^svg\//, "")), "utf8");
      } catch {
        /**/
      }
    }
  }
  // Collect distinct langs (by content)
  const seen = new Map<string, Lang>(); // content → first lang
  const distinct: Lang[] = [];
  for (const lang of LANGS) {
    const c = content[lang];
    if (!c) continue;
    if (!seen.has(c)) {
      seen.set(c, lang);
      distinct.push(lang);
    }
  }
  return distinct.length > 0 ? distinct : ["de"];
}

// ── Collect all derived data ──────────────────────────────────────────────────
interface IconData extends RichSymbol {
  exportName: string;
  alias: string;
  graphicLangs: Lang[];
  canonicalGraphicLang: Lang;
  raster: boolean;
  correctedLabels: Record<Lang, string>;
  hasPattern: boolean;
  hasPatternB: boolean;
}

const icons: IconData[] = richSymbols.map((sym) => {
  const graphicLangs = getGraphicLangs(sym);
  const canonicalGraphicLang = graphicLangs[0]!;
  const svgRelPath = sym.files[canonicalGraphicLang]?.svg ?? "";
  const raster = isRaster(svgRelPath);
  const correctedLabels: Record<Lang, string> = { de: "", fr: "", it: "" };
  for (const lang of LANGS) {
    correctedLabels[lang] = corrections[sym.id]?.[lang] ?? sym.label[lang] ?? "";
  }
  return {
    ...sym,
    exportName: "babs" + sym.id,
    alias: aliases.get(sym.id)!,
    graphicLangs,
    canonicalGraphicLang,
    raster,
    correctedLabels,
    hasPattern: !!sym.patterns?.a,
    hasPatternB: !!sym.patterns?.b,
  };
});

const allIds = icons.map((i) => i.id);
const catNumbers = [...new Set(icons.map((i) => i.catNum))].sort();
const groupNumbers = [...new Set(icons.map((i) => i.groupNum))].sort();

// ── Code generation helpers ───────────────────────────────────────────────────
function q(s: string): string {
  return JSON.stringify(s);
}

function boolArr(arr: string[]): string {
  return `[${arr.map(q).join(", ")}]`;
}

const HEADER = `// @generated by packages/pipeline/src/gen-core.ts — do not edit manually\n`;

// ── Generate markers.ts ───────────────────────────────────────────────────────
function genMarkers(): string {
  const markerList = loadMarkers(); // sorted, validated
  const idUnion = markerList.map((m) => q(m.id)).join(" | ");
  const idArr = `[${markerList.map((m) => q(m.id)).join(", ")}]`;
  const modeEntries = markerList.map((m) => `  ${q(m.id)}: ${q(m.mode)}`).join(",\n");
  return `${HEADER}
export type BabsMarkerId = ${idUnion};
export type BabsMarkerMode = "icon" | "pattern";
export const BABS_MARKER_IDS: readonly BabsMarkerId[] = ${idArr};
export const BABS_MARKER_MODES: Readonly<Record<BabsMarkerId, BabsMarkerMode>> = {
${modeEntries},
};
`;
}

// ── Generate ids.ts ───────────────────────────────────────────────────────────
function genIds(): string {
  const idUnion = allIds.map(q).join(" | ");
  const catUnion = catNumbers.map(q).join(" | ");
  const grpUnion = groupNumbers.map(q).join(" | ");
  return `${HEADER}
export type BabsIconId = ${idUnion};
export type BabsCategoryNumber = ${catUnion};
export type BabsGroupNumber = ${grpUnion};
export type BabsLang = "de" | "fr" | "it";
export const BABS_ICON_IDS: readonly BabsIconId[] = ${boolArr(allIds)};
`;
}

// ── Generate meta.ts ──────────────────────────────────────────────────────────
function genMeta(): string {
  const entries = icons.map((ic) => {
    const labels = `{ de: ${q(ic.correctedLabels.de)}, fr: ${q(ic.correctedLabels.fr)}, it: ${q(ic.correctedLabels.it)} }`;
    const gLangs = `[${ic.graphicLangs.map(q).join(", ")}]`;
    return `  ${q(ic.id)}: {
    id: ${q(ic.id)},
    category: ${q(ic.catNum)},
    group: ${q(ic.groupNum)},
    export: ${q(ic.exportName)},
    alias: ${q(ic.alias)},
    labels: ${labels},
    identical: ${ic.identical},
    graphicLangs: ${gLangs},
    canonicalGraphicLang: ${q(ic.canonicalGraphicLang)},
    raster: ${ic.raster},
    recolorable: false,
    displaySize: 32,
    viewBox: "0 0 100 100",
    hasPattern: ${ic.hasPattern},
    hasPatternB: ${ic.hasPatternB},
  }`;
  });

  return `${HEADER}
import type { BabsIconMeta } from "../types.js";

export const BABS_ICONS: Readonly<Record<string, BabsIconMeta>> = {
${entries.join(",\n")}
};
`;
}

// ── Generate tree.ts ──────────────────────────────────────────────────────────
function genTree(): string {
  // Build category → groups → icons structure
  interface GroupAccum {
    number: string;
    labels: Record<Lang, string>;
    icons: string[];
  }
  interface CatAccum {
    number: string;
    labels: Record<Lang, string>;
    groups: Map<string, GroupAccum>;
  }
  const catMap = new Map<string, CatAccum>();

  for (const ic of icons) {
    if (!catMap.has(ic.catNum)) {
      catMap.set(ic.catNum, {
        number: ic.catNum,
        labels: ic.catLabels,
        groups: new Map(),
      });
    }
    const cat = catMap.get(ic.catNum)!;
    if (!cat.groups.has(ic.groupNum)) {
      cat.groups.set(ic.groupNum, {
        number: ic.groupNum,
        labels: ic.groupLabels,
        icons: [],
      });
    }
    cat.groups.get(ic.groupNum)!.icons.push(ic.id);
  }

  const catLines = [...catMap.values()].map((cat) => {
    const catLabels = `{ de: ${q(cat.labels.de)}, fr: ${q(cat.labels.fr)}, it: ${q(cat.labels.it)} }`;
    const groupLines = [...cat.groups.values()].map((grp) => {
      const grpLabels = `{ de: ${q(grp.labels.de)}, fr: ${q(grp.labels.fr)}, it: ${q(grp.labels.it)} }`;
      const iconList = boolArr(grp.icons);
      return `    { number: ${q(grp.number)}, labels: ${grpLabels}, icons: ${iconList} }`;
    });
    return `  {
    number: ${q(cat.number)},
    labels: ${catLabels},
    groups: [
${groupLines.join(",\n")}
    ],
  }`;
  });

  return `${HEADER}
import type { BabsCategory } from "../types.js";

export const BABS_TREE: readonly BabsCategory[] = [
${catLines.join(",\n")}
];
`;
}

// ── Generate labels/<lang>.ts ─────────────────────────────────────────────────
function genLabels(lang: Lang): string {
  const entries = icons.map((ic) => `  ${q(ic.id)}: ${q(ic.correctedLabels[lang])}`);
  return `${HEADER}
export const BABS_LABELS_${lang.toUpperCase()}: Readonly<Record<string, string>> = {
${entries.join(",\n")}
};
`;
}

// ── Write or check ────────────────────────────────────────────────────────────
function writeOrCheck(path: string, content: string, label: string): boolean {
  if (CHECK) {
    if (!existsSync(path)) {
      console.error(`MISSING: ${label}`);
      return false;
    }
    const existing = readFileSync(path, "utf8");
    if (existing !== content) {
      console.error(`DRIFT:   ${label}`);
      return false;
    }
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return true;
}

// ── Orphan check ──────────────────────────────────────────────────────────────
const indexIds = new Set(allIds);
for (const corrId of Object.keys(corrections)) {
  if (!indexIds.has(corrId)) {
    console.error(`ERROR: corrections/${corrId} not found in index.json — orphaned entry`);
    process.exit(1);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
let ok = true;
ok = writeOrCheck(join(CORE_GEN, "ids.ts"), genIds(), "ids.ts") && ok;
ok = writeOrCheck(join(CORE_GEN, "meta.ts"), genMeta(), "meta.ts") && ok;
ok = writeOrCheck(join(CORE_GEN, "tree.ts"), genTree(), "tree.ts") && ok;
ok = writeOrCheck(join(CORE_GEN, "markers.ts"), genMarkers(), "markers.ts") && ok;
for (const lang of LANGS) {
  ok =
    writeOrCheck(join(CORE_GEN, `labels/${lang}.ts`), genLabels(lang), `labels/${lang}.ts`) && ok;
}

if (CHECK) {
  if (newLockEntries.length > 0) {
    console.error(
      `DRIFT:   corrections/names.lock.json (${newLockEntries.length} unassigned name(s): ${newLockEntries.join(", ")} — run yarn icons:gen-core)`,
    );
    ok = false;
  }
  if (ok) {
    console.log("gen-core: OK (no drift)");
  } else {
    process.exit(1);
  }
} else {
  // Write names.lock.json — append-only, sorted by id.
  const sortedCanonical: Record<string, string> = {};
  const sortedAliases: Record<string, string> = {};
  for (const id of Object.keys(namesLock.canonical).sort(compareNumeric)) {
    sortedCanonical[id] = namesLock.canonical[id]!;
  }
  for (const id of Object.keys(namesLock.aliases).sort(compareNumeric)) {
    sortedAliases[id] = namesLock.aliases[id]!;
  }
  const lockOut: NamesLock = {
    _comment: namesLock._comment,
    canonical: sortedCanonical,
    aliases: sortedAliases,
    retired: namesLock.retired,
  };
  writeFileSync(NAMES_LOCK, JSON.stringify(lockOut, null, 2) + "\n");

  const markerCount = loadMarkers().length;
  console.log(
    `gen-core: wrote ${icons.length} icons across ${catNumbers.length} categories, ${groupNumbers.length} groups + ${markerCount} markers`,
  );
  if (newLockEntries.length > 0) {
    console.log(`  names.lock.json: assigned ${newLockEntries.length} new name(s)`);
  }
  console.log(
    `  raster: ${icons.filter((i) => i.raster).length}, vector: ${icons.filter((i) => !i.raster).length}`,
  );
  console.log(
    `  identical: ${icons.filter((i) => i.identical).length}, divergent: ${icons.filter((i) => !i.identical).length}`,
  );
}
