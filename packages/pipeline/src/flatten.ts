#!/usr/bin/env node
/**
 * Flatten BABS SVGs across de/fr/it into a single language-aware set.
 *
 * Output layout:
 *   <out>/svg/          real files, one per distinct graphic
 *   <out>/de/           per-language symlinks (filename has no language suffix)
 *   <out>/fr/
 *   <out>/it/
 *   <out>/index.json    hierarchical index with per-language labels + file paths
 *
 * Usage:
 *   node flatten.ts [options]
 *
 * Options:
 *   --out <path>           Output root (default: packages/svg)
 *   --src <path>           Source root (default: sources)
 *   --categories <n,n,…>   Category numbers to include (default: 1,2,3,4,5,6,7,8,9)
 *   --no-dedupe            Write real copies for byte-identical variants (no intra-svg/ symlinks)
 *   --copy                 Write real files everywhere; no symlinks at all (for Windows / zip)
 *   --dry-run              Print the mapping and index summary; do not write anything
 *   --verbose              In dry-run: print all entries. In stats: list every ID per bucket
 */

import {
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  LANGS,
  LANG_SUFFIX,
  type Lang,
  dirNum,
  dirLabel,
  symLabel,
  stem,
  compareNumeric,
} from "./naming.ts";
import {
  indexAll,
  indexPatternsAll,
  allIds,
  hashOf,
  type SourceEntry,
  type PatternVariant,
} from "./source-index.ts";

const PATTERN_VARIANTS = ["a", "b"] as const;

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string, def: string) => {
  const i = args.indexOf(f);
  return i !== -1 ? (args[i + 1] ?? def) : def;
};
const has = (f: string) => args.includes(f);

const OUT_ROOT = flag("--out", "packages/svg");
const SRC_ROOT = flag("--src", "sources");
const CATS_RAW = flag("--categories", "1,2,3,4,5,6,7,8,9");
const ALLOWED = new Set(CATS_RAW.split(",").map((s) => s.trim()));
const NO_DEDUPE = has("--no-dedupe");
const COPY_MODE = has("--copy");
const DRY_RUN = has("--dry-run");
const VERBOSE = has("--verbose");

// ── Write entries ─────────────────────────────────────────────────────────────

interface LangEntry {
  svgFileName: string; // file name inside svg/
  langDirName: string; // file name inside the language dir (no lang suffix)
  isSymlinkInSvg: boolean;
  symlinkTarget?: string; // relative to svg/, set only when isSymlinkInSvg
  sourceEntry: SourceEntry;
}

interface PatternVariantEntry {
  identical: boolean;
  langs: Partial<Record<Lang, LangEntry>>;
}

interface WriteEntry {
  id: string;
  stemName: string;
  identical: boolean;
  presentLangs: Lang[];
  hashes: Partial<Record<Lang, string>>;
  sources: Partial<Record<Lang, SourceEntry>>;
  langs: Partial<Record<Lang, LangEntry>>;
  patterns: Partial<Record<PatternVariant, PatternVariantEntry>>;
}

