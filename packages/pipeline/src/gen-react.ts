#!/usr/bin/env node
// Reads packages/svg/ + index.json and generates packages/react/src/icons/

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { optimize } from "svgo";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const SVG_INDEX = join(ROOT, "packages/svg/index.json");
const CORRECTIONS = join(ROOT, "corrections/labels.json");
const NAMES_LOCK = join(ROOT, "corrections/names.lock.json");
const SVG_DIR = join(ROOT, "packages/svg/svg");
const REACT_ICONS = join(ROOT, "packages/react/src/icons");
const REACT_SRC = join(ROOT, "packages/react/src");
const LANGS = ["de", "fr", "it"] as const;
type Lang = (typeof LANGS)[number];
const LANG_SUFFIX: Record<Lang, string> = { de: "d", fr: "f", it: "i" };

// ── Parse arguments ──────────────────────────────────────────────────────────
const CHECK = process.argv.includes("--check");

// ── Load inputs ──────────────────────────────────────────────────────────────
interface SymEntry { id: string; identical: boolean; label: Record<Lang, string>; files: Record<Lang, { lang: string; svg: string }> }
interface SubcatEntry { number: string; name: Record<Lang, string>; symbols: SymEntry[] }
interface CatEntry { number: string; name: Record<Lang, string>; symbols?: SymEntry[]; subcategories?: SubcatEntry[] }
interface IndexJson { categories: CatEntry[] }

const index = JSON.parse(readFileSync(SVG_INDEX, "utf8")) as IndexJson;
const corrections = JSON.parse(readFileSync(CORRECTIONS, "utf8")) as Record<string, Partial<Record<Lang, string>> & { note?: string }>;
const namesLock = JSON.parse(readFileSync(NAMES_LOCK, "utf8")) as { aliases: Record<string, string> };

// Collect all symbols
const allSymbols: SymEntry[] = [];
for (const cat of index.categories) {
  for (const sym of cat.symbols ?? []) allSymbols.push(sym);
  for (const sub of cat.subcategories ?? []) for (const sym of sub.symbols) allSymbols.push(sym);
}

// ── SVGO config for vector SVGs ───────────────────────────────────────────────
function svgoConfig(prefix: string) {
  return {
    plugins: [
      "removeDoctype", "removeXMLProcInst", "removeComments", "removeMetadata",
      "removeEditorsNSData", "removeTitle", "removeDesc", "cleanupAttrs",
      "removeUselessDefs", "removeEmptyAttrs", "removeEmptyContainers", "removeEmptyText",
      { name: "inlineStyles", params: { onlyMatchedOnce: false, removeMatchedSelectors: true } },
      "convertStyleToAttrs",
      "removeStyleElement",
      { name: "removeAttrs", params: { attrs: ["class"] } },
      "removeHiddenElems",
      { name: "cleanupIds", params: { remove: true, minify: true, force: false } },
      { name: "prefixIds", params: { prefix, prefixClassNames: false } },
      { name: "convertPathData", params: { floatPrecision: 2 } },
      { name: "cleanupNumericValues", params: { floatPrecision: 2 } },
      { name: "convertTransform", params: { floatPrecision: 4 } },
      "collapseGroups", "mergePaths", "convertShapeToPath",
      "removeUnusedNS", "sortAttrs",
    ],
  };
}

// ── SVG → JSX body ─────────────────────────────────────────────────────────────
const ATTR_MAP: Record<string, string | null> = {
  "class": "className",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "enable-background": "enableBackground",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-stretch": "fontStretch",
  "font-style": "fontStyle",
  "font-variant": "fontVariant",
  "font-weight": "fontWeight",
  "letter-spacing": "letterSpacing",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "marker-start": "markerStart",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "word-spacing": "wordSpacing",
  "writing-mode": "writingMode",
  "xlink:href": "href",
  // Removed from inner elements:
  "xml:space": null,
  "xmlns": null,
  "xmlns:xlink": null,
  "version": null,
};

function extractSvgBody(svgStr: string): string {
  // Find end of opening <svg ...> tag (may span multiple lines, find first un-quoted >)
  let i = svgStr.indexOf("<svg");
  if (i === -1) return svgStr;
  let inQuote = false;
  let quoteChar = '"';
  for (i += 4; i < svgStr.length; i++) {
    const c = svgStr[i];
    if (inQuote) {
      if (c === quoteChar) inQuote = false;
    } else if (c === '"' || c === "'") {
      inQuote = true; quoteChar = c;
    } else if (c === ">") { i++; break; }
  }
  const closeIdx = svgStr.lastIndexOf("</svg>");
  return svgStr.slice(i, closeIdx).trim();
}

