import type { SVGProps, ReactNode } from "react";
import type { KemlerCode } from "@f-eld-ch/babs-core/kemler-codes";

export type { KemlerCode, KEMLER_CODES } from "@f-eld-ch/babs-core/kemler-codes";

export interface UnSignProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** ADR Kemler code (Gefahrennummer) shown in the upper box, e.g. "80" or "X338". */
  kemler: KemlerCode;
  /** UN substance number (Stoffnummer) shown in the lower box, e.g. "1789". Omit to leave the lower box empty. */
  unNumber?: string;
  /** Icon size — CSS length string or pixel number. Defaults to "1em". */
  size?: number | string;
  /** Set true when the icon is purely decorative and should be hidden from screen readers. */
  decorative?: boolean;
}

// Fonts match the template SVG (FreeSans Bold). Liberation Sans is a metric-compatible
// fallback that is always present on Linux build machines and most browsers.
const FONT = "FreeSans, 'Liberation Sans', Arial, sans-serif";

// Geometry derived from the template SVG transform chain (see sources/de/2.Gefahren/09b-…).
// All coordinates are in the 100×100 viewBox space.
const TEXT_ATTRS = {
  textAnchor: "middle" as const,
  fontFamily: FONT,
  fontWeight: "bold",
  fontSize: 26.7,
  letterSpacing: -1.27,
  fill: "#ff9900",
} satisfies SVGProps<SVGTextElement>;

export function UnSign({
  kemler,
  unNumber,
  size = "1em",
  decorative = false,
  ...rest
}: UnSignProps): ReactNode {
  const sizeStr = typeof size === "number" ? `${size}px` : size;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={sizeStr}
      height={sizeStr}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? "presentation" : "img"}
      {...rest}
    >
      {/* Orange border frame + horizontal divider */}
      <path
        fill="none"
        stroke="#ff9900"
        strokeWidth={3.5}
        d="M 6.3,22.5 H 93.5 V 77.6 H 6.3 Z M 6.5,49.9 H 93.1"
      />
      {/* Kemler number — upper box */}
      <text x={50} y={45.2} {...TEXT_ATTRS}>
        {kemler}
      </text>
      {/* UN number — lower box (optional) */}
      {unNumber ? (
        <text x={50} y={73} {...TEXT_ATTRS}>
          {unNumber}
        </text>
      ) : null}
    </svg>
  );
}
