---
description: Re-flatten the BABS SVG sources (sources/de, sources/fr, sources/it) into packages/svg/ with a fresh index.json.
---

Re-run `flatten.ts` to regenerate `packages/svg/` from the source directories. Use this after editing source SVGs or adding new symbols.

## Usage

```
/flatten-babs [--dry-run] [--categories 1,2,3,4,5,6,7,8,9]
```

- `/flatten-babs` — full re-flatten, overwrites `packages/svg/`
- `/flatten-babs --dry-run` — show the mapping and divergence summary without writing anything
- `/flatten-babs --categories 1,2,3,5,6,7,8,9` — exclude category 4 (formations) if needed

The default is **all 9 categories** (1–9). Category 4 is 100% vector and safe to include.

---

## Step 1 — Run the flatten script

Pass any arguments from `$ARGUMENTS` through:

```bash
node packages/pipeline/src/flatten.ts $ARGUMENTS
```

The script prints:
- Total symbol ID count and divergence breakdown (identical / de-differs / all-differ / partial)
- Count of real files written to `svg/` and symlinks created
- Output path (`packages/svg/`)

If `--dry-run` is in `$ARGUMENTS`, stop here and show the output to the user.

---

## Step 2 — Quick sanity checks

Run these three checks and show the output:

```bash
# Per-language file counts
# Expected with all 9 categories: de 259, fr 259, it 259
for l in de fr it; do echo "$l $(ls packages/svg/$l | wc -l)"; done

# Broken symlinks (expected: no output)
find packages/svg/de packages/svg/fr packages/svg/it -type l ! -exec test -e {} \; -print

# index.json symbol count
jq '[.categories[] | (.symbols // (.subcategories[].symbols))[]] | length' packages/svg/index.json
```

Report the results. If any broken symlinks appear or the counts are unexpected, flag it.

---

## Step 3 — Report

Summarise in one short paragraph:
- How many symbol IDs were processed
- The identical / divergent breakdown
- Whether the sanity checks passed
- Remind the user that the flatten step resets any manual `copy-de` changes they may have been tracking
  (re-run `babs-icons copy-de <ids>` afterwards if needed)
