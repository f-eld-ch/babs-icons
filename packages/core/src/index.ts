export type {
  BabsIconId,
  BabsCategoryNumber,
  BabsGroupNumber,
  BabsLang,
  BabsLabels,
  BabsIconMeta,
  BabsGroup,
  BabsCategory,
} from "./types.js";

export { BABS_ICON_IDS } from "./generated/ids.js";
export { BABS_ICONS } from "./generated/meta.js";
export { BABS_TREE } from "./generated/tree.js";
export { BABS_LABELS_DE } from "./generated/labels/de.js";
export { BABS_LABELS_FR } from "./generated/labels/fr.js";
export { BABS_LABELS_IT } from "./generated/labels/it.js";
export type { BabsMarkerId, BabsMarkerMode } from "./generated/markers.js";
export { BABS_MARKER_IDS, BABS_MARKER_MODES } from "./generated/markers.js";

import type {
  BabsIconId,
  BabsCategoryNumber,
  BabsGroupNumber,
  BabsLang,
  BabsIconMeta,
  BabsGroup,
  BabsCategory,
} from "./types.js";
import type { BabsMarkerId } from "./generated/markers.js";
import { BABS_ICONS } from "./generated/meta.js";
import { BABS_TREE } from "./generated/tree.js";
import { BABS_MARKER_IDS, BABS_MARKER_MODES } from "./generated/markers.js";
import { BABS_LABELS_DE } from "./generated/labels/de.js";
import { BABS_LABELS_FR } from "./generated/labels/fr.js";
import { BABS_LABELS_IT } from "./generated/labels/it.js";

const LABEL_MAPS: Record<BabsLang, Readonly<Record<string, string>>> = {
  de: BABS_LABELS_DE,
  fr: BABS_LABELS_FR,
  it: BABS_LABELS_IT,
};

// ── Language resolution ───────────────────────────────────────────────────────

const DEFAULT_CHAIN: readonly BabsLang[] = ["de", "fr", "it"];

export function resolveBabsLang(
  requested: string | undefined,
  options?: { chain?: readonly BabsLang[]; available?: readonly BabsLang[] },
): BabsLang {
  const chain = options?.chain ?? DEFAULT_CHAIN;
  const available = options?.available ?? DEFAULT_CHAIN;

  if (requested) {
    const primary = requested.split(/[-_]/)[0]?.toLowerCase() ?? "";
    const resolved = primary as BabsLang;
    if ((available as string[]).includes(resolved)) return resolved;
  }

  // Fall back: first item of chain that is in available
  for (const l of chain) {
    if ((available as string[]).includes(l)) return l;
  }

  return "de";
}

export function resolveGraphicLang(id: BabsIconId, requested?: string): BabsLang {
  const meta = getIcon(id);
  return resolveBabsLang(requested, { available: meta.graphicLangs });
}

export function getLabel(id: BabsIconId, requested?: string): string {
  const lang = resolveBabsLang(requested);
  return LABEL_MAPS[lang][id] ?? LABEL_MAPS.de[id] ?? id;
}

export function spriteName(requested?: string): "babs-de" | "babs-fr" | "babs-it" {
  const l = resolveBabsLang(requested);
  return `babs-${l}` as "babs-de" | "babs-fr" | "babs-it";
}

export function patternSpriteKey(id: BabsIconId, variant?: "a" | "b"): string {
  return variant === "b" ? `${id}-pattern-b` : `${id}-pattern`;
}

/** Returns the sprite key for a marker: "marker-" + id.
 *  The narrow return type lets the consumer use the string directly in icon-image expressions. */
export function markerSpriteKey(id: BabsMarkerId): `marker-${BabsMarkerId}` {
  return `marker-${id}`;
}

export function isBabsMarkerId(v: unknown): v is BabsMarkerId {
  return typeof v === "string" && (BABS_MARKER_IDS as readonly string[]).includes(v);
}

export function listMarkers(): readonly BabsMarkerId[] {
  return BABS_MARKER_IDS;
}

/** Returns the mode (icon or pattern) for a marker id. */
export function getBabsMarkerMode(id: BabsMarkerId): "icon" | "pattern" {
  return BABS_MARKER_MODES[id];
}

// ── Category / group / icon queries ──────────────────────────────────────────

export function listCategories(): readonly BabsCategory[] {
  return BABS_TREE;
}

export function getCategory(n: BabsCategoryNumber): BabsCategory {
  const cat = BABS_TREE.find((c) => c.number === n);
  if (!cat) throw new RangeError(`Unknown category: ${n}`);
  return cat;
}

export function listGroups(n: BabsCategoryNumber): readonly BabsGroup[] {
  return getCategory(n).groups;
}

export function getGroup(n: BabsGroupNumber): BabsGroup {
  for (const cat of BABS_TREE) {
    const grp = cat.groups.find((g) => g.number === n);
    if (grp) return grp;
  }
  throw new RangeError(`Unknown group: ${n}`);
}

export interface ListIconsFilter {
  category?: BabsCategoryNumber | readonly BabsCategoryNumber[];
  group?: BabsGroupNumber | readonly BabsGroupNumber[];
  lang?: BabsLang;
  raster?: boolean;
  hasPattern?: boolean;
}

export function listIcons(filter?: ListIconsFilter): readonly BabsIconMeta[] {
  const cats = filter?.category
    ? (Array.isArray(filter.category) ? filter.category : [filter.category])
    : undefined;
  const grps = filter?.group
    ? (Array.isArray(filter.group) ? filter.group : [filter.group])
    : undefined;

  const results: BabsIconMeta[] = [];
  for (const cat of BABS_TREE) {
    if (cats && !cats.includes(cat.number)) continue;
    for (const grp of cat.groups) {
      if (grps && !grps.includes(grp.number)) continue;
      for (const id of grp.icons) {
        const meta = BABS_ICONS[id];
        if (!meta) continue;
        if (filter?.lang !== undefined && !meta.graphicLangs.includes(filter.lang)) continue;
        if (filter?.raster !== undefined && meta.raster !== filter.raster) continue;
        if (filter?.hasPattern !== undefined && meta.hasPattern !== filter.hasPattern) continue;
        results.push(meta);
      }
    }
  }
  return results;
}

export function getIcon(id: BabsIconId): BabsIconMeta {
  const meta = BABS_ICONS[id];
  if (!meta) throw new RangeError(`Unknown icon id: ${id}`);
  return meta;
}

export function isBabsIconId(v: unknown): v is BabsIconId {
  return typeof v === "string" && v in BABS_ICONS;
}

export function findIcons(query: string, lang?: string): readonly BabsIconMeta[] {
  const q = query
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const l = resolveBabsLang(lang);
  return listIcons().filter((meta) => {
    const label = (meta.labels[l] ?? meta.labels.de)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    return label.includes(q);
  });
}
