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
import { dirNum, fileNum, type Lang, LANGS, compareNumeric } from "./naming.ts";

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

/**
 * Walk one language directory and return a composite-id → SourceEntry map.
 * Finding 5 note: indexLang itself does not check for ID collisions; that is
 * the responsibility of buildWriteEntries() after all indices are built.
 */
export function indexLang(lang: Lang, opts: IndexOptions): Map<string, SourceEntry> {
  const root = join(opts.srcRoot, lang);
  const out  = new Map<string, SourceEntry>();

  for (const top of readdirSync(root).sort()) {
    const tp = join(root, top);
    if (!statSync(tp).isDirectory()) continue;
    const tn = dirNum(top);
    if (!tn) continue;
    if (opts.categories && !opts.categories.has(tn)) continue;

    const ents = readdirSync(tp).sort();
    const subs = ents.filter(e => statSync(join(tp, e)).isDirectory());

    if (subs.length === 0) {
      // Flat category: subDirNum = "1"
      for (const f of ents.filter(e => e.endsWith(".svg"))) {
        const fn = fileNum(f);
        if (!fn) continue;
        const id = tn + "1" + fn;
        const path = join(tp, f);
        out.set(id, { path, file: f, relPath: join(lang, top, f) });
      }
    } else {
      for (const sd of subs) {
        const sn = dirNum(sd);
        if (!sn) continue;
        for (const f of readdirSync(join(tp, sd)).sort().filter(e => e.endsWith(".svg"))) {
          const fn = fileNum(f);
          if (!fn) continue;
          const id = tn + sn + fn;
          const path = join(tp, sd, f);
          out.set(id, { path, file: f, relPath: join(lang, top, sd, f) });
        }
      }
    }
  }
  return out;
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