function buildWriteEntries(): WriteEntry[] {
  const indices = indexAll({ srcRoot: SRC_ROOT, categories: ALLOWED });
  const patternIndices = indexPatternsAll({ srcRoot: SRC_ROOT, categories: ALLOWED });
  // Finding 6 fix: allIds() uses compareNumeric — no localeCompare
  const ids = allIds(indices);
  const entries: WriteEntry[] = [];

  for (const id of ids) {
    const hashes: Partial<Record<Lang, string>> = {};
    const sources: Partial<Record<Lang, SourceEntry>> = {};

    for (const lang of LANGS) {
      const e = indices[lang].get(id);
      if (e) {
        sources[lang] = e;
        hashes[lang] = hashOf(e.path);
      }
    }

    const presentLangs = LANGS.filter((l) => !!hashes[l]);
    if (!presentLangs.length) continue;

    // Prefer de for stemming; fall back to fr, then it (finding 9: de may be absent)
    const stemLang = (["de", "fr", "it"] as const).find((l) => !!sources[l])!;
    // Finding 7 fix: stem() calls symLabel() which strips [DFI]- prefix AND -[DFI] suffix
    const s = stem(sources[stemLang]!.file);
    const unique = new Set(presentLangs.map((l) => hashes[l]));
    const identical = unique.size === 1;

    const we: WriteEntry = {
      id,
      stemName: s,
      identical,
      presentLangs,
      hashes,
      sources,
      langs: {},
      patterns: {},
    };

    if (identical) {
      const base = `${id}.svg`;
      for (const lang of presentLangs) {
        we.langs[lang] = {
          svgFileName: base,
          langDirName: base,
          isSymlinkInSvg: false,
          sourceEntry: sources[lang]!,
        };
      }
    } else {
      const realLang = new Map<Lang, Lang>();
      for (const lang of presentLangs) {
        const first = presentLangs.find((l2) => hashes[l2] === hashes[lang])!;
        realLang.set(lang, first);
      }
      for (const lang of presentLangs) {
        const suf = LANG_SUFFIX[lang];
        const rl = realLang.get(lang)!;
        const realSuf = LANG_SUFFIX[rl];
        const svgFn = `${id}-${suf}.svg`;
        const realFn = `${id}-${realSuf}.svg`;
        const langDir = `${id}.svg`;
        we.langs[lang] = {
          svgFileName: svgFn,
          langDirName: langDir,
          isSymlinkInSvg: rl !== lang && !NO_DEDUPE,
          symlinkTarget: rl !== lang && !NO_DEDUPE ? realFn : undefined,
          sourceEntry: sources[lang]!,
        };
      }
    }

    // Collect pattern variants (if any) for this symbol ID.
    for (const variant of PATTERN_VARIANTS) {
      const varSuffix = variant === "b" ? "-pattern-b" : "-pattern";
      const psrc: Partial<Record<Lang, SourceEntry>> = {};
      const phsh: Partial<Record<Lang, string>> = {};

      for (const lang of LANGS) {
        const pe = patternIndices[lang].get(id)?.[variant];
        if (!pe) continue;
        psrc[lang] = pe;
        phsh[lang] = hashOf(pe.path);
      }

      const presentPatternLangs = LANGS.filter((l) => !!phsh[l]);
      if (!presentPatternLangs.length) continue;

      const pUnique = new Set(presentPatternLangs.map((l) => phsh[l]));
      const pIdentical = pUnique.size === 1;
      const pLangs: Partial<Record<Lang, LangEntry>> = {};

      if (pIdentical) {
        const base = `${id}${varSuffix}.svg`;
        for (const lang of presentPatternLangs) {
          pLangs[lang] = {
            svgFileName: base,
            langDirName: base,
            isSymlinkInSvg: false,
            sourceEntry: psrc[lang]!,
          };
        }
      } else {
        const realLang = new Map<Lang, Lang>();
        for (const lang of presentPatternLangs) {
          const first = presentPatternLangs.find((l2) => phsh[l2] === phsh[lang])!;
          realLang.set(lang, first);
        }
        for (const lang of presentPatternLangs) {
          const suf = LANG_SUFFIX[lang];
          const rl = realLang.get(lang)!;
          const realSuf = LANG_SUFFIX[rl];
          const svgFn = `${id}${varSuffix}-${suf}.svg`;
          const realFn = `${id}${varSuffix}-${realSuf}.svg`;
          const langDir = `${id}${varSuffix}.svg`;
          pLangs[lang] = {
            svgFileName: svgFn,
            langDirName: langDir,
            isSymlinkInSvg: rl !== lang && !NO_DEDUPE,
            symlinkTarget: rl !== lang && !NO_DEDUPE ? realFn : undefined,
            sourceEntry: psrc[lang]!,
          };
        }
      }

      we.patterns[variant] = { identical: pIdentical, langs: pLangs };
    }

    entries.push(we);
  }

  // Finding 5 fix: collision guard that buildPlan() had but was never called.
  // svgFileName includes the ID prefix so collisions are unlikely, but two source
  // files that stem to an identical (id, stemName) would silently overwrite.
  const seen = new Map<string, string>(); // svgFileName → id
  for (const e of entries) {
    for (const lang of LANGS) {
      const le = e.langs[lang];
      if (!le || le.isSymlinkInSvg) continue;
      const prev = seen.get(le.svgFileName);
      if (prev !== undefined && prev !== e.id) {
        throw new Error(`Target collision: svg/${le.svgFileName} from both ${prev} and ${e.id}`);
      }
      seen.set(le.svgFileName, e.id);
    }
    for (const variant of PATTERN_VARIANTS) {
      const pv = e.patterns[variant];
      if (!pv) continue;
      for (const lang of LANGS) {
        const le = pv.langs[lang];
        if (!le || le.isSymlinkInSvg) continue;
        const prev = seen.get(le.svgFileName);
        if (prev !== undefined && prev !== e.id) {
          throw new Error(
            `Pattern target collision: svg/${le.svgFileName} from both ${prev} and ${e.id}`,
          );
        }
        seen.set(le.svgFileName, e.id);
      }
    }
  }

  return entries;
}