function renameAttr(name: string): string | null {
  if (name in ATTR_MAP) return ATTR_MAP[name]!;
  return name;
}

// Convert SVG string body to JSX, handling attribute renaming, id references and url()
function convertToJsx(body: string, prefix: string): { jsx: string; usesNs: boolean } {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Ids in SVGO output follow pattern: prefix__originalMinifiedId
  const idRe = new RegExp(`${escapedPrefix}__([\\w-]+)`, "g");

  let usesNs = false;

  // Pass 1: handle url(#prefix__X) inside attribute values
  // These appear as attrName="url(#prefix__localId)" (possibly camelCased later)
  let jsx = body.replace(
    new RegExp(`([\\w:-]+)="url\\(#${escapedPrefix}__([\\w-]+)\\)"`, "g"),
    (_, attrName: string, localId: string) => {
      usesNs = true;
      const jsxAttr = renameAttr(attrName);
      if (!jsxAttr) return "";
      return `${jsxAttr}={\`url(#\${ns("${localId}")})\`}`;
    },
  );

  // Pass 2: handle href="#prefix__X"
  jsx = jsx.replace(
    new RegExp(`([\\w:-]+)="#${escapedPrefix}__([\\w-]+)"`, "g"),
    (_, attrName: string, localId: string) => {
      usesNs = true;
      const jsxAttr = renameAttr(attrName);
      if (!jsxAttr) return "";
      return `${jsxAttr}={\`#\${ns("${localId}")}\`}`;
    },
  );

  // Pass 3: handle id="prefix__X"
  jsx = jsx.replace(
    new RegExp(`id="${escapedPrefix}__([\\w-]+)"`, "g"),
    (_, localId: string) => {
      usesNs = true;
      return `id={ns("${localId}")}`;
    },
  );

  // Pass 4: rename remaining attributes (not already converted by passes 1-3)
  // Match attr="value" patterns and rename the attr part
  jsx = jsx.replace(/\b([\w:-]+)(?==(?:"[^"]*"|'[^']*'|\{[^}]*\}))/g, (_, attrName: string) => {
    const mapped = renameAttr(attrName);
    return mapped ?? "";
  });

  // Pass 5: remove attributes that mapped to null (left blank by renameAttr returning null)
  // These appear as =""..." (empty attr name with value) — clean them up
  jsx = jsx.replace(/\s+=""[^"]*"|\s+='[^']*'|\s+=\{[^}]*\}/g, (m) => {
    // Only remove if it starts with space and empty attr name
    if (m.match(/^\s+="/) || m.match(/^\s+='/)) return "";
    return m;
  });
  // Cleaner: remove empty attribute names
  jsx = jsx.replace(/\s+=""[^"]*"?/g, "");

  // Pass 6: handle style attribute — convert inline style string to JSX object
  jsx = jsx.replace(/\bstyle="([^"]+)"/g, (_, styleStr: string) => {
    const obj = styleStr.split(";").filter(Boolean).map((decl: string) => {
      const [prop, ...vals] = decl.split(":");
      const key = (prop ?? "").trim().replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
      const val = vals.join(":").trim();
      return `${key}: ${JSON.stringify(val)}`;
    }).join(", ");
    return `style={{ ${obj} }}`;
  });

  return { jsx, usesNs };
}

// Post-process for null-mapped attributes — cleaner approach
function removeNullAttrs(jsx: string): string {
  // After renaming, null-mapped attrs produce empty string attr names before =
  // Pattern: empty-string="..." which appears as just ="..."  or standalone =""
  // Actually the regex in pass 4 returns "" for the attr name, leaving ="value"
  // We need to remove those orphaned ="value" fragments
  return jsx
    .replace(/\s+xml:space="[^"]*"/g, "")
    .replace(/\s+xmlns(?::[a-z]+)?="[^"]*"/g, "")
    .replace(/\s+version="[^"]*"/g, "");
}

function preprocessSvg(svg: string): string {
  // Remove non-standard/Inkscape-specific CSS properties from style attributes
  // Match style="..." and strip properties starting with - (vendor-prefixed) or unknown ones
  return svg.replace(/style="([^"]*)"/g, (_, styleStr: string) => {
    const filtered = styleStr
      .split(";")
      .map((d: string) => d.trim())
      .filter((d: string) => {
        if (!d) return false;
        const prop = d.split(":")[0]?.trim() ?? "";
        // Remove properties starting with - or Inkscape-specific ones
        if (prop.startsWith("-") || prop.toLowerCase().includes("inkscape") || prop === "font-specification" || prop === "shape-inside") return false;
        return true;
      })
      .join(";");
    return `style="${filtered}"`;
  });
}

