# @f-eld-ch/babs-pipeline

Internal code generator for the babs-icons monorepo. This package is private and not published to npm. It reads upstream SVG sources and produces the contents of `babs-svg`, `babs-core`, `babs-react`, and `babs-sprites`.

## Prerequisites

| Tool | Version | Required for |
|---|---|---|
| Node.js | 24+ | All subcommands |
| Inkscape | any recent | `icons:ingest` (normalize/trace only) |
| potrace | any recent | `icons:source:trace` only |

## Subcommands

All commands are run from the monorepo root with `yarn`.

| Command | Flags | CI-safe | Description |
|---|---|---|---|
| `yarn icons:flatten` | — | Yes | Re-flattens `sources/de`, `sources/fr`, `sources/it` into `packages/svg/` with a fresh `index.json` |
| `yarn icons:sprites` | `--check` | Yes | Generates sprite sheets in `packages/sprites/dist/`; `--check` verifies without writing |
| `yarn icons:gen-core` | `--check` | Yes | Generates `packages/core/src/generated/`; `--check` verifies without writing |
| `yarn icons:gen-react` | `--check` | Yes | Generates `packages/react/src/icons/`; `--check` verifies without writing |
| `yarn icons:verify` | — | Yes | Runs semantic invariant checks over all generated outputs |
| `yarn icons:rebuild` | — | Yes | `flatten` + `sprites` + `gen-core` + `gen-react` + `verify` in order |
| `yarn icons:check` | — | Yes | Verifies all generated outputs are up to date without writing anything |
| `yarn icons:ingest` | — | **No** | Normalises `sources/` with Inkscape then rebuilds; modifies source files |
| `yarn icons:source:trace` | — | **No** | Traces raster source files to SVG using potrace; modifies source files |
| `yarn icons:source:copy-de` | — | Yes | Copies German graphics to fr/it for icons that are language-neutral |

`icons:ingest` and `icons:source:trace` modify files under `sources/` and must never run in CI.

## Developer workflow: adding a new icon

1. Place the source SVG(s) in `sources/de/` (and `sources/fr/`, `sources/it/` if the graphic differs by language). File names must follow the existing convention: `{id}-{GermanLabel}.svg`.

2. If the source is a raster scan, run `yarn icons:source:trace` to convert it to SVG, then inspect the output.

3. Run `yarn icons:ingest` to normalise the SVG to a 100×100 viewBox (requires Inkscape) and re-generate all derived files. This modifies `sources/`.

4. If the label requires correction (typo, missing umlaut, hyphenated label), add an entry to `corrections/labels.json`:
   ```json
   "8206": { "de": "Bach ausgetrocknet", "note": "source typo: 'ausgetroknet'" }
   ```

5. Run `yarn icons:rebuild` to apply corrections and regenerate.

6. Run `yarn icons:verify` to confirm all invariants pass.

7. Run `yarn build` and `yarn typecheck` before committing.

## Markers

`markers/markers.json` is a hand-authored manifest of sprite-only graphics that appear in the sprite sheets (`babs-de`, `babs-fr`, `babs-it`) but never as React components, exported SVGs, or catalogue entries. Each marker has a bare id (describing shape and colour, not use-case), a source SVG in `markers/svg/`, a mode (`icon` or `pattern`), and an optional `recolor` map for colour variants derived in-memory with no duplicate file.

```
markers/
  markers.json          manifest — id, src, mode, optional recolour rules
  svg/
    chevron-blue.svg    vendored source geometry (not processed by normalize.ts)
    double-chevron-blue.svg
```

Sprite keys are `marker-<id>` (e.g. `marker-chevron-blue`). Build keys with `markerSpriteKey(id)` from `@f-eld-ch/babs-core` rather than string concatenation. See [docs/markers.md](../../docs/markers.md) for the full reference.

**Adding a marker:** add 3–7 lines to `markers/markers.json` (plus an SVG if the geometry is new), then run `yarn icons:rebuild && yarn icons:verify`. A colour-derived variant (like `chevron-red`) needs only the manifest entry — no SVG.

**`markers/` is intentionally not under `sources/`** — `normalize.ts`/`icons:ingest` would overwrite the authored viewBox geometry. It is also not under `packages/svg/` — `flatten.ts` deletes subdirectories. Root `markers/` is a hand-maintained pipeline input like `corrections/`.

## Corrections layer

`corrections/labels.json` contains manual overrides for German labels where the upstream source had typos, hyphens, or missing umlauts. Each entry is:

```json
{
  "1234": { "de": "Corrected Label", "note": "reason for correction" }
}
```

The `note` field is optional but recommended. The pipeline (`icons:verify`) checks for orphaned entries — IDs in `corrections/labels.json` that no longer exist in `index.json`. A failing orphan check means an icon was removed or renamed without updating the corrections file.

`corrections/aliases.json` provides manual overrides for the human-readable export alias of specific icons (e.g. `"4701": "babsPartnerP"`). Use it when the auto-derived name is weak or incorrect. The file is a flat `id → name` map.

`corrections/names.lock.json` is the **append-only record** of every assigned alias. `gen-core.ts` reads it on every run: if an id already has a locked entry, that name is used verbatim regardless of the current label — so fixing a German label never silently renames a published export. New ids are assigned and appended automatically. The lock must be committed alongside the generated files.

Resolution order (highest priority first): locked name → `aliases.json` manual override → name derived from the German label.

**Renaming a published alias** requires a two-step edit: (1) note the old name in `corrections/names.lock.json` under `retired`, (2) add the new name to `corrections/aliases.json`, then re-run `yarn icons:gen-core`.

The numeric export (`babs<id>`, from `@f-eld-ch/babs-react/icons`) is permanently stable. Human-readable aliases (from `@f-eld-ch/babs-react/named`) are frozen on first publication and may only change on a major version.

## rebuild vs ingest vs check

| Command | Reads from | Writes to | Touches sources? |
|---|---|---|---|
| `icons:check` | `packages/svg/` | Nothing | No |
| `icons:rebuild` | `packages/svg/` | `packages/core/`, `packages/react/`, `packages/sprites/` | No |
| `icons:ingest` | `sources/` | `sources/`, then everything rebuild writes | **Yes** |

Use `icons:check` in CI to assert generated files are committed. Use `icons:rebuild` when you have already modified `packages/svg/` directly (e.g. after running `icons:flatten` by hand). Use `icons:ingest` only locally when adding or updating source SVGs.

## Note on normalize and trace

`normalize.ts` calls Inkscape as a subprocess to crop each SVG to its drawing bounds (`--export-area-drawing`) before SVGO centres and squares the content. `trace.ts` calls potrace to convert a raster image to SVG paths. Both tools must be on `PATH`. They write back to `sources/` and are destructive — run them only after committing or stashing the current state of `sources/`.