// ── Hierarchy (for index.json) ────────────────────────────────────────────────

interface DirMeta {
  num: string;
  names: Partial<Record<Lang, string>>;
}

function buildHierarchy(): { tops: DirMeta[]; subs: Map<string, DirMeta[]> } {
  const tops: DirMeta[] = [];
  const subs = new Map<string, DirMeta[]>();

  for (const lang of LANGS) {
    const root = join(SRC_ROOT, lang);
    let topDirs: string[];
    try {
      topDirs = readdirSync(root).sort();
    } catch {
      continue;
    }

    for (const top of topDirs) {
      const tp = join(root, top);
      try {
        if (!statSync(tp).isDirectory()) continue;
      } catch {
        continue;
      }
      const tn = dirNum(top);
      if (!tn || !ALLOWED.has(tn)) continue;

      let td = tops.find((t) => t.num === tn);
      if (!td) {
        td = { num: tn, names: {} };
        tops.push(td);
      }
      td.names[lang] = dirLabel(top);

      let subDirs: string[];
      try {
        subDirs = readdirSync(tp).sort();
      } catch {
        continue;
      }
      const sdirs = subDirs.filter((e) => {
        try {
          return statSync(join(tp, e)).isDirectory();
        } catch {
          return false;
        }
      });
      if (sdirs.length === 0) continue;
      if (!subs.has(tn)) subs.set(tn, []);
      for (const sd of sdirs) {
        const sn = dirNum(sd);
        if (!sn) continue;
        const key = tn + sn;
        let sd_ = subs.get(tn)!.find((s) => s.num === key);
        if (!sd_) {
          sd_ = { num: key, names: {} };
          subs.get(tn)!.push(sd_);
        }
        sd_.names[lang] = dirLabel(sd);
      }
    }
  }
  return { tops, subs };
}

function buildIndex(entries: WriteEntry[]): object {
  const { tops, subs } = buildHierarchy();

  // Group entries by directory prefix — finding 6 fix: compareNumeric in all sorts
  const symsByPrefix = new Map<string, WriteEntry[]>();
  for (const e of entries) {
    for (const top of tops) {
      const tn = top.num;
      const sub = subs.get(tn);
      let placed = false;
      if (sub) {
        for (const sd of sub) {
          if (e.id.startsWith(sd.num) && !placed) {
            const arr = symsByPrefix.get(sd.num) ?? [];
            arr.push(e);
            symsByPrefix.set(sd.num, arr);
            placed = true;
          }
        }
      } else {
        const prefix = tn + "1";
        if (e.id.startsWith(prefix)) {
          const arr = symsByPrefix.get(prefix) ?? [];
          arr.push(e);
          symsByPrefix.set(prefix, arr);
        }
      }
    }
  }

  function makeSymbol(e: WriteEntry): object {
    const files: Partial<Record<Lang, { lang: string; svg: string }>> = {};
    const labels: Partial<Record<Lang, string>> = {};
    for (const lang of LANGS) {
      const le = e.langs[lang];
      if (!le) continue;
      files[lang] = { lang: `${lang}/${le.langDirName}`, svg: `svg/${le.svgFileName}` };
      // Finding 7 fix: symLabel strips both prefix [DFI]- and suffix -[DFI]
      labels[lang] = symLabel(le.sourceEntry.file);
    }
    const patternsOut: Partial<
      Record<
        PatternVariant,
        { identical: boolean; files: Partial<Record<Lang, { lang: string; svg: string }>> }
      >
    > = {};
    for (const variant of PATTERN_VARIANTS) {
      const pv = e.patterns[variant];
      if (!pv) continue;
      const pvFiles: Partial<Record<Lang, { lang: string; svg: string }>> = {};
      for (const lang of LANGS) {
        const le = pv.langs[lang];
        if (!le) continue;
        pvFiles[lang] = { lang: `${lang}/${le.langDirName}`, svg: `svg/${le.svgFileName}` };
      }
      patternsOut[variant] = { identical: pv.identical, files: pvFiles };
    }
    const result: Record<string, unknown> = {
      id: e.id,
      label: labels,
      identical: e.identical,
      files,
    };
    if (Object.keys(patternsOut).length > 0) result.patterns = patternsOut;
    return result;
  }

  const categories = tops
    .sort((a, b) => compareNumeric(a.num, b.num)) // finding 6 fix
    .map((top) => {
      const tn = top.num;
      const sub = subs.get(tn);
      const base = { number: tn, name: top.names };
      if (!sub) {
        return { ...base, symbols: (symsByPrefix.get(tn + "1") ?? []).map(makeSymbol) };
      }
      return {
        ...base,
        subcategories: sub
          .sort((a, b) => compareNumeric(a.num, b.num)) // finding 6 fix
          .map((sd) => ({
            number: sd.num,
            name: sd.names,
            symbols: (symsByPrefix.get(sd.num) ?? []).map(makeSymbol),
          })),
      };
    });

  return { languages: [...LANGS], categories };
}