function processVectorSvg(svgContent: string, id: string, lang: Lang): { jsx: string; usesNs: boolean } | null {
  const prefix = `b${id}${LANG_SUFFIX[lang]}`;
  try {
    const result = optimize(preprocessSvg(svgContent), svgoConfig(prefix) as Parameters<typeof optimize>[1]);
    const body = extractSvgBody(result.data);
    const cleaned = removeNullAttrs(body);
    return convertToJsx(cleaned, prefix);
  } catch (e) {
    console.error(`SVGO failed for ${id}/${lang}:`, (e as Error).message);
    return null;
  }
}

// For raster SVGs: minimal processing, extract <image> content
function processRasterSvg(svgContent: string): string {
  // Fix MIME type and xlink:href
  let body = svgContent
    .replace(/data:img\/png;/g, "data:image/png;")
    .replace(/xlink:href=/g, "href=");

  // Strip <svg...> wrapper
  body = extractSvgBody(body);

  // Remove namespace-related attributes
  body = removeNullAttrs(body);
  body = body
    .replace(/\s+xmlns(?::[a-z]+)?="[^"]*"/g, "")
    .replace(/\s+xml:space="[^"]*"/g, "")
    .replace(/\s+id="[^"]*"/g, "")
    .replace(/\s+data-name="[^"]*"/g, "");

  // Remove xlink namespace prefix from any remaining uses
  body = body.replace(/xlink:/g, "");

  return body.trim();
}

