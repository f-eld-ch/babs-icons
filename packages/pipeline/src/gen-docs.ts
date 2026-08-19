#!/usr/bin/env node
// Generate docs/icons.md — full icon reference grouped by category/subcategory.
// Run: node packages/pipeline/src/gen-docs.ts

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const SVG_PKG = join(ROOT, "packages/svg");
const OUT = join(ROOT, "docs/icons.md");

// ── Load data ─────────────────────────────────────────────────────────────────

const index = JSON.parse(readFileSync(join(SVG_PKG, "index.json"), "utf8")) as Index;
const corrections = existsSync(join(ROOT, "corrections/labels.json"))
  ? JSON.parse(readFileSync(join(ROOT, "corrections/labels.json"), "utf8")) as Record<string, { de?: string; fr?: string; it?: string; note?: string }>
  : {};

// ── Types ─────────────────────────────────────────────────────────────────────

interface LangMap { de: string; fr: string; it: string }
interface FileRef { lang: string; svg: string }
interface Symbol {
  id: string;
  identical: boolean;
  label: LangMap;
  files: { de?: FileRef; fr?: FileRef; it?: FileRef };
}
interface Subcategory { number: string; name: LangMap; symbols: Symbol[] }
interface Category {
  number: string;
  name: LangMap;
  subcategories?: Subcategory[];
  symbols?: Symbol[];
}
interface Index { categories: Category[] }

// ── Helpers ───────────────────────────────────────────────────────────────────

function correctedLabel(id: string, lang: "de" | "fr" | "it", raw: string): string {
  return corrections[id]?.[lang] ?? raw;
}

// Relative path from docs/ to packages/svg/svg/{filename} (real files, no symlinks)
function imgSrc(svgFile: string): string {
  // svgFile is like "svg/1101-Beschaedigung.svg" (relative to packages/svg)
  return `../packages/svg/${svgFile}`;
}

function img(src: string, alt: string, size = 48): string {
  return `<img src="${src}" alt="${alt}" width="${size}" height="${size}">`;
}

function symbolRow(sym: Symbol): string {
  const de = correctedLabel(sym.id, "de", sym.label.de);
  const fr = correctedLabel(sym.id, "fr", sym.label.fr);
  const it = correctedLabel(sym.id, "it", sym.label.it);

  let iconCell: string;
  if (sym.identical) {
    // One canonical graphic for all languages — use real svg/ path (not symlink)
    const file = sym.files.de ?? sym.files.fr ?? sym.files.it;
    const src = file ? imgSrc(file.svg) : "";
    iconCell = src ? img(src, de) : "";
  } else {
    // Distinct graphics per language — show all three side by side, using real svg/ paths
    const parts: string[] = [];
    for (const lang of ["de", "fr", "it"] as const) {
      const file = sym.files[lang];
      if (file) {
        const label = lang === "de" ? de : lang === "fr" ? fr : it;
        parts.push(img(imgSrc(file.svg), `${label} (${lang})`));
      }
    }
    iconCell = parts.join(" ");
  }

  return `| ${iconCell} | \`${sym.id}\` | ${de} | ${fr} | ${it} |`;
}

function symbolsTable(symbols: Symbol[]): string {
  const header = "| Icon | ID | DE | FR | IT |\n|---|---|---|---|---|";
  const rows = symbols.map(symbolRow);
  return `${header}\n${rows.join("\n")}`;
}

// ── Generate markdown ─────────────────────────────────────────────────────────

const lines: string[] = [];

// Count total symbols
let totalSymbols = 0;
for (const cat of index.categories) {
  const syms = cat.subcategories
    ? cat.subcategories.flatMap(s => s.symbols)
    : (cat.symbols ?? []);
  totalSymbols += syms.length;
}

lines.push("# BABS Icon Reference");
lines.push("");
lines.push(`${totalSymbols} civil-protection icons across ${index.categories.length} categories.`);
lines.push("Labels in German (DE), French (FR) and Italian (IT).");
lines.push("For divergent icons (different graphic per language) all three variants are shown side by side.");
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

// ── Write output ──────────────────────────────────────────────────────────────

const content = lines.join("\n");
writeFileSync(OUT, content, "utf8");
console.log(`✓ wrote ${OUT} (${content.length.toLocaleString()} bytes, ${totalSymbols} icons)`);
