import type { BabsIconId, BabsLang, BabsLabels } from "@f-eld-ch/babs-core";
import type { ReactNode } from "react";

export type { BabsIconId, BabsLang, BabsLabels };

export interface BabsGraphic {
  readonly kind: "vector" | "raster";
  readonly body: (ns: (localId: string) => string) => ReactNode;
}

export interface BabsIconDefinition {
  readonly id: BabsIconId;
  readonly viewBox: "0 0 100 100";
  readonly labels: BabsLabels;
  readonly recolorable: boolean;
  readonly displaySize: 32 | 48;
  readonly graphics: Readonly<Partial<Record<BabsLang, BabsGraphic>>>;
  readonly canonicalLang: BabsLang;
}
