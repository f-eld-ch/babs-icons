// Shared alias-derivation logic — single source of truth for gen-core.ts and gen-react.ts.
// Do not add generator-specific imports here; keep this module pure.

export interface AliasInput {
  readonly id: string;
  readonly label: { readonly de: string };
}

export type LabelCorrections = Readonly<Record<string, { readonly de?: string }>>;
export type AliasPins = Readonly<Record<string, string>>;

// ── Transliteration + PascalCase ────────────────────────────────────────────

export function transliterate(s: string): string {
  return s
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function labelToAlias(label: string): string {
  const t = transliterate(label);
  // PascalCase: capitalise first letter of each word, remove non-alnum
  const pascal = t
    .replace(/[^A-Za-z0-9]+([A-Za-z])/g, (_, c: string) => (c as string).toUpperCase())
    .replace(/[^A-Za-z0-9]/g, "");
  const upper = pascal.charAt(0).toUpperCase() + pascal.slice(1);
  return "babs" + upper;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Build alias table for all symbols.
 *
 * Resolution order (highest priority first):
 *   1. `lock[id]`         — frozen alias from names.lock.json (authoritative)
 *   2. `pins[id]`         — manual override from corrections/aliases.json
 *   3. labelToAlias(label) — derived from DE label
 *
 * Collisions (two ids mapping to the same derived alias) are resolved by
 * suffixing each collider with its id (matching the pre-existing behaviour).
 * Pinned and locked names participate in uniqueness checking, so a pin can
 * never silently shadow a locked name.
 *
 * Returns a Map<id, alias> for all input symbols.
 */
export function buildAliases(
  syms: readonly AliasInput[],
  labelCorrections: LabelCorrections,
  lock: Readonly<Record<string, string>>,
  pins: AliasPins,
): Map<string, string> {
  const map = new Map<string, string>(); // id → raw (pre-collision) alias
  const usedAliases = new Map<string, string>(); // raw alias → first id

  for (const sym of syms) {
    // Locked alias is authoritative — use verbatim, no collision suffixing needed
    // (uniqueness is a verify invariant).
    if (lock[sym.id] !== undefined) {
      map.set(sym.id, lock[sym.id]!);
      usedAliases.set(lock[sym.id]!, sym.id);
      continue;
    }

    // Manual pin or derivation
    const deLabel = (labelCorrections[sym.id]?.de ?? sym.label.de) || sym.id;
    const raw = pins[sym.id] ?? labelToAlias(deLabel);
    map.set(sym.id, raw);
    const existing = usedAliases.get(raw);
    if (existing !== undefined) {
      usedAliases.set(raw, "__COLLISION__");
    } else {
      usedAliases.set(raw, sym.id);
    }
  }

  // Resolve collisions (only for derived/pinned names — locked names skip this pass)
  for (const sym of syms) {
    if (lock[sym.id] !== undefined) continue;
    const raw = map.get(sym.id)!;
    if (usedAliases.get(raw) === "__COLLISION__") {
      const idPart = sym.id.replace(/[^A-Za-z0-9]/g, "");
      map.set(sym.id, raw + idPart);
    }
  }

  return map;
}
