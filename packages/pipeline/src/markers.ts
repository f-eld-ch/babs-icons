#!/usr/bin/env node
// Marker manifest loader, SVG reader, and in-memory recolourer.
// Markers are sprite-only graphics with no BABS catalogue id, no language variant,
// and no React export. They live in markers/ at the repo root.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareNumeric } from "./naming.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const MARKERS_DIR = join(ROOT, "markers");
const MARKERS_JSON = join(MARKERS_DIR, "markers.json");
const SVG_DIR = join(MARKERS_DIR, "svg");

// ── Types ─────────────────────────────────────────────────────────────────────

export type MarkerMode = "icon" | "pattern";

export interface MarkerDef {
  src: string;
  mode: MarkerMode;
  recolor?: Record<string, string>;
  note?: string;
}

export interface Marker {
  id: string;
  /** Sprite key: "marker-" + id */
  key: string;
  src: string;
  absPath: string;
  mode: MarkerMode;
  recolor?: Record<string, string>;
}

interface MarkerManifest {
  _comment?: string;
  version: number;
  markers: Record<string, MarkerDef>;
}

// ── Validation helpers ────────────────────────────────────────────────────────

const KEBAB_RE = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;
const PATTERN_SUFFIX_RE = /-pattern(-b)?$/;
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const COLOUR_ATTRS = new Set([
  "fill",
  "stroke",
  "stop-color",
  "flood-color",
  "lighting-color",
  "color",
  "solid-color",
]);
const FUNCTIONAL_RE = /\b(rgb|rgba|hsl|hsla|var|color-mix)\s*\(/i;
const ALLOWED_KEYWORD_RE = /^(none|currentcolor|inherit|transparent)$|^url\(/i;

/**
 * Parse the width and height from a viewBox attribute ("x y w h").
 * Returns [w, h] or null if not present / unparseable.
 */
function parseViewBox(svg: string): [number, number] | null {
  const m = svg.match(/viewBox="([^"]+)"/);
  if (!m) return null;
  const parts = m[1]!
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length < 4) return null;
  const w = parts[2];
  const h = parts[3];
  if (w === undefined || h === undefined || isNaN(w) || isNaN(h)) return null;
  return [w, h];
}

/**
 * Throw if the SVG uses any colour form that can't be handled by a literal
 * hex attribute-scoped rewrite:
 *   - <style> blocks
 *   - style="" attributes
 *   - functional notation (rgb(), hsl(), var(), color-mix())
 *   - named colours or bare keywords in colour presentation attributes
 */
export function assertCanonicalColors(svg: string, file: string): void {
  if (/<style[\s>]/i.test(svg)) {
    throw new Error(`marker ${file}: contains <style> — use plain presentation attributes`);
  }
  if (/\bstyle\s*=/i.test(svg)) {
    throw new Error(`marker ${file}: contains style="" — use plain presentation attributes`);
  }
  if (FUNCTIONAL_RE.test(svg)) {
    throw new Error(`marker ${file}: contains functional colour notation — use hex literals`);
  }

  // Walk every colour presentation attribute value
  const attrRe = /\b([a-z-]+)\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(svg)) !== null) {
    const attr = m[1]!.toLowerCase();
    if (!COLOUR_ATTRS.has(attr)) continue;
    const val = m[2]!.trim().toLowerCase();
    if (!val) continue;
    if (ALLOWED_KEYWORD_RE.test(val)) continue;
    if (HEX_COLOR_RE.test(val)) continue;
    throw new Error(
      `marker ${file}: attribute "${attr}" has non-hex colour "${val}" — use hex literal or none/currentColor/inherit/transparent/url(…)`,
    );
  }
}

/**
 * Normalise a 3-digit hex to 6-digit: "#00f" → "#0000ff".
 * Leaves 6-digit values unchanged.
 */
function expand3(hex: string): string {
  const s = hex.toLowerCase();
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return s;
}

/**
 * Rewrite colours in SVG presentation attributes according to `rules`.
 * Rules are { "#src": "#dst" }; both sides are normalised to 6-digit hex.
 * Throws if any rule matches nothing — that would publish a sprite identical to its base.
 */