// ── Statistics ────────────────────────────────────────────────────────────────

type DivBucket = "ident" | "deDiff" | "frDiff" | "itDiff" | "all3" | "partial";

interface Stats {
  buckets: Record<DivBucket, string[]>;
  edge: Array<{ id: string; pattern: string }>;
  byCat: Map<string, Record<DivBucket | "edge", number>>;
}

function collectStats(entries: WriteEntry[]): Stats {
  const buckets: Record<DivBucket, string[]> = {
    ident: [],
    deDiff: [],
    frDiff: [],
    itDiff: [],
    all3: [],
    partial: [],
  };
  const edge: Stats["edge"] = [];
  const byCat = new Map<string, Record<DivBucket | "edge", number>>();
  const catOf = (id: string) => id[0] ?? "?";
  const bump = (cat: string, key: DivBucket | "edge") => {
    if (!byCat.has(cat))
      byCat.set(cat, { ident: 0, deDiff: 0, frDiff: 0, itDiff: 0, all3: 0, partial: 0, edge: 0 });
    byCat.get(cat)![key]++;
  };

  for (const e of entries) {
    const cat = catOf(e.id);
    const h = e.hashes as Record<Lang, string | undefined>;
    if (e.presentLangs.length < 3) {
      buckets.partial.push(e.id);
      bump(cat, "partial");
      continue;
    }
    if (e.identical) {
      buckets.ident.push(e.id);
      bump(cat, "ident");
      continue;
    }
    const uniq = new Set([h.de, h.fr, h.it]).size;
    if (uniq === 3) {
      buckets.all3.push(e.id);
      bump(cat, "all3");
    } else if (h.fr === h.it) {
      buckets.deDiff.push(e.id);
      bump(cat, "deDiff");
    } else if (h.de === h.it) {
      buckets.frDiff.push(e.id);
      bump(cat, "frDiff");
    } else if (h.de === h.fr) {
      buckets.itDiff.push(e.id);
      bump(cat, "itDiff");
    } else {
      edge.push({ id: e.id, pattern: "2-unique-unknown" });
      bump(cat, "edge");
    }
  }
  return { buckets, edge, byCat };
}

