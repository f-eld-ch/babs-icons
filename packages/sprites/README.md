# @f-eld-ch/babs-sprites

Per-language MapLibre GL sprite sheets for the BABS civil-protection icon set.

## What's in the package

Six pre-built sprite files — one JSON manifest and one PNG atlas per language per scale — plus a `layout.lock.json` that pins atlas geometry for deterministic CI checks:

```
dist/
  babs-de.json   babs-de.png
  babs-de@2x.json  babs-de@2x.png
  babs-fr.json   babs-fr.png
  babs-fr@2x.json  babs-fr@2x.png
  babs-it.json   babs-it.png
  babs-it@2x.json  babs-it@2x.png
layout.lock.json
```

Each sheet covers all 257 icons plus 8 pattern keys and 3 sprite-only markers. @1x icons are 32 px; @2x icons are 64 px. Icon keys are bare catalogue IDs (`"1101"`, `"7118"`, `"9101d"`); pattern keys are `"<id>-pattern"` / `"<id>-pattern-b"`; marker keys are `"marker-<id>"` (e.g. `"marker-chevron-blue"`). Sprites are not SDF — do not set `"sdf": true` in layer paint properties.

## Install

```sh
yarn add @f-eld-ch/babs-sprites
```

For the Vite plugin, `vite` is an optional peer:

```sh
yarn add @f-eld-ch/babs-sprites vite
```

Registry configuration: see the [root README](../../README.md#auth).

## Vite setup

Add the plugin to emit sprite files with exact (unhashed) filenames so that `babsSpriteUrl()` can construct a stable URL.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { babsSprites } from "@f-eld-ch/babs-sprites/vite";

export default defineConfig({
  plugins: [
    babsSprites(), // emits to map/sprites/ (default)
    // babsSprites({ path: "assets/sprites" }),  // custom path
  ],
});
```

In dev the plugin serves sheets directly from `node_modules` via a middleware — no file copies. During build it emits all 12 files with their exact names, bypassing Rollup/rolldown content-hash renaming.

If you use a PWA plugin (e.g. vite-plugin-pwa), exclude sprite files from the precache manifest to avoid stale cache entries after language switches:

```ts
VitePWA({
  workbox: {
    globIgnores: ["map/sprites/**"],
  },
});
```

## Initial style

Use `withBabsSprite` to insert the BABS sprite entry into a style object before passing it to MapLibre. This is safe for the initial mount — no live map is required.

```ts
import { withBabsSprite } from "@f-eld-ch/babs-sprites";
import baseStyle from "./style.json";

const style = withBabsSprite(baseStyle, "de");
// style.sprite is now an array containing { id: "babs", url: "…/babs-de?v=…" }

const map = new maplibregl.Map({ style });
```

`withBabsSprite` leaves any existing sprite entries intact and replaces the `"babs"` entry if one already exists. If the original `sprite` is a plain string it is converted to `[{ id: "default", url }, { id: "babs", url }]`.

## Runtime language switch

Do not call `map.setStyle()` to change the language — that tears down and rebuilds all layers. Use `setBabsSpriteLang` instead, which swaps only the `"babs"` sprite entry and resolves once the new sheet has loaded.

```ts
import { setBabsSpriteLang } from "@f-eld-ch/babs-sprites";

// e.g. in response to a language toggle
await setBabsSpriteLang(map, userLanguage);
```

`setBabsSpriteLang` is a no-op when the URL is already correct (same language already active).

## babsSpriteUrl

MapLibre requires an **absolute, extensionless** URL for sprites — it appends `@2x.json`, `@2x.png`, `.json`, and `.png` itself. `babsSpriteUrl` builds this URL correctly and appends `?v=<package-version>` as a cache-buster.

```ts
import { babsSpriteUrl } from "@f-eld-ch/babs-sprites";

babsSpriteUrl("de"); // "https://example.com/map/sprites/babs-de?v=…"
babsSpriteUrl("fr-CH"); // "…/babs-fr?v=…"
babsSpriteUrl("en"); // "…/babs-de?v=…"  (falls back to German)
babsSpriteUrl("de", "assets/sprites"); // custom base path
```

The URL is resolved against `document.baseURI`, so sub-path Vite bases work without configuration.

## Plain MapLibre (no framework)

```ts
import maplibregl from "maplibre-gl";
import { withBabsSprite } from "@f-eld-ch/babs-sprites";

const style = withBabsSprite(
  {
    version: 8,
    sources: {/* … */},
    layers: [
      {
        id: "babs-symbols",
        type: "symbol",
        source: "events",
        layout: {
          "icon-image": ["coalesce", ["image", ["get", "symbol"]], ["image", "fallback-marker"]],
        },
      },
    ],
  },
  navigator.language,
);

new maplibregl.Map({ container: "map", style });
```

Icon keys match bare catalogue IDs. Marker keys (`marker-chevron-blue`, `marker-chevron-red`, `marker-double-chevron-blue`) are consumed as `icon-image` on `type: "symbol"` layers with `icon-rotate` for arrowhead caps. Use a `coalesce` expression to render a fallback when the feature's property is not a valid key. See [docs/markers.md](../../docs/markers.md) for the full marker reference.

## react-map-gl

```tsx
import { Map } from "react-map-gl/maplibre";
import { useBabsLang } from "@f-eld-ch/babs-react";
import { setBabsSpriteLang } from "@f-eld-ch/babs-sprites";
import { useEffect, useRef } from "react";

function BabsMap({ style }: { style: object }) {
  const mapRef = useRef(null);
  const { lang } = useBabsLang();

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map) setBabsSpriteLang(map, lang);
  }, [lang]);

  return <Map ref={mapRef} mapStyle={withBabsSprite(style, lang)} />;
}
```

Use `withBabsSprite` for the initial `mapStyle` prop and `setBabsSpriteLang` for subsequent language changes. Never call `setStyle` to change the language.

## No SDF

BABS sprites are rasterised from multicolour SVGs. They are not SDF (signed distance field). Do not use `icon-color` or `icon-halo-*` paint properties — they have no effect on non-SDF sprites.

## Exports

| Entry point | Contents                                               | Environment                    |
| ----------- | ------------------------------------------------------ | ------------------------------ |
| `.`         | `babsSpriteUrl`, `withBabsSprite`, `setBabsSpriteLang` | Browser, 0 runtime deps        |
| `./vite`    | `babsSprites()` Vite plugin                            | Node only; requires `vite >=5` |
