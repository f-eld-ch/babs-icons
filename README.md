# babs-icons

BABS (Bundesamt für Bevölkerungsschutz) publishes a civil-protection symbol set covering 257 icons across 9 categories and 21 groups, with labels in German, French, and Italian (no English). This library packages those icons for use in JavaScript applications: as tree-shakeable React components (`babs-react`), MapLibre GL sprite sheets (`babs-sprites`), plain SVG files (`babs-assets`), and typed metadata (`babs-core`).

## Auth

All packages are published to GitHub Packages under the `@f-eld-ch` scope. Add to `.npmrc` in your project root:

```ini
@f-eld-ch:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

Set `NPM_TOKEN` to a **classic** PAT with the `read:packages` scope. Fine-grained PATs do not work with GitHub Packages.

## Installation

```sh
yarn add @f-eld-ch/babs-core @f-eld-ch/babs-react @f-eld-ch/babs-sprites @f-eld-ch/babs-assets
```

`babs-core` is a peer dependency of `babs-react` — install it explicitly.

## Quick start

### React

```tsx
import { BabsIconProvider, BabsIcon, registerBabsIcons } from "@f-eld-ch/babs-react";
import { babs1101 } from "@f-eld-ch/babs-react/icons";

// For string-form usage, register definitions once at startup.
registerBabsIcons([babs1101]);

function App() {
  return (
    <BabsIconProvider lang={i18n.resolvedLanguage}>
      {/* Static import — zero registry lookup */}
      <BabsIcon icon={babs1101} size={32} />

      {/* String form — requires prior registerBabsIcons call */}
      <BabsIcon icon="1101" size={32} />
    </BabsIconProvider>
  );
}
```

### Vite config (sprite sheets)

```ts
// vite.config.ts
import { babsSprites } from "@f-eld-ch/babs-sprites/vite";

export default {
  plugins: [babsSprites()], // emits to map/sprites/ with unhashed filenames
};
```

## Package index

| Package | Purpose | `sideEffects` | Peers |
|---|---|---|---|
| `@f-eld-ch/babs-core` | Types, metadata, language utilities | `false` | — |
| `@f-eld-ch/babs-react` | React components and context | `false` | `babs-core`, `react >=18` |
| `@f-eld-ch/babs-sprites` | MapLibre sprite sheets + Vite plugin | — | `vite >=5` (optional) |
| `@f-eld-ch/babs-assets` | Optimised SVG files for `<img>` / CSS | — | — |
| `@f-eld-ch/babs-svg` | Raw SVGs + index.json for tooling | — | — |

## Development setup

Requires Node.js ≥ 16.9 (includes Corepack) and Yarn 4 via Corepack:

```sh
corepack enable
yarn install
```

## Repo layout

```
babs-icons/
  corrections/          manual label fixes and alias overrides
    labels.json         corrected German labels; pipeline detects orphans
    aliases.json        human-readable export aliases
  packages/
    core/               types, metadata, language helpers
    react/              BabsIcon component, BabsIconProvider context
    sprites/            sprite sheets (dist/) + Vite plugin (src/vite.ts)
    assets/             optimised SVGs + assetUrl() helper
    svg/                flat SVG files + index.json (source of truth)
    pipeline/           private code-generator (not published)
  sources/              upstream SVG sources, per-language (de/fr/it)
```

The `packages/svg/` directory is the single source of truth consumed by `pipeline`. Everything under `packages/core/src/generated/` and `packages/react/src/icons/` is generated — do not edit by hand.

## Pipeline commands

| Script | What it does | CI-safe? |
|---|---|---|
| `yarn icons:check` | Verifies all generated outputs are up to date without writing | Yes |
| `yarn icons:rebuild` | Re-generates core, react, and sprites from `packages/svg/` | Yes |
| `yarn icons:flatten` | Re-flattens `sources/` into `packages/svg/` | Yes |
| `yarn icons:ingest` | Normalises `sources/` with Inkscape, then rebuilds | **No** |
| `yarn icons:source:trace` | Traces raster sources to SVG with potrace | **No** |
| `yarn icons:sprites` | Generates sprite sheets only | Yes |
| `yarn icons:gen-core` | Generates `babs-core` metadata | Yes |
| `yarn icons:gen-react` | Generates `babs-react` icon definitions | Yes |
| `yarn icons:verify` | Runs semantic invariant checks | Yes |
| `yarn icons:docs` | Regenerates `docs/icons.md` icon reference | Yes |
| `yarn build` | Builds all packages | Yes |
| `yarn typecheck` | Type-checks all packages | Yes |

`icons:ingest` and `icons:source:trace` modify `sources/` and must not run in CI.

## Icon reference

**[docs/icons.md](docs/icons.md)** — all 257 icons with inline previews, grouped by category and subcategory, with labels in DE / FR / IT.

Regenerate after adding or modifying icons:

```sh
yarn icons:docs
```

## Per-package documentation

- [`packages/core/README.md`](packages/core/README.md)
- [`packages/react/README.md`](packages/react/README.md)
- [`packages/sprites/README.md`](packages/sprites/README.md)
- [`packages/assets/README.md`](packages/assets/README.md)
- [`packages/svg/README.md`](packages/svg/README.md)
- [`packages/pipeline/README.md`](packages/pipeline/README.md)
