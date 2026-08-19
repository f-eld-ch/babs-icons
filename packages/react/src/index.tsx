export type { BabsGraphic, BabsIconDefinition, BabsIconId, BabsLang, BabsLabels } from "./types.js";

import {
  createContext,
  useContext,
  useId,
  type SVGProps,
  type ReactNode,
} from "react";
import { resolveBabsLang, getLabel } from "@f-eld-ch/babs-core";
import type { BabsIconId, BabsLang } from "@f-eld-ch/babs-core";
import type { BabsIconDefinition } from "./types.js";

// ── Context ───────────────────────────────────────────────────────────────────

export const BabsLangContext: ReturnType<typeof createContext<string>> = createContext<string>("de");

export function BabsIconProvider({
  lang,
  children,
}: {
  lang: string;
  children: ReactNode;
}): ReactNode {
  return <BabsLangContext value={lang}>{children}</BabsLangContext>;
}

// ── Registry (string form) ────────────────────────────────────────────────────

const registry = new Map<string, BabsIconDefinition>();

export function registerBabsIcons(defs: BabsIconDefinition | readonly BabsIconDefinition[]): void {
  const arr = Array.isArray(defs) ? defs : [defs];
  for (const def of arr as BabsIconDefinition[]) {
    registry.set(def.id, def);
  }
}

function lookupRegistered(id: string): BabsIconDefinition | undefined {
  return registry.get(id);
}

// ── useBabsLang ───────────────────────────────────────────────────────────────

export function useBabsLang(): {
  lang: BabsLang;
  label: (icon: BabsIconDefinition | BabsIconId) => string;
} {
  const ctx = useContext(BabsLangContext);
  const lang = resolveBabsLang(ctx);
  return {
    lang,
    label: (icon) => {
      if (typeof icon === "string") return getLabel(icon as BabsIconId, lang);
      return (icon as BabsIconDefinition).labels[lang] ?? (icon as BabsIconDefinition).labels[(icon as BabsIconDefinition).canonicalLang] ?? "";
    },
  };
}

// ── BabsIcon ──────────────────────────────────────────────────────────────────

export interface BabsIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  icon: BabsIconDefinition | BabsIconId | (string & {});
  size?: number | string;
  lang?: string;
  title?: string;
  decorative?: boolean;
  color?: string;
  fallback?: ReactNode;
}

export function BabsIcon({
  icon,
  size = "1em",
  lang,
  title,
  decorative = false,
  color = "currentColor",
  fallback = null,
  ...rest
}: BabsIconProps): ReactNode {
  const ctxLang = useContext(BabsLangContext);
  const uid = useId();

  // Resolve definition
  const def: BabsIconDefinition | undefined =
    typeof icon === "string"
      ? lookupRegistered(icon)
      : (icon as BabsIconDefinition);

  if (!def) return <>{fallback}</>;

  // ONE language resolution — used for both the label and the graphic
  const l = resolveBabsLang(lang ?? ctxLang);
  const label = decorative ? undefined : title ?? (def.labels[l] ?? def.labels[def.canonicalLang]);
  const g = def.graphics[l] ?? def.graphics[def.canonicalLang];

  if (!g) return <>{fallback}</>;

  // Per-instance id namespace function
  const ns = (localId: string): string => `${localId}-${uid}`;

  const sizeStr = typeof size === "number" ? `${size}px` : size;
  const a11y = label
    ? { role: "img" as const, "aria-labelledby": uid }
    : { "aria-hidden": true as const, role: "presentation" as const };

  if (g.kind === "raster") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={def.viewBox}
        width={sizeStr}
        height={sizeStr}
        {...a11y}
        {...(rest as SVGProps<SVGSVGElement>)}
      >
        {label ? <title id={uid}>{label}</title> : null}
        {g.body(ns)}
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={def.viewBox}
      width={sizeStr}
      height={sizeStr}
      fill={def.recolorable ? color : undefined}
      {...a11y}
      {...(rest as SVGProps<SVGSVGElement>)}
    >
      {label ? <title id={uid}>{label}</title> : null}
      {g.body(ns)}
    </svg>
  );
}
