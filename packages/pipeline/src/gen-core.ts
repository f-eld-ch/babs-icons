#!/usr/bin/env node
// Reads packages/svg/index.json + corrections/ and generates packages/core/src/generated/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const SVG_INDEX = join(ROOT, "packages/svg/index.json");
const CORRECTIONS = join(ROOT, "corrections/labels.json");
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
function transliterate(s: string): string {
  return s
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function labelToAlias(label: string): string {
  const t = transliterate(label);
  // PascalCase: capitalise first letter of each word, remove non-alnum
  const pascal = t
    .replace(/[^A-Za-z0-9]+([A-Za-z])/g, (_, c: string) => (c as string).toUpperCase())
    .replace(/[^A-Za-z0-9]/g, "");
  const upper = pascal.charAt(0).toUpperCase() + pascal.slice(1);
  return "babs" + upper;
}

// Build alias table; detect and resolve collisions by suffixing with id
function buildAliases(syms: RichSymbol[]): Map<string, string> {
  const map = new Map<string, string>(); // id → alias
  const usedAliases = new Map<string, string>(); // alias → first id

  for (const sym of syms) {
    const deLabel = (corrections[sym.id]?.de ?? sym.label.de) || sym.id;
    const raw = labelToAlias(deLabel);
    map.set(sym.id, raw);
    const existing = usedAliases.get(raw);
    if (existing !== undefined) {
      // Mark both as colliding — they'll get id suffix
      usedAliases.set(raw, "__COLLISION__");
    } else {
      usedAliases.set(raw, sym.id);
    }
  }

  // Resolve collisions
  for (const sym of syms) {
    const raw = map.get(sym.id)!;
    if (usedAliases.get(raw) === "__COLLISION__") {
      const idPart = sym.id.replace(/[^A-Za-z0-9]/g, "");
      map.set(sym.id, raw + idPart);
    }
  }

  return map;
}

const aliases = buildAliases(richSymbols);

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
      } catch { /**/ }
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
  };
});

const allIds = icons.map((i) => i.id);
const catNumbers = [...new Set(icons.map((i) => i.catNum))].sort();
const groupNumbers = [...new Set(icons.map((i) => i.groupNum))].sort();

// ── Code generation helpers ───────────────────────────────────────────────────
function q(s: string): string {
  return JSON.stringify(s);
}

function langUnion(langs: Lang[]): string {
  return langs.map(q).join(" | ");
}

function boolArr(arr: string[]): string {
  return `[${arr.map(q).join(", ")}]`;
}

const HEADER = `// @generated by packages/pipeline/src/gen-core.ts — do not edit manually\n`;

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
for (const lang of LANGS) {
  ok = writeOrCheck(join(CORE_GEN, `labels/${lang}.ts`), genLabels(lang), `labels/${lang}.ts`) && ok;
}

if (CHECK) {
  if (ok) {
    console.log("gen-core: OK (no drift)");
  } else {
    process.exit(1);
  }
} else {
  console.log(
    `gen-core: wrote ${icons.length} icons across ${catNumbers.length} categories, ${groupNumbers.length} groups`,
  );
  console.log(`  raster: ${icons.filter((i) => i.raster).length}, vector: ${icons.filter((i) => !i.raster).length}`);
  console.log(
    `  identical: ${icons.filter((i) => i.identical).length}, divergent: ${icons.filter((i) => !i.identical).length}`,
  );
}
