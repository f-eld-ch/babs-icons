import type { BabsLang } from "./generated/ids.js";

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
