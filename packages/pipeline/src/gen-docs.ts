#!/usr/bin/env node
// Generate docs/icons.md and docs/markers.md.
// Run: node packages/pipeline/src/gen-docs.ts

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMarkers } from "./markers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const SVG_PKG = join(ROOT, "packages/svg");
const NAMES_LOCK = join(ROOT, "corrections/names.lock.json");
const OUT = join(ROOT, "docs/icons.md");
const OUT_MARKERS = join(ROOT, "docs/markers.md");

// ── Load data ─────────────────────────────────────────────────────────────────

const index = JSON.parse(readFileSync(join(SVG_PKG, "index.json"), "utf8")) as Index;
const corrections = existsSync(join(ROOT, "corrections/labels.json"))
  ? (JSON.parse(readFileSync(join(ROOT, "corrections/labels.json"), "utf8")) as Record<
      string,
      { de?: string; fr?: string; it?: string; note?: string }
    >)
  : {};
const aliasLock: { aliases?: Record<string, string> } = existsSync(NAMES_LOCK)
  ? (JSON.parse(readFileSync(NAMES_LOCK, "utf8")) as { aliases?: Record<string, string> })
  : {};

// ── Types ─────────────────────────────────────────────────────────────────────

interface LangMap {
  de: string;
  fr: string;
  it: string;
}
interface FileRef {
  lang: string;
  svg: string;
}
interface PatternVariant {
  identical: boolean;
  files: { de?: FileRef; fr?: FileRef; it?: FileRef };
}
interface Symbol {
  id: string;
  identical: boolean;
  label: LangMap;
  files: { de?: FileRef; fr?: FileRef; it?: FileRef };
  patterns?: { a?: PatternVariant };
}
interface Subcategory {
  number: string;
  name: LangMap;
  symbols: Symbol[];
}
interface Category {
  number: string;
  name: LangMap;
  subcategories?: Subcategory[];
  symbols?: Symbol[];
}
interface Index {
  categories: Category[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function correctedLabel(id: string, lang: "de" | "fr" | "it", raw: string): string {
  return corrections[id]?.[lang] ?? raw;
}

// Resolve a svg-relative path (e.g. "svg/4501-Trupp-TechnB-I.svg") to its real
// on-disk file (following any symlinks within svg/), then return a path relative
// to docs/ suitable for use in an <img src>.
function imgSrc(svgFile: string): string {
  const abs = join(SVG_PKG, svgFile);
  const real = realpathSync(abs); // follow symlinks
  const rel = relative(join(ROOT, "docs"), real); // relative from docs/
  return rel;
}

function img(src: string, alt: string, size = 48): string {
  return `<img src="${src}" alt="${alt}" width="${size}" height="${size}">`;
}

function isRaster(svgFile: string): boolean {
  try {
    return readFileSync(join(SVG_PKG, svgFile), "utf8").includes("<image");
  } catch {
    return false;
  }
}

function symbolRow(sym: Symbol): string {
  const de = correctedLabel(sym.id, "de", sym.label.de);
  const fr = correctedLabel(sym.id, "fr", sym.label.fr);
  const it = correctedLabel(sym.id, "it", sym.label.it);

  let iconCell: string;
  if (sym.identical) {
    const file = sym.files.de ?? sym.files.fr ?? sym.files.it;
    const src = file ? imgSrc(file.svg) : "";
    iconCell = src ? img(src, de) : "";
  } else {
    const parts: string[] = [];
    for (const lang of ["de", "fr", "it"] as const) {
      const file = sym.files[lang];
      if (file) {
        const label = lang === "de" ? de : lang === "fr" ? fr : it;
        parts.push(img(imgSrc(file.svg), `${label} (${lang})`));
      }
    }
    iconCell = parts.join("&nbsp;");
  }

  let patternCell = "";
  if (sym.patterns?.a) {
    const pv = sym.patterns.a;
    const pFile = pv.files.de ?? pv.files.fr ?? pv.files.it;
    if (pFile) patternCell = img(imgSrc(pFile.svg), `${de} pattern`, 36);
  }

  const alias = aliasLock.aliases?.[sym.id];
  const aliasCell = alias ? `\`${alias}\`` : "";

  const repFile = sym.files.de ?? sym.files.fr ?? sym.files.it;
  const rasterCell = repFile && isRaster(repFile.svg) ? "✓" : "";

  return `| ${iconCell} | \`${sym.id}\` | ${aliasCell} | ${de} | ${fr} | ${it} | ${patternCell} | ${rasterCell} |`;
}

// Min-width for the icon column: GitHub distributes table width proportionally, so a
// text-heavy DE/FR/IT column can squeeze a narrow icon column below 48px. A transparent
// spacer in the header pins a floor:
//   56px  — single-image tables (48px icon + 8px breathing room)
//  160px  — multi-image tables (3 × 48px + two &nbsp; gaps)

function iconColHeader(hasDivergent: boolean): string {
  const w = hasDivergent ? 160 : 56;
  return `Icon<img width="${w}" height="1" src="spacer.svg" alt="">`;
}

function symbolsTable(symbols: Symbol[]): string {
  const hasDivergent = symbols.some((s) => !s.identical);
  const header = `| ${iconColHeader(hasDivergent)} | ID | Export | DE | FR | IT | Pattern | Raster |\n|---|---|---|---|---|---|---|---|`;
  const rows = symbols.map(symbolRow);
  return `${header}\n${rows.join("\n")}`;
}

// ── Generate markdown ─────────────────────────────────────────────────────────

const lines: string[] = [];

// Count total symbols
let totalSymbols = 0;
for (const cat of index.categories) {
  const syms = cat.subcategories
    ? cat.subcategories.flatMap((s) => s.symbols)
    : (cat.symbols ?? []);
  totalSymbols += syms.length;
}

lines.push("# BABS Icon Reference");
lines.push("");
lines.push(`${totalSymbols} civil-protection icons across ${index.categories.length} categories.`);
lines.push("Labels in German (DE), French (FR) and Italian (IT).");
lines.push(
  "For divergent icons (different graphic per language) all three variants are shown side by side.",
);
lines.push("");
lines.push("---");
lines.push("");

// Table of contents
lines.push("## Contents");
lines.push("");
for (const cat of index.categories) {
  const anchor = `${cat.number.replace(/\./g, "")}--${cat.name.de.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  lines.push(`- [${cat.number} · ${cat.name.de}](#${anchor})`);
}
lines.push("");
lines.push("---");
lines.push("");

for (const cat of index.categories) {
  lines.push(`## ${cat.number} · ${cat.name.de}`);
  lines.push("");
  lines.push(`**${cat.name.de}** / ${cat.name.fr} / ${cat.name.it}`);
  lines.push("");

  if (cat.subcategories && cat.subcategories.length > 0) {
    for (const sub of cat.subcategories) {
      const subSymbols = sub.symbols ?? [];
      if (subSymbols.length === 0) continue;

      lines.push(`### ${sub.number} · ${sub.name.de}`);
      lines.push("");
      lines.push(`*${sub.name.de} / ${sub.name.fr} / ${sub.name.it}*`);
      lines.push("");
      lines.push(symbolsTable(subSymbols));
      lines.push("");
    }
  } else {
    const flatSymbols = cat.symbols ?? [];
    if (flatSymbols.length > 0) {
      lines.push(symbolsTable(flatSymbols));
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
}

// ── Generate docs/markers.md ─────────────────────────────────────────────────

function genMarkersDoc(): string {
  const markers = loadMarkers();
  const mdLines: string[] = [];

  mdLines.push("# BABS Sprite Markers");
  mdLines.push("");
  mdLines.push(
    "Sprite-only graphic primitives for MapLibre symbol layers. Markers have no BABS catalogue",
  );
  mdLines.push(
    "id, no language variant, and no React export — they appear only in the sprite sheets",
  );
  mdLines.push(`(\`babs-de\`, \`babs-fr\`, \`babs-it\`).`);
  mdLines.push("");
  mdLines.push("## Design notes");
  mdLines.push("");
  mdLines.push(
    "- **Ids name shape and colour, never use-case.** A chevron may serve any number of line",
  );
  mdLines.push(
    "  types without its name going stale. The mapping from line type to marker key lives",
  );
  mdLines.push("  entirely in the downstream map style.");
  mdLines.push(
    "- **Language-neutral.** The same pixel data is baked into all three sprite sheets.",
  );
  mdLines.push("  `pixels.sha256.json` asserts this on every build.");
  mdLines.push(
    "- **`icon` mode keeps a 2 px gutter.** A rotated sampling footprint reaches outside the",
  );
  mdLines.push("  nominal 32 px box; the gutter prevents the neighbouring cell bleeding in under");
  mdLines.push("  `icon-rotate`. The full-bleed `pattern` mode (36 px, no gutter) is reserved for");
  mdLines.push("  seamlessly-tiling line fills.");
  mdLines.push(
    "- **Colour variants are baked.** MapLibre sprites are not SDF, so `icon-color` cannot",
  );
  mdLines.push(
    "  recolour at runtime. Each colour variant is a separate sprite key, derived in-memory",
  );
  mdLines.push("  from the same geometry by a recolour rule declared in `markers/markers.json`.");
  mdLines.push(
    "- **Add a marker:** three lines in `markers/markers.json` + one SVG in `markers/svg/`.",
  );
  mdLines.push("  A colour-derived variant is three lines in the manifest with no SVG.");
  mdLines.push("  Run `yarn icons:rebuild && yarn icons:verify` to regenerate.");
  mdLines.push("");
  mdLines.push("## Sprite key helper");
  mdLines.push("");
  mdLines.push("```ts");
  mdLines.push(`import { markerSpriteKey } from "@f-eld-ch/babs-core";`);
  mdLines.push("");
  mdLines.push(`// Returns "marker-chevron-blue" (typed as \`marker-\${BabsMarkerId}\`)`);
  mdLines.push(`markerSpriteKey("chevron-blue");`);
  mdLines.push("```");
  mdLines.push("");
  mdLines.push("## Marker reference");
  mdLines.push("");
  mdLines.push("| Geometry | Sprite key | Mode | Recolour | Notes |");
  mdLines.push("|---|---|---|---|---|");

  for (const m of markers) {
    // Geometry column: show the source SVG if it exists as a file on disk (derived markers don't).
    // Derived markers (chevron-red) share a src with their base — show the base graphic.
    const srcRel = relative(join(ROOT, "docs"), m.absPath);
    const geomCell = `<img src="${srcRel}" alt="${m.id}" width="32" height="32">`;

    const keyCell = `\`${m.key}\``;
    const modeCell = m.mode;
    const recolorCell = m.recolor
      ? Object.entries(m.recolor)
          .map(([from, to]) => `${from} → ${to}`)
          .join(", ")
      : "—";
    const notes = m.recolor
      ? `Geometry shared with \`${m.id.replace(/-[^-]+$/, "")}-${m.mode === "icon" ? "blue" : m.mode}\`. Colour baked — sprites are not SDF.`
      : "";

    mdLines.push(`| ${geomCell} | ${keyCell} | ${modeCell} | ${recolorCell} | ${notes} |`);
  }

  mdLines.push("");
  mdLines.push("---");
  mdLines.push("");
  mdLines.push(`*Generated by \`yarn icons:docs\` — do not edit manually.*`);
  mdLines.push("");

  return mdLines.join("\n");
}

// ── Write output ──────────────────────────────────────────────────────────────

const content = lines.join("\n");
writeFileSync(OUT, content, "utf8");
console.log(`✓ wrote ${OUT} (${content.length.toLocaleString()} bytes, ${totalSymbols} icons)`);

const markersContent = genMarkersDoc();
writeFileSync(OUT_MARKERS, markersContent, "utf8");
console.log(`✓ wrote ${OUT_MARKERS} (${markersContent.length.toLocaleString()} bytes)`);
