import type { BabsIconId, BabsCategoryNumber, BabsGroupNumber, BabsLang } from "./generated/ids.js";

export type { BabsIconId, BabsCategoryNumber, BabsGroupNumber, BabsLang };

export type BabsLabels = Readonly<Record<BabsLang, string>>;

export interface BabsIconMeta {
  readonly id: BabsIconId;
  readonly category: BabsCategoryNumber;
  readonly group: BabsGroupNumber;
  readonly export: string;
  readonly alias: string;
  readonly labels: BabsLabels;
  readonly identical: boolean;
  readonly graphicLangs: readonly BabsLang[];
  readonly canonicalGraphicLang: BabsLang;
  readonly raster: boolean;
  readonly recolorable: boolean;
  readonly displaySize: 32 | 48;
  readonly viewBox: "0 0 100 100";
  readonly hasPattern: boolean;
  readonly hasPatternB: boolean;
}

export interface BabsGroup {
  readonly number: BabsGroupNumber;
  readonly labels: BabsLabels;
  readonly icons: readonly BabsIconId[];
}

export interface BabsCategory {
  readonly number: BabsCategoryNumber;
  readonly labels: BabsLabels;
  readonly groups: readonly BabsGroup[];
}
