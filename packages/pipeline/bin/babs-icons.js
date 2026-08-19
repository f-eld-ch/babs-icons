#!/usr/bin/env node
// Thin wrapper so yarn can link this as an executable bin.
// Node 22.6+ strips TypeScript types natively; no build step needed.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const __dir = dirname(fileURLToPath(import.meta.url));
const tsEntry = join(__dir, "babs-icons.ts");

const result = spawnSync(process.execPath, [tsEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
