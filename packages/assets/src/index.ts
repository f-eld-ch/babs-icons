// @f-eld-ch/babs-assets — optimized SVG files
// assetUrl() uses the new URL(…, import.meta.url) form that Vite/rolldown
// statically analyses into a hashed emitted asset.

import type { BabsIconId, BabsLang } from "@f-eld-ch/babs-core";

export interface AssetUrlOptions {
  /** Pass `true` for the pattern tile. */
  pattern?: true;
}

/**
 * Returns a URL for the optimized SVG file for the given icon and language.
 * The bundler (Vite/rolldown) converts this into a hashed asset reference.
 *
 * `lang` defaults to "de" when the icon has a single shared graphic.
 * For divergent icons, pass the user's resolved language.
 */
export function assetUrl(id: BabsIconId, lang: BabsLang = "de", opts?: AssetUrlOptions): string {
  const suffix = opts?.pattern ? "-pattern" : "";
  return new URL(`../svg/${lang}/${id}${suffix}.svg`, import.meta.url).href;
}
