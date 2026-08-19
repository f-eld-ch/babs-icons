# @f-eld-ch/babs-core

Types, metadata, and language utilities for the BABS civil-protection icon set. This package is a peer dependency of `@f-eld-ch/babs-react`; install it explicitly alongside any package that lists it as a peer.

## Install

```sh
yarn add @f-eld-ch/babs-core
```

Registry configuration: see the [root README](../../README.md#auth).

## Exports

| Entry point | Contents |
|---|---|
| `.` | All runtime functions, types, and generated data |
| `./ids` | `BABS_ICON_IDS` union type + `BabsIconId`, `BabsCategoryNumber`, `BabsGroupNumber`, `BabsLang` |
| `./tree` | `BABS_TREE` — hierarchical category/group/icon structure |
| `./labels/de` | `BABS_LABELS_DE` — `Record<BabsIconId, string>` |
| `./labels/fr` | `BABS_LABELS_FR` |
| `./labels/it` | `BABS_LABELS_IT` |

All exports are `sideEffects: false` and tree-shakeable.

## Language resolution

`resolveBabsLang` maps any BCP-47-ish tag to one of `"de" | "fr" | "it"`. Unknown or missing languages fall back to German.

```ts
import { resolveBabsLang, spriteName } from "@f-eld-ch/babs-core";

resolveBabsLang("de-CH")   // "de"
resolveBabsLang("fr_FR")   // "fr"
resolveBabsLang("it")      // "it"
resolveBabsLang("en")      // "de"  — no English; falls back to German
resolveBabsLang(undefined) // "de"

spriteName("fr-CH")        // "babs-fr"
spriteName("en")           // "babs-de"
```

`resolveGraphicLang(id, requested)` is a narrower variant that consults `meta.graphicLangs` — for icons where the graphic is identical across all languages it always returns `"de"` regardless of `requested`.

## Listing icons

```ts
import { listCategories, listGroups, listIcons, findIcons } from "@f-eld-ch/babs-core";

// All 9 categories
listCategories();

// All groups within category 1
listGroups("1");

// All raster icons in categories 1 and 2
listIcons({ category: ["1", "2"], raster: true });

// Icons that exist in a specific graphic language
listIcons({ lang: "fr" });

// Full-text search (diacritic-insensitive) in the user's language
findIcons("brand", "de");   // returns icons whose German label contains "brand"
```

`listIcons` accepts a `ListIconsFilter`:

| Field | Type | Effect |
|---|---|---|
| `category` | `BabsCategoryNumber \| BabsCategoryNumber[]` | Restrict to one or more categories |
| `group` | `BabsGroupNumber \| BabsGroupNumber[]` | Restrict to one or more groups |
| `lang` | `BabsLang` | Only icons that have a distinct graphic in this language |
| `raster` | `boolean` | `true` for raster (embedded-PNG), `false` for vector |

## Lookup by ID

```ts
import { getIcon, isBabsIconId } from "@f-eld-ch/babs-core";

const meta = getIcon("1101");   // throws RangeError for unknown IDs

// Runtime type guard — safe for GeoJSON feature properties
if (isBabsIconId(feature.properties.symbol)) {
  const meta = getIcon(feature.properties.symbol);
}
```

ID format: category + group + file composite, e.g. `"1101"`, `"1105a"`, `"7118"`, `"9101d"`.

## Labels

```ts
import { getLabel, BABS_LABELS_DE, BABS_LABELS_FR } from "@f-eld-ch/babs-core";

getLabel("1101", "de-CH")   // "Beschaedigung"
getLabel("1101", "fr")      // "Degat"
getLabel("1101", "en")      // falls back to German label
```

The per-language label maps are plain `Record<string, string>` objects, suitable for building pickers or populating search indices without pulling in the full metadata.

## Types reference

```ts
interface BabsIconMeta {
  id: BabsIconId;
  category: BabsCategoryNumber;
  group: BabsGroupNumber;
  export: string;               // canonical export name, e.g. "babs1101"
  alias: string;                // readable alias, e.g. "babsBeschaedigung"
  labels: BabsLabels;           // { de, fr, it }
  identical: boolean;           // true when graphic is shared across all langs
  graphicLangs: BabsLang[];     // langs that have a distinct SVG file
  canonicalGraphicLang: BabsLang;
  raster: boolean;              // true = embedded PNG, false = vector paths
  recolorable: boolean;         // true = single-colour, fill can be overridden
  displaySize: 32 | 48;
  viewBox: "0 0 100 100";
}

interface BabsGroup {
  number: BabsGroupNumber;
  labels: BabsLabels;
  icons: BabsIconId[];
}

interface BabsCategory {
  number: BabsCategoryNumber;
  labels: BabsLabels;
  groups: BabsGroup[];
}

type BabsLabels = Readonly<Record<BabsLang, string>>;
type BabsLang   = "de" | "fr" | "it";
```
