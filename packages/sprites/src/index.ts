// @f-eld-ch/babs-sprites — browser, zero runtime deps
// Exports helpers for wiring BABS sprite sheets into MapLibre GL.

import { BABS_SPRITES_VERSION } from "./generated/version.js";

type BabsLang = "de" | "fr" | "it";

function resolveLang(requested: string | undefined): BabsLang {
  if (!requested) return "de";
  const primary = requested.split(/[-_]/)[0]?.toLowerCase() ?? "de";
  if (primary === "fr") return "fr";
  if (primary === "it") return "it";
  return "de";
}

/**
 * Returns an absolute, extensionless sprite URL suitable for MapLibre.
 * Routes lang through BABS resolution (so "en" → "babs-de").
 * Appends ?v=<package-version> for cache-busting.
 *
 * @param lang  Any BCP-47-ish tag or undefined.
 * @param base  Root path (no trailing slash). Defaults to "map/sprites".
 *              Resolved against document.baseURI, so sub-path Vite bases work.
 */
export function babsSpriteUrl(lang: string | undefined, base?: string): string {
  const l = resolveLang(lang);
  return spriteUrl(`babs-${l}`, base);
}

/**
 * Returns an absolute, extensionless URL for the language-independent
 * un-signs (ADR/Gefahrentafel) sprite sheet.
 *
 * @param base  Root path (no trailing slash). Defaults to "map/sprites".
 */
export function unSignsSpriteUrl(base?: string): string {
  return spriteUrl("un-signs", base);
}

function spriteUrl(sheet: string, base?: string): string {
  const root = (base ?? "map/sprites").replace(/\/+$/, "");
  const resolved = new URL(`${root}/${sheet}?v=${BABS_SPRITES_VERSION}`, document.baseURI);
  return resolved.toString();
}

function withSpriteEntry<T extends { sprite?: unknown }>(style: T, id: string, url: string): T {
  const entry = { id, url };

  let sprite = style.sprite;
  if (Array.isArray(sprite)) {
    const filtered = (sprite as Array<{ id: string; url: string }>).filter((s) => s.id !== id);
    sprite = [...filtered, entry];
  } else if (typeof sprite === "string") {
    sprite = [{ id: "default", url: sprite }, entry];
  } else {
    sprite = [entry];
  }
  return { ...style, sprite };
}

/**
 * Returns a NEW style object with a "babs" sprite entry inserted (or replaced).
 * Safe to use for the initial mapStyle prop — no live map needed.
 *
 * @param options  Base path string, or `{ base, unSigns }`. With `unSigns: true`
 *                 an "un" entry for the language-independent un-signs sheet is
 *                 added too (keys become `un:<kemler>`); it never needs swapping
 *                 by `setBabsSpriteLang`.
 */
export function withBabsSprite<T extends { sprite?: unknown }>(
  style: T,
  lang: string | undefined,
  options: string | { base?: string; unSigns?: boolean } = {},
): T {
  const { base, unSigns }: { base?: string; unSigns?: boolean } =
    typeof options === "string" ? { base: options } : options;

  const next = withSpriteEntry(style, "babs", babsSpriteUrl(lang, base));
  return unSigns ? withSpriteEntry(next, "un", unSignsSpriteUrl(base)) : next;
}

interface SpriteEntry {
  id: string;
  url: string;
}
interface MapLike {
  getSprite(): SpriteEntry[];
  addSprite(id: string, url: string): unknown;
  removeSprite(id: string): unknown;
  once(ev: "styledata", cb: () => void): unknown;
}

/**
 * Swaps the "babs" sprite on a live map to match `lang`.
 * No-op if the URL is already correct. Resolves when the new sheet has loaded.
 */
export async function setBabsSpriteLang(
  map: MapLike,
  lang: string | undefined,
  base?: string,
): Promise<void> {
  const url = babsSpriteUrl(lang, base);
  const sprites = map.getSprite();
  const current = sprites.find((s) => s.id === "babs");
  if (current?.url === url) return;
  const done = new Promise<void>((resolve) => map.once("styledata", () => resolve()));
  if (current) map.removeSprite("babs");
  map.addSprite("babs", url);
  await done;
}
