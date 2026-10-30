# Changelog

## 0.3.0 (unreleased)

### Added
- **Convert items to 5e when building** world setting (off by default). When on, Build runs the 5e converter
  over every copied item, writes the results to a new compendium **Loot Ledger · Converted Items**, and points
  the roll tables at the converted versions. Turning it off and building again points the tables back at the
  plain copies in **Loot Ledger · Items**.
- **Incremental, resumable builds.** Every written item stores a hash of its source item, the coin ratio, the
  calibration rules, the converter version, its replace-list status and the installed official compendiums.
  Re-running Build skips unchanged items, rewrites changed ones, removes items gone from the source, and never
  duplicates; an interrupted build resumes. `api.build({ force: true })` rewrites everything.
- **GM review list.** Items with lines the converter has no rule for are written with only their traceable
  features and listed, with the exact lines, on the GM review page of the new **Loot Ledger · Build Report**
  journal entry. Converter errors are listed there too and fall back to the plain copy.
- **Build summary**: a GM chat whisper after each build (copied, converted, GM review needed, hand-written
  rules replaced / kept, skipped as unchanged, removed, roll tables) linking to the Build Report.
- **Replace list** (`scripts/replace-list.mjs`): source items whose hand-written conversions fail the
  traceability standard are converted by Loot Ledger even when they pass the automatic audit. Matched by
  classic item id or exact name. Seeded with 3 of the 47 known failures (Scarlet Kris, Feathermoon Headdress,
  Band of Sulfuras); the rest are to be added after review.
- `api.rules()` and `api.replaceList()` return read-only copies of the calibration tables and the replace list.
- Tests (`node --test`, no dependencies) and a GitHub Actions workflow running them on every push and PR.

### Changed
- Every tunable number moved to one commented file, `scripts/rules.mjs` (rarity by quality, drop weights, price
  rule, weapon / armour mapping, +N curves, stat passives, trinket bonuses, line thresholds, proc dice, Flurry and
  blast uses, consumables). Values are unchanged from 0.2.0 and the converter output is identical.
  `convert.mjs` re-exports them under the same names.
- Build no longer clears the item compendium before copying; it updates it in place.

## 0.2.0

- Prices stored in the largest denomination with decimals; 5e converter preview (`api.convert`,
  `api.convertToPack`); unofficial fan content notice.