export function recolorSvg(svg: string, rules: Record<string, string>, file: string): string {
  // Normalise rules keys and values to 6-digit lowercase hex
  const normRules: Array<{ from: string; to: string; hits: number }> = Object.entries(rules).map(
    ([from, to]) => ({ from: expand3(from), to: expand3(to), hits: 0 }),
  );

  // Replace only inside presentation attributes (fill="…", stroke="…", etc.)
  let result = svg;
  for (const rule of normRules) {
    const attrRe = new RegExp(`(\\b(?:${[...COLOUR_ATTRS].join("|")})\\s*=\\s*")([^"]*)(")`, "gi");
    result = result.replace(attrRe, (_match, pre, val, post) => {
      const norm = expand3(val.trim());
      if (norm === rule.from) {
        rule.hits++;
        return `${pre}${rule.to}${post}`;
      }
      return `${pre}${val}${post}`;
    });
  }

  const zero = normRules.filter((r) => r.hits === 0);
  if (zero.length > 0) {
    throw new Error(
      `recolor rule(s) ${zero.map((r) => r.from).join(", ")} matched nothing in ${file} — ` +
        `stale rule would publish a sprite identical to its base`,
    );
  }

  return result;
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Load and validate all markers from markers/markers.json.
 * Returns markers sorted by id (compareNumeric order, same as allPatternKeys).
 * Throws on any validation error — malformed manifest, bad id, missing file, non-square viewBox.
 */
export function loadMarkers(): Marker[] {
  if (!existsSync(MARKERS_JSON)) {
    throw new Error(`markers/markers.json not found at ${MARKERS_JSON}`);
  }
  const manifest = JSON.parse(readFileSync(MARKERS_JSON, "utf8")) as MarkerManifest;

  const markers: Marker[] = [];
  for (const [id, def] of Object.entries(manifest.markers)) {
    // id must be kebab-case
    if (!KEBAB_RE.test(id)) {
      throw new Error(`marker id "${id}" is not kebab-case`);
    }
    // id must not end with -pattern or -pattern-b (regex hazard in sprites.ts)
    if (PATTERN_SUFFIX_RE.test(id)) {
      throw new Error(
        `marker id "${id}" ends with "-pattern" or "-pattern-b" — this would collide with PATTERN_KEY_RE in sprites.ts`,
      );
    }
    // src is required
    if (!def.src) {
      throw new Error(`marker "${id}": missing "src" field`);
    }
    // mode must be known
    if (def.mode !== "icon" && def.mode !== "pattern") {
      throw new Error(
        `marker "${id}": unknown mode "${String(def.mode)}" — expected "icon" or "pattern"`,
      );
    }
    // recolor values must be hex
    if (def.recolor) {
      for (const [from, to] of Object.entries(def.recolor)) {
        if (!HEX_COLOR_RE.test(from))
          throw new Error(`marker "${id}": recolor key "${from}" is not a hex colour`);
        if (!HEX_COLOR_RE.test(to))
          throw new Error(`marker "${id}": recolor value "${to}" is not a hex colour`);
      }
    }

    const absPath = join(SVG_DIR, def.src);
    if (!existsSync(absPath)) {
      throw new Error(`marker "${id}": src file not found: ${absPath}`);
    }

    // Validate viewBox is square
    const svgContent = readFileSync(absPath, "utf8");
    const vb = parseViewBox(svgContent);
    if (!vb) {
      throw new Error(`marker "${id}" (${def.src}): no readable viewBox attribute`);
    }
    const [w, h] = vb;
    if (Math.abs(w - h) > 0.001) {
      throw new Error(
        `marker "${id}" (${def.src}): viewBox is not square (${w}×${h}) — rasterize uses fit:"fill" and would silently stretch`,
      );
    }

    markers.push({
      id,
      key: `marker-${id}`,
      src: def.src,
      absPath,
      mode: def.mode,
      recolor: def.recolor,
    });
  }

  markers.sort((a, b) => compareNumeric(a.id, b.id));
  return markers;
}

/**
 * Read a marker's SVG, validate its colours, and apply any recolour rules.
 * Returns the (possibly recoloured) SVG string.
 */
export function markerSvg(m: Marker): string {
  const svg = readFileSync(m.absPath, "utf8");
  assertCanonicalColors(svg, m.src);
  if (m.recolor && Object.keys(m.recolor).length > 0) {
    return recolorSvg(svg, m.recolor, m.src);
  }
  return svg;
}

// ── Self-check (import.meta.main) ─────────────────────────────────────────────
// Run with: node --experimental-strip-types packages/pipeline/src/markers.ts

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const markers = loadMarkers();
    console.log(`markers: loaded ${markers.length} marker(s)`);
    for (const m of markers) {
      const svg = markerSvg(m);
      console.log(
        `  ${m.key}  src=${m.src}  mode=${m.mode}  svgLen=${svg.length}  recolor=${JSON.stringify(m.recolor ?? null)}`,
      );
    }
    console.log("markers: all OK");
  } catch (e) {
    console.error(`markers: ERROR — ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
