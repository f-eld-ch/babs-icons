# @f-eld-ch/babs-assets

Optimised SVG files for the BABS civil-protection icon set, published as static assets rather than JS modules. Use this package when you need `<img src>` references, CSS `background-image` URLs, or server-side rendering where importing React components is not appropriate.

## Install

```sh
yarn add @f-eld-ch/babs-assets
```

Registry configuration: see the [root README](../../README.md#auth).

## assetUrl

`assetUrl(id, lang)` returns a URL for the optimised SVG file for a given icon and language. In a Vite project the bundler statically analyses the `new URL(…, import.meta.url)` call and emits the referenced file as a hashed build asset.

```ts
import { assetUrl } from "@f-eld-ch/babs-assets";
import { resolveGraphicLang } from "@f-eld-ch/babs-core";

// For icons identical across languages, lang defaults to "de"
const url = assetUrl("1101");          // resolves to de/1101.svg

// For divergent icons, pass the user's resolved language
const lang = resolveGraphicLang("7118", i18n.resolvedLanguage);
const url2 = assetUrl("7118", lang);   // resolves to fr/7118.svg (if lang is "fr")
```

In the browser, Vite replaces the `new URL` call with the hashed output path:

```html
<img src="/assets/1101-Bc3aF9e7.svg" alt="Beschaedigung" width="32" height="32" />
```

## When to use this vs babs-react

| Situation | Use |
|---|---|
| React app, inline SVG rendering, tree-shaking | `@f-eld-ch/babs-react` |
| `<img>` elements, CSS backgrounds | `@f-eld-ch/babs-assets` |
| Server-side rendering without a React renderer | `@f-eld-ch/babs-assets` |
| Non-JavaScript consumers (e.g. Svelte, Vue, plain HTML) | `@f-eld-ch/babs-assets` |
| MapLibre sprite integration | `@f-eld-ch/babs-sprites` |

## Lang defaulting for identical icons

178 of 257 icons have a graphic that is identical across all three languages. For those icons, `assetUrl` defaults `lang` to `"de"` — the canonical copy. Passing `"fr"` or `"it"` for an identical icon still works but resolves to the same file via a symlink.

For the 79 divergent icons, pass the user's resolved language explicitly. Use `resolveGraphicLang` from `@f-eld-ch/babs-core` to get the correct language for a specific icon, taking into account which graphic variants actually exist:

```ts
import { resolveGraphicLang } from "@f-eld-ch/babs-core";
import { assetUrl } from "@f-eld-ch/babs-assets";

function iconSrc(id: string, userLang: string): string {
  const lang = resolveGraphicLang(id as BabsIconId, userLang);
  return assetUrl(id as BabsIconId, lang);
}
```