function printStats(entries: WriteEntry[], stats: Stats) {
  const { buckets, edge, byCat } = stats;
  const pad = (n: number) => String(n).padStart(4);
  const ids = (arr: string[]) =>
    arr.length <= 6 ? arr.join(" ") : arr.slice(0, 6).join(" ") + ` … (+${arr.length - 6} more)`;

  console.log(
    `Symbol IDs: ${entries.length}  (categories: ${[...ALLOWED].sort(compareNumeric).join(",")})`,
  );
  console.log(`  identical in all 3: ${pad(buckets.ident.length)}`);
  console.log(`  de differs, fr==it: ${pad(buckets.deDiff.length)}`);
  console.log(`  fr differs, de==it: ${pad(buckets.frDiff.length)}`);
  console.log(`  it differs, de==fr: ${pad(buckets.itDiff.length)}`);
  console.log(`  all 3 differ:       ${pad(buckets.all3.length)}`);
  console.log(`  not in all 3 langs: ${pad(buckets.partial.length)}`);
  if (edge.length) console.log(`  edge cases:         ${pad(edge.length)}`);

  if (byCat.size > 1 || VERBOSE) {
    console.log("\n  Per category:");
    for (const [cat, counts] of [...byCat.entries()].sort()) {
      const parts: string[] = [];
      if (counts.ident) parts.push(`${counts.ident} ident`);
      if (counts.deDiff) parts.push(`${counts.deDiff} de≠`);
      if (counts.frDiff) parts.push(`${counts.frDiff} fr≠`);
      if (counts.itDiff) parts.push(`${counts.itDiff} it≠`);
      if (counts.all3) parts.push(`${counts.all3} all3≠`);
      if (counts.partial) parts.push(`${counts.partial} partial`);
      if (counts.edge) parts.push(`${counts.edge} edge`);
      console.log(`    cat ${cat}: ${parts.join(", ")}`);
    }
  }

  if (buckets.partial.length) {
    console.log(`\n  Not in all 3 langs (${buckets.partial.length}):`);
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const id of buckets.partial) {
      const e = byId.get(id)!;
      console.log(
        `    ${id}  present: [${e.presentLangs.join("+")}]  missing: [${LANGS.filter((l) => !e.presentLangs.includes(l)).join("+")}]`,
      );
    }
  }

  if (edge.length) {
    console.log("\n  Edge cases:");
    for (const { id, pattern } of edge) console.log(`    ${id}  ${pattern}`);
  }

  if (VERBOSE) {
    const show = (label: string, arr: string[]) => {
      if (!arr.length) return;
      console.log(`\n  ${label} (${arr.length}):`);
      for (const id of arr) console.log(`    ${id}`);
    };
    show("identical", buckets.ident);
    show("de differs, fr==it", buckets.deDiff);
    show("fr differs, de==it", buckets.frDiff);
    show("it differs, de==fr", buckets.itDiff);
    show("all 3 differ", buckets.all3);
  } else {
    const showSample = (label: string, arr: string[]) => {
      if (!arr.length) return;
      console.log(`\n  ${label} — sample: ${ids(arr)}`);
    };
    showSample("de differs, fr==it", buckets.deDiff);
    showSample("fr differs, de==it", buckets.frDiff);
    showSample("it differs, de==fr", buckets.itDiff);
    showSample("all 3 differ", buckets.all3);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const entries = buildWriteEntries();
  const stats = collectStats(entries);
  printStats(entries, stats);

  if (DRY_RUN) {
    const limit = VERBOSE ? Infinity : 10;
    console.log(`\n--- DRY RUN ${VERBOSE ? "(all entries)" : "sample (first 10 entries)"} ---`);
    let n = 0;
    for (const e of entries) {
      if (n++ >= limit) break;
      console.log(`  ${e.id}  ${e.identical ? "=" : "≠"}`);
      for (const lang of e.presentLangs) {
        const le = e.langs[lang]!;
        const sym = le.isSymlinkInSvg ? ` -> ${le.symlinkTarget}` : "";
        console.log(`    ${lang}: svg/${le.svgFileName}${sym}  |  ${lang}/${le.langDirName}`);
      }
    }
    console.log("\nDry run done — nothing written.");
    return;
  }

  for (const sub of ["svg", ...LANGS]) {
    const p = join(OUT_ROOT, sub);
    if (existsSync(p)) rmSync(p, { recursive: true });
    mkdirSync(p, { recursive: true });
  }

  let written = 0,
    symlinked = 0;
  const svgDir = join(OUT_ROOT, "svg");

  function writeLangEntry(lang: Lang, le: LangEntry) {
    const svgPath = join(svgDir, le.svgFileName);
    if (!le.isSymlinkInSvg) {
      if (!existsSync(svgPath)) {
        copyFileSync(le.sourceEntry.path, svgPath);
        written++;
      }
    } else {
      if (!existsSync(svgPath)) {
        if (COPY_MODE) {
          copyFileSync(le.sourceEntry.path, svgPath);
          written++;
        } else {
          symlinkSync(le.symlinkTarget!, svgPath);
          symlinked++;
        }
      }
    }
    const langPath = join(OUT_ROOT, lang, le.langDirName);
    if (COPY_MODE) copyFileSync(le.sourceEntry.path, langPath);
    else symlinkSync(`../svg/${le.svgFileName}`, langPath);
  }

  for (const e of entries) {
    for (const lang of e.presentLangs) {
      writeLangEntry(lang, e.langs[lang]!);
    }
    for (const variant of PATTERN_VARIANTS) {
      const pv = e.patterns[variant];
      if (!pv) continue;
      for (const lang of LANGS) {
        const le = pv.langs[lang];
        if (le) writeLangEntry(lang, le);
      }
    }
  }

  // Deterministic JSON: sorted-keys replacer + trailing newline (no tIME-equivalent drift)
  const sortedReplacer = (_: string, v: unknown): unknown =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort())
      : v;
  writeFileSync(
    join(OUT_ROOT, "index.json"),
    JSON.stringify(buildIndex(entries), sortedReplacer, 2) + "\n",
    "utf-8",
  );

  console.log("\nDone.");
  console.log(`  Real files written into svg/: ${written}`);
  if (!COPY_MODE) console.log(`  Symlinks created: ${symlinked} (in svg/) + per-language dirs`);
  console.log(`  Output: ${OUT_ROOT}/`);
}

main();
