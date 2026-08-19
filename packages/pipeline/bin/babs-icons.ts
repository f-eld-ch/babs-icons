#!/usr/bin/env node
/**
 * babs-icons — CLI for the BABS icon pipeline.
 *
 * Subcommands:
 *   normalize  [--dir <path>] [--inplace]          Normalize SVGs with Inkscape (local only)
 *   copy-de    <id…> [--dry-run] | --list [--cat n] Copy German graphic to fr/it sources
 *   flatten    [--categories 1,…,9] [--dry-run]    Rebuild packages/svg/ from sources/
 *   sprites    [--check]                            Generate MapLibre sprite sheets
 *   gen-core   [--check]                            Generate @f-eld-ch/babs-core types
 *   gen-react  [--check]                            Generate @f-eld-ch/babs-react icons
 *   verify                                          Semantic invariant checks
 *
 * Pass --help to any subcommand for its own usage.
 *
 * TODO: this stub delegates to individual scripts; future versions will use a
 * proper sub-command router.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src   = join(__dir, "../src");

const [subcommand, ...rest] = process.argv.slice(2);

const scripts: Record<string, string> = {
  normalize: join(src, "normalize.ts"),
  "copy-de": join(src, "copy-de.ts"),
  flatten:   join(src, "flatten.ts"),
  // sprites, gen-core, gen-react, verify: to be implemented
};

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  console.log([
    "Usage: babs-icons <subcommand> [options]",
    "",
    "Subcommands:",
    "  normalize  Normalize SVGs with Inkscape (local only, needs Inkscape)",
    "  copy-de    Copy German graphic to fr/it sources",
    "  flatten    Rebuild packages/svg/ from sources/",
    "  sprites    Generate MapLibre sprite sheets  [not yet implemented]",
    "  gen-core   Generate @f-eld-ch/babs-core     [not yet implemented]",
    "  gen-react  Generate @f-eld-ch/babs-react    [not yet implemented]",
    "  verify     Semantic invariants               [not yet implemented]",
  ].join("\n"));
  process.exit(0);
}

const script = scripts[subcommand];
if (!script) {
  console.error(`Unknown subcommand: ${subcommand}`);
  console.error("Run `babs-icons --help` for usage.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [script, ...rest],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
