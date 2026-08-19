#!/usr/bin/env node
/**
 * Copy German source SVG content to the corresponding French and Italian source files.
 *
 * Workflow:
 *   1. Edit a file in sources/de/
 *   2. Run: node copy-de.ts <id1> [id2 ...]
 *   3. sources/fr/ and sources/it/ source files for those IDs now carry the de content
 *   4. Re-run `babs-icons flatten` to regenerate packages/svg/
 *
 * The fr/it source filenames are kept as-is (translated names stay); only the
 * file content is replaced. The flatten step will then detect them as identical.
 *
 * Usage:
 *   node copy-de.ts <id1> [id2 ...] [--dry-run]
 *   node copy-de.ts --list [--cat <prefix>]
 *
 * Options:
 *   --dry-run      Show what would be overwritten without touching any files
 *   --list         List all IDs that have a de source and diverge from fr or it
 *   --cat <n>      Filter --list to a category prefix (e.g. --cat 3)
 *   --src <path>   Source root (default: sources)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { indexAll, allIds, hashOf } from "./source-index.ts";
import { LANGS } from "./naming.ts";

// ── Args ──────────────────────────────────────────────────────────────────────

const argv    = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const LIST    = argv.includes("--list");
const getArg  = (flag: string) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
const catFilter = getArg("--cat");
const SRC     = getArg("--src") ?? "sources";
// IDs: positional args (not flags and not the value of a flag)
const flagNames = new Set(["--src", "--cat"]);
const ids = argv.filter((a, i) => !a.startsWith("--") && (i === 0 || !flagNames.has(argv[i - 1]!)));

// ── Index all languages ───────────────────────────────────────────────────────

// No category filter in copy-de — we list/copy any ID found in de.
// (The old copy-de.ts had no category filter either, which caused a silent
//  divergence from flatten: it would report IDs flatten never emits.
//  Intentional here: copy-de should work on any source ID regardless of whether
//  that category is currently included in the flatten run.)
const indices = indexAll({ srcRoot: SRC });
const sortedIds = allIds(indices);

// ── --list mode ───────────────────────────────────────────────────────────────

if (LIST) {
  const rows: Array<{ id: string; label: string; pattern: string }> = [];

  for (const id of sortedIds) {
    if (catFilter && !id.startsWith(catFilter)) continue;
    if (!indices.de.has(id)) continue;

    const hashes: Partial<Record<string, string>> = {};
    for (const lang of LANGS) {
      const e = indices[lang].get(id);
      if (e) hashes[lang] = hashOf(e.path);
    }
    const present = LANGS.filter(l => !!hashes[l]);
    const unique  = new Set(Object.values(hashes)).size;
    if (unique === 1 && present.length === 3) continue; // already identical in all 3

    let pattern: string;
    if (present.length < 3) {
      const missing = LANGS.filter(l => !hashes[l]);
      pattern = `missing: [${missing.join(",")}]`;
    } else if (hashes.fr === hashes.it) {
      pattern = "de≠  fr=it";
    } else if (hashes.de === hashes.it) {
      pattern = "fr≠  de=it";
    } else if (hashes.de === hashes.fr) {
      pattern = "it≠  de=fr";
    } else {
      pattern = "all3≠";
    }

    const label = indices.de.get(id)!.file
      .replace(/\.svg$/, "")
      .replace(/^(\d+[a-z]?)[-.\s]+/, "")
      .replace(/^[DFI]-/, "")   // finding 7 fix: strip prefix lang marker
      .replace(/-[DFI]$/, "");
    rows.push({ id, label, pattern });
  }

  if (!rows.length) {
    console.log(`No divergent IDs with German source${catFilter ? ` in category ${catFilter}` : ""}.`);
    process.exit(0);
  }

  const col1 = Math.max(...rows.map(r => r.id.length), 4);
  const col2 = Math.max(...rows.map(r => r.label.length), 10);
  console.log(`${"ID".padEnd(col1)}  ${"Label (de)".padEnd(col2)}  Pattern`);
  console.log("-".repeat(col1 + col2 + 12));
  for (const { id, label, pattern } of rows) {
    console.log(`${id.padEnd(col1)}  ${label.padEnd(col2)}  ${pattern}`);
  }
  console.log(`\n${rows.length} divergent IDs${catFilter ? ` in category ${catFilter}` : ""}`);
  process.exit(0);
}

// ── Copy mode ─────────────────────────────────────────────────────────────────

if (!ids.length) {
  console.error([
    "Usage:",
    "  node copy-de.ts <id1> [id2 ...] [--dry-run]",
    "  node copy-de.ts --list [--cat <prefix>]",
  ].join("\n"));
  process.exit(1);
}

let changed = 0, skipped = 0;

for (const id of ids) {
  const deEntry = indices.de.get(id);
  if (!deEntry) {
    console.error(`${id}: no German source file found`);
    skipped++;
    continue;
  }

  const deContent = readFileSync(deEntry.path);
  const deHash    = hashOf(deEntry.path);
  console.log(`\n${id}  ${deEntry.file}`);
  console.log(`  de: ${deEntry.path}`);

  let anyChange = false;
  for (const lang of ["fr", "it"] as const) {
    const entry = indices[lang].get(id);
    if (!entry) {
      console.log(`  ${lang}: no source file — skipping`);
      continue;
    }
    if (hashOf(entry.path) === deHash) {
      console.log(`  ${lang}: already identical — ${entry.file}`);
      continue;
    }
    console.log(`  ${lang}: overwrite ${entry.path}  (was: ${entry.file})`);
    if (!DRY_RUN) writeFileSync(entry.path, deContent);
    anyChange = true;
  }

  if (anyChange) changed++;
  else { console.log("  (nothing to change)"); skipped++; }
}

console.log(
  `\nDone — ${changed} IDs updated, ${skipped} skipped` +
  (DRY_RUN ? "  [dry run, nothing written]" : ""),
);
if (!DRY_RUN && changed > 0) {
  console.log("Re-run `babs-icons flatten` to regenerate packages/svg/");
}
