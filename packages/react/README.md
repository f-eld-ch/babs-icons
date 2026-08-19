# @f-eld-ch/babs-react

React components for the BABS civil-protection icon set. 257 icons, 9 categories, labels in de/fr/it.

## Install

`@f-eld-ch/babs-core` is a peer dependency — install it explicitly.

```sh
yarn add @f-eld-ch/babs-react @f-eld-ch/babs-core
```

Registry configuration: see the [root README](../../README.md#auth).

## Setup

Wrap your app (or the subtree that renders icons) in `BabsIconProvider`. Pass the user's resolved language; the provider handles normalisation.

```tsx
import { BabsIconProvider } from "@f-eld-ch/babs-react";
import { useTranslation } from "react-i18next";

function App() {
  const { i18n } = useTranslation();
  return (
    <BabsIconProvider lang={i18n.resolvedLanguage}>
      <Router />
    </BabsIconProvider>
  );
}
```

`lang` accepts any BCP-47-ish tag (`"de-CH"`, `"fr_FR"`, `"en"`, …). Unknown or English tags resolve to German.

## Consumption modes

### Static import (recommended)

Import the icon definition directly. No registry call needed; fully tree-shakeable.

```tsx
import { BabsIcon } from "@f-eld-ch/babs-react";
import { babs1101 } from "@f-eld-ch/babs-react/icons";

<BabsIcon icon={babs1101} size={32} />
```

### Enumeration (icon picker)

Import the full barrel and pair it with `babs-core` for category/group structure. This pulls every definition into the bundle — only use it in admin/picker UI, and lazy-load the component to keep it out of the entry chunk.

```tsx
import { BabsIcon, registerBabsIcons } from "@f-eld-ch/babs-react";
import all from "@f-eld-ch/babs-react/all";
import { listCategories, listIcons } from "@f-eld-ch/babs-core";

registerBabsIcons(all); // once at module scope

function IconPicker() {
  return listCategories().map((cat) => (
    <section key={cat.number}>
      <h3>{cat.labels.de}</h3>
      {listIcons({ category: cat.number }).map((meta) => (
        <BabsIcon key={meta.id} icon={meta.id} size={meta.displaySize} decorative />
      ))}
    </section>
  ));
}
```

### String form

Pass the bare ID as a string. Requires a prior `registerBabsIcons` call for each icon that will be rendered this way.

```tsx
import { BabsIcon, registerBabsIcons } from "@f-eld-ch/babs-react";
import { babs1101, babs7118 } from "@f-eld-ch/babs-react/icons";

// Once at app startup — or lazily before first render
registerBabsIcons([babs1101, babs7118]);

// Later, id comes from e.g. a GeoJSON feature property
<BabsIcon icon={feature.properties.symbolId} size={32} fallback={<Spinner />} />
```

If the ID is not in the registry, `fallback` is rendered instead.

## BabsIcon props

| Prop | Type | Default | Description |
|---|---|---|---|
| `icon` | `BabsIconDefinition \| BabsIconId \| string` | required | Icon definition object, typed ID, or bare string (registry lookup) |
| `size` | `number \| string` | `"1em"` | Maps to `width` and `height` on the SVG element |
| `lang` | `string` | context lang | Overrides the provider language for this instance |
| `title` | `string` | label from metadata | Overrides the accessible name |
| `decorative` | `boolean` | `false` | When `true`, adds `aria-hidden` and omits the `<title>` |
| `color` | `string` | `"currentColor"` | Fill colour — no-op when `recolorable: false` |
| `fallback` | `ReactNode` | `null` | Rendered when the icon cannot be resolved |

Any additional props are forwarded to the `<svg>` element.

## Accessibility

By default `BabsIcon` is a labelled landmark: it sets `role="img"` and `aria-labelledby` pointing to an inline `<title>` whose text comes from the metadata label in the resolved language. Pass `title` to override the label. Pass `decorative={true}` to suppress the label and set `aria-hidden`.

```tsx
{/* Labelled — screen readers announce the German label */}
<BabsIcon icon={babs1101} />

{/* Custom label */}
<BabsIcon icon={babs1101} title="Gebäudeschaden" />

{/* Purely decorative — ignored by assistive technology */}
<BabsIcon icon={babs1101} decorative />
```

## useBabsLang

Access the resolved language and a label helper inside any component inside the provider.

```tsx
import { useBabsLang } from "@f-eld-ch/babs-react";
import { babs1101 } from "@f-eld-ch/babs-react/icons";

function IconLabel() {
  const { lang, label } = useBabsLang();
  return <span>{label(babs1101)}</span>;
}
```

`label` accepts either a `BabsIconDefinition` or a `BabsIconId` string.

## registerBabsIcons

```ts
import { registerBabsIcons } from "@f-eld-ch/babs-react";
import { babs1101 } from "@f-eld-ch/babs-react/icons";

registerBabsIcons(babs1101);               // single definition
registerBabsIcons([babs1101, babs7118]);   // array
```

The registry is a module-level map; call `registerBabsIcons` before any `<BabsIcon icon="1101" />` renders. Registering the same ID twice is safe — the latest definition wins.

## Exports

| Entry point | Contents | Use when |
|---|---|---|
| `.` | `BabsIcon`, `BabsIconProvider`, `BabsLangContext`, `useBabsLang`, `registerBabsIcons`, types | Always |
| `./icons` | Individual tree-shakeable definitions (one per ID) | Static or string-form usage |
| `./all` | All 257 definitions as a default-exported array | Icon pickers |

## Color and recolorable

The `color` prop sets the SVG `fill` attribute. It takes effect only when `meta.recolorable === true`, which is the case for single-colour icons. Most BABS icons are multicolour and have `recolorable: false`; passing `color` on those icons has no visual effect.

```tsx
{/* Works — icon is single-colour */}
<BabsIcon icon={babs7118} color="#e63312" />

{/* No-op — icon is multicolour */}
<BabsIcon icon={babs1101} color="#e63312" />
```