// ── Determine which lang files to process per icon ────────────────────────────
function getSvgContent(sym: SymEntry, lang: Lang): string | null {
  const rel = sym.files[lang]?.svg;
  if (!rel) return null;
  const path = join(SVG_DIR, rel.replace(/^svg\//, ""));
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function contentHash(content: string): number {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = Math.imul(31, h) + content.charCodeAt(i) | 0;
  }
  return h;
}

interface LangGraphics { lang: Lang; content: string; isRaster: boolean }

function getLangGraphics(sym: SymEntry): { canonical: Lang; langs: Array<LangGraphics & { aliases: Lang[] }> } {
  if (sym.identical) {
    // Only emit canonical lang; renderer falls back via canonicalLang
    const deContent = getSvgContent(sym, "de");
    const canonical: Lang = deContent ? "de" : getSvgContent(sym, "fr") ? "fr" : "it";
    const content = deContent ?? getSvgContent(sym, "fr") ?? getSvgContent(sym, "it") ?? "";
    return {
      canonical,
      langs: [{ lang: canonical, content, isRaster: content.includes("<image"), aliases: [] }],
    };
  }

  // Non-identical: determine distinct lang files
  const contentMap: Partial<Record<Lang, string>> = {};
  for (const lang of LANGS) {
    contentMap[lang] = getSvgContent(sym, lang) ?? "";
  }

  // Group by content hash
  const hashToLangs = new Map<number, Lang[]>();
  for (const lang of LANGS) {
    const h = contentHash(contentMap[lang] ?? "");
    const existing = hashToLangs.get(h);
    if (existing) existing.push(lang);
    else hashToLangs.set(h, [lang]);
  }

  const canonical: Lang = "de";
  const result: Array<LangGraphics & { aliases: Lang[] }> = [];
  for (const [, langs] of hashToLangs) {
    const primary = langs[0]!;
    const aliases = langs.slice(1);
    const content = contentMap[primary] ?? "";
    result.push({ lang: primary, content, isRaster: content.includes("<image"), aliases });
  }

  return { canonical, langs: result };
}

// ── Generate JSX body string ──────────────────────────────────────────────────
function makeBodyStr(jsxContent: string, usesNs: boolean): string {
  const param = usesNs ? "ns" : "_ns";
  const trimmed = jsxContent.trim();
  // Always wrap in fragment to be safe with multiple root elements
  return `(${param}: (localId: string) => string) => (\n      <>${trimmed}</>\n    )`;
}

// ── Module generation ─────────────────────────────────────────────────────────
const HEADER = `// @generated by packages/pipeline/src/gen-react.ts — do not edit manually\n`;

function genIconModule(sym: SymEntry): string {
  const correctedLabels: Record<Lang, string> = { de: "", fr: "", it: "" };
  for (const lang of LANGS) {
    correctedLabels[lang] = corrections[sym.id]?.[lang] ?? sym.label[lang] ?? "";
  }

  const { canonical, langs } = getLangGraphics(sym);

  // Build graphics entries
  const graphicEntries: string[] = [];
  for (const { lang, content, isRaster, aliases } of langs) {
    let bodyStr: string;
    if (isRaster) {
      const innerJsx = processRasterSvg(content);
      bodyStr = `(_ns: (localId: string) => string) => (\n      <>${innerJsx}</>\n    )`;
    } else {
      const result = processVectorSvg(content, sym.id, lang);
      if (!result) {
        // Fallback: render nothing
        bodyStr = `(_ns) => null`;
      } else {
        bodyStr = makeBodyStr(result.jsx, result.usesNs);
      }
    }

    const kindStr = isRaster ? "raster" : "vector";
    const entry = `    ${JSON.stringify(lang)}: { kind: "${kindStr}", body: ${bodyStr} }`;
    graphicEntries.push(entry);

    // Add alias entries for langs with same content
    for (const alias of aliases) {
      graphicEntries.push(`    ${JSON.stringify(alias)}: { kind: "${kindStr}", body: ${bodyStr} }`);
    }
  }

  // Sort entries to canonical order: de, fr, it
  const orderedEntries = LANGS
    .map(l => graphicEntries.find(e => e.startsWith(`    ${JSON.stringify(l)}`)))
    .filter(Boolean) as string[];

  const labels = `{ de: ${JSON.stringify(correctedLabels.de)}, fr: ${JSON.stringify(correctedLabels.fr)}, it: ${JSON.stringify(correctedLabels.it)} }`;
  const exportName = `babs${sym.id}`;

  return `${HEADER}import type { BabsIconDefinition } from "../types.js";

export const ${exportName}: BabsIconDefinition = {
  id: "${sym.id}",
  viewBox: "0 0 100 100",
  canonicalLang: "${canonical}",
  labels: ${labels},
  recolorable: false,
  displaySize: 32,
  graphics: {
${orderedEntries.join(",\n")}
  },
};
`;
}

// ── Generate barrel files ─────────────────────────────────────────────────────
function genIconsBarrel(syms: SymEntry[]): string {
  const imports = syms.map(s => `export { babs${s.id} } from "./icons/${s.id}.js";`).join("\n");
  return `${HEADER}${imports}\n`;
}

function genNamedBarrel(syms: SymEntry[]): string {
  const lines = syms.map(s => {
    const alias = namesLock.aliases[s.id];
    if (!alias) throw new Error(`gen-react: no alias in names.lock.json for icon ${s.id} — run yarn icons:gen-core first`);
    return `export { babs${s.id} as ${alias} } from "./icons/${s.id}.js";`;
  }).join("\n");
  return `${HEADER}${lines}\n`;
}

function genAllBarrel(syms: SymEntry[]): string {
  const imports = syms.map(s => `import { babs${s.id} } from "./icons/${s.id}.js";`).join("\n");
  const exports = syms.map(s => `  babs${s.id}`).join(",\n");
  return `${HEADER}import type { BabsIconDefinition } from "./types.js";
${imports}

const all: readonly BabsIconDefinition[] = [
${exports}
];
export default all;
`;
}

// ── Write or check ────────────────────────────────────────────────────────────
function writeOrCheck(path: string, content: string, label: string): boolean {
  if (CHECK) {
    if (!existsSync(path)) { console.error(`MISSING: ${label}`); return false; }
    if (readFileSync(path, "utf8") !== content) { console.error(`DRIFT:   ${label}`); return false; }
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return true;
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log(`gen-react: processing ${allSymbols.length} icons...`);

if (!CHECK) {
  // Clean icons dir
  if (existsSync(REACT_ICONS)) rmSync(REACT_ICONS, { recursive: true });
  mkdirSync(REACT_ICONS, { recursive: true });
}

let ok = true;
let vector = 0; let raster = 0;

for (const sym of allSymbols) {
  const content = genIconModule(sym);
  ok = writeOrCheck(join(REACT_ICONS, `${sym.id}.tsx`), content, `icons/${sym.id}.tsx`) && ok;
  const { langs } = getLangGraphics(sym);
  if (langs[0]?.isRaster) raster++; else vector++;
}

ok = writeOrCheck(join(REACT_SRC, "icons.ts"), genIconsBarrel(allSymbols), "icons.ts") && ok;
ok = writeOrCheck(join(REACT_SRC, "named.ts"), genNamedBarrel(allSymbols), "named.ts") && ok;
ok = writeOrCheck(join(REACT_SRC, "all.ts"), genAllBarrel(allSymbols), "all.ts") && ok;

if (CHECK) {
  if (ok) console.log("gen-react: OK (no drift)");
  else process.exit(1);
} else {
  console.log(`gen-react: wrote ${allSymbols.length} modules (${vector} vector, ${raster} raster)`);
}
