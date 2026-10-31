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
- `api.auditHandWritten()` lists every hand-written conversion in the source module, flags the ones failing the
  traceability audit, marks which are on the replace list, and prints replace-list entries ready to paste
  (`{ journal: true }` also writes a "Hand-written audit" page to the Build Report).
- `tools/calibration-report.mjs`: prints the calibration rules as a table and shows how sample items convert
  (bundled: `tools/fixtures/sample-items.json`, ~40 made-up items). `BOOK-DAY.md`: calibration and release
  checklist.
- **Dry run**: `api.build({ dryRun: true })` runs every stage up to the writes (conversion, rules, hashing, sync
  planning, roll-table planning, report generation) and returns the plan, the report data (rows, pages, chat
  summary) and the summary counts, without creating or changing any compendium, folder, Build Report journal or chat
  message, and without the confirm dialog. Existing packs are only read. `BOOK-DAY.md` has a "run a dry run
  first" step with a console snippet.
- **Random suffix enchantments** (first pass; world setting, on by default but only active while conversion is
  on). Items with the random enchantment line are flagged `flags.loot-ledger.randomSuffix` (with a pick group)
  when converted. When such an item is created on an actor or an Item Piles pile, the active GM rolls one of 25
  suffixes ("of the Bear", "of the Owl", "of Fire Resistance", "of Blocking", ...) weighted by the item's group
  (cloth favours Owl / Intellect, plate favours Bear / Strength / Defense, shields Blocking, ranged
  Marksmanship), renames the item, adds the effects (Active Effects for Initiative, max HP, AC, Resistance and
  Athletics Advantage; the rest as text and `flags.loot-ledger.riders`), bumps the price (x1.2 to x1.5) and
  stores `flags.loot-ledger.suffix = {id, rolledAt, base}` so it never rolls again. Power comes from quality
  and level band. Setting "Random suffixes: who picks": roll on drop or GM picks (whisper only). API:
  `api.rollSuffix(item, { suffixId })` (GM; also rerolls) and `api.suffixes()`. GM-only "Roll / Reroll suffix"
  entry in the dnd5e item context menu. All numbers in `scripts/rules.mjs` section 9. Build Report page
  "Random suffixes (N)" with the table and the count of source items carrying the line.
- Tests (`node --test`, no dependencies) and a GitHub Actions workflow running them on every push and PR.

### Changed
- `<Random enchantment>` lines are treated as flavour: they no longer count as "not converted" lines (they
  now mark the item for a random suffix instead). `CONVERTER_VERSION` 3, so converted items pick up the flag.
- Every tunable number moved to one commented file, `scripts/rules.mjs` (rarity by quality, drop weights, price
  rule, weapon / armour mapping, +N curves, stat passives, trinket bonuses, line thresholds, proc dice, Flurry and
  blast uses, consumables, level bands, creature-table spread, potion reflavour tiers, the empty-item review
  threshold, the Strength carry multiplier). Values are unchanged from 0.2.0 and the converter output is identical.
  `convert.mjs` re-exports them under the same names.
- Build no longer clears the item compendium before copying; it updates it in place.

## 0.2.0

- Prices stored in the largest denomination with decimals; 5e converter preview (`api.convert`,
  `api.convertToPack`); unofficial fan content notice.
