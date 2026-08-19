/**
 * Walk the BABS source directories and build composite-id → source-entry maps.
 *
 * Composite ID scheme (mirrors flatten-svgs original logic):
 *   topDirNum + subDirNum + fileNum
 *   e.g. top="1.Auswirkungen", sub="11.Beschaedigungen", file="01-Foo.svg" → "1101"
 *   Flat categories (no subdirectory): topDirNum + "1" + fileNum → e.g. "411"
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { dirNum, fileNum, type Lang, LANGS, compareNumeric, PATTERN_RE, type PatternVariant, patternVariant } from "./naming.ts";
export type { PatternVariant };

export type { Lang };

export interface SourceEntry {
  /** Absolute or cwd-relative path to the .svg file */
  path: string;
  /** Filename only, e.g. "01-Beschaedigung-D.svg" */
  file: string;
  /** Relative path from srcRoot, used as the key in ids.lock.json */
  relPath: string;
}

export interface IndexOptions {
  /** Root directory of all three language trees, e.g. "sources" */
  srcRoot: string;
  /**
   * Category numbers to include, e.g. new Set(["1","2","3"]).
   * If omitted, all categories found on disk are included.
   */
  categories?: Set<string>;
}

interface RawEntry {
  id: string;
  file: string;
  path: string;
  relPath: string;
}

/** Walk one language tree and yield every .svg entry with its composite ID. */
function* walkLang(lang: Lang, opts: IndexOptions): Generator<RawEntry> {
  const root = join(opts.srcRoot, lang);

  for (const top of readdirSync(root).sort()) {
    const tp = join(root, top);
    if (!statSync(tp).isDirectory()) continue;
    const tn = dirNum(top);
    if (!tn) continue;
    if (opts.categories && !opts.categories.has(tn)) continue;

    const ents = readdirSync(tp).sort();
    const subs = ents.filter(e => statSync(join(tp, e)).isDirectory());

    if (subs.length === 0) {
      for (const f of ents.filter(e => e.endsWith(".svg"))) {
        const fn = fileNum(f);
        if (!fn) continue;
        yield { id: tn + "1" + fn, file: f, path: join(tp, f), relPath: join(lang, top, f) };
      }
    } else {
      for (const sd of subs) {
        const sn = dirNum(sd);
        if (!sn) continue;
        for (const f of readdirSync(join(tp, sd)).sort().filter(e => e.endsWith(".svg"))) {
          const fn = fileNum(f);
          if (!fn) continue;
          yield { id: tn + sn + fn, file: f, path: join(tp, sd, f), relPath: join(lang, top, sd, f) };
        }
      }
    }
  }
}

/**
 * Walk one language directory and return a composite-id → SourceEntry map.
 * Pattern files (-pattern.svg, -pattern-b.svg) are excluded — use indexPatterns().
 * Finding 5 note: indexLang itself does not check for ID collisions; that is
 * the responsibility of buildWriteEntries() after all indices are built.
 */
export function indexLang(lang: Lang, opts: IndexOptions): Map<string, SourceEntry> {
  const out = new Map<string, SourceEntry>();
  for (const e of walkLang(lang, opts)) {
    if (PATTERN_RE.test(e.file)) continue;
    out.set(e.id, { path: e.path, file: e.file, relPath: e.relPath });
  }
  return out;
}

/**
 * Walk one language directory and return a map of
 * composite-id → { "a"?: SourceEntry, "b"?: SourceEntry }
 * containing only pattern files.
 */
export function indexPatterns(lang: Lang, opts: IndexOptions): Map<string, Partial<Record<PatternVariant, SourceEntry>>> {
  const out = new Map<string, Partial<Record<PatternVariant, SourceEntry>>>();
  for (const e of walkLang(lang, opts)) {
    const variant = patternVariant(e.file);
    if (!variant) continue;
    const existing = out.get(e.id) ?? {};
    existing[variant] = { path: e.path, file: e.file, relPath: e.relPath };
    out.set(e.id, existing);
  }
  return out;
}

/** Build pattern indices for all three languages in one call. */
export function indexPatternsAll(opts: IndexOptions): Record<Lang, Map<string, Partial<Record<PatternVariant, SourceEntry>>>> {
  return {
    de: indexPatterns("de", opts),
    fr: indexPatterns("fr", opts),
    it: indexPatterns("it", opts),
  };
}

/** Build indices for all three languages in one call. */
export function indexAll(opts: IndexOptions): Record<Lang, Map<string, SourceEntry>> {
  return {
    de: indexLang("de", opts),
    fr: indexLang("fr", opts),
    it: indexLang("it", opts),
  };
}

/**
 * Return the union of all IDs across all three language indices,
 * sorted in deterministic numeric order (no localeCompare).
 */
export function allIds(indices: Record<Lang, Map<string, SourceEntry>>): string[] {
  return [...new Set([
    ...indices.de.keys(),
    ...indices.fr.keys(),
    ...indices.it.keys(),
  ])].sort(compareNumeric);
}

/** MD5 hash of a file's contents. Used to detect byte-identical graphics. */
export function hashOf(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}
