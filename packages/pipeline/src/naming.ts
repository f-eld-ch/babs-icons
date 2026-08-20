/**
 * Shared naming utilities for BABS source files.
 * Used by flatten, copy-de, gen-core, gen-react.
 */

export const LANGS = ["de", "fr", "it"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_SUFFIX: Record<Lang, string> = { de: "D", fr: "F", it: "I" };

/** Matches "-pattern.svg" and "-pattern-b.svg" filename suffixes. */
export const PATTERN_RE = /-pattern(-b)?\.svg$/i;

export type PatternVariant = "a" | "b";

/** Returns "a" or "b" for a pattern file, null for a regular symbol file. */
export function patternVariant(f: string): PatternVariant | null {
  const m = f.match(PATTERN_RE);
  if (!m) return null;
  return m[1] ? "b" : "a";
}

/** Extract leading number (e.g. "7a") from a dir name like "7a.Partner…" or "7a Partenaires…" */
export const dirNum = (n: string): string | undefined =>
  (n.match(/^(\d+[a-z]?)[.\s]/) ?? [])[1] as string | undefined;

/** Strip the leading number+separator from a dir name to get the human label */
export const dirLabel = (n: string): string => n.replace(/^\d+[a-z]?[.\s]\s*/, "");

/** Extract leading number from a file name: "01-Foo.svg" or "01.Foo.svg" */
export const fileNum = (f: string): string | undefined =>
  (f.match(/^(\d+[a-z]?)[-.]/) ?? [])[1] as string | undefined;

/**
 * Strip .svg extension, leading ID+separator, and canonical language suffix.
 *
 * Finding 7 fix: strips the language marker as EITHER a prefix ([DFI]-) or
 * a suffix (-[DFI]), since some sources carry it as a prefix:
 *   "D-Beabsichtigte-Erkundung.svg" → "Beabsichtigte-Erkundung"
 *   "1101-Beschaedigung-D.svg"      → "Beschaedigung"
 */
export function symLabel(f: string): string {
  return f
    .replace(/\.svg$/, "")
    .replace(/-pattern(-b)?$/, "") // strip pattern suffix before lang markers
    .replace(/^(\d+[a-z]?)[-.\s]+/, "") // strip leading ID + separator
    .replace(/^[DFI]-/, "") // strip leading lang prefix (finding 7)
    .replace(/-[DFI]$/, ""); // strip trailing lang suffix
}

/** Transliterate to an ASCII-safe stem suitable for use in filenames. */
export function stem(f: string): string {
  let s = symLabel(f);
  // German umlauts
  s = s
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss");
  // Accented letters: NFD-normalise and drop combining marks (U+0300–U+036F)
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Whitespace, commas, apostrophes → empty (jam words together)
  s = s.replace(/[\s,']+/g, "");
  // Collapse hyphens; drop trailing hyphen
  s = s.replace(/-{2,}/g, "-").replace(/-+$/, "");
  // Safety net: drop anything not word-character or hyphen/dot
  return s.replace(/[^A-Za-z0-9._-]/g, "");
}

/**
 * Deterministic numeric-aware string comparison (finding 6 fix).
 * Replaces `localeCompare(undefined, { numeric: true })` which depends on ICU locale.
 *
 * Splits both strings into alternating numeric/non-numeric segments and compares
 * each pair: numeric segments are compared as integers, others lexicographically.
 *
 * compareNumeric("1101", "1102") < 0   ✓
 * compareNumeric("1105a", "1105b") < 0 ✓
 * compareNumeric("9101a", "9101b") < 0 ✓
 */
export function compareNumeric(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const partsA = [...a.matchAll(re)];
  const partsB = [...b.matchAll(re)];
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const pa = partsA[i]?.[0] ?? "";
    const pb = partsB[i]?.[0] ?? "";
    if (pa === pb) continue;
    const na = parseInt(pa, 10);
    const nb = parseInt(pb, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  }
  return 0;
}
