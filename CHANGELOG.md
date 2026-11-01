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
- **Review board** (GM only; setting "Review board", on by default, needs a reload; off registers nothing): a window
  for working through the converted items that need GM review. It shows the queue with filters (to do / status,
  quality, item type, slot, reason, search) and progress counts (pending / accepted / tweaked / skipped /
  rejected). For each item it shows the source tooltip with the flagged lines highlighted, the converted result
  (summary, bonus, activities, riders, not-converted lines, the 5e block) and a GM note, with **Accept**,
  **Tweak** (opens the item sheet and marks the item tweaked when the sheet closes), **Skip**, **Reject** and
  back-to-pending. Keys: A / T / S / R, arrow keys for previous / next. It opens from the Loot Ledger settings
  window, a button on the Build Report journal entry and `api.reviewBoard()`. Decisions are stored on the
  converted item as `flags["loot-ledger"].review = { status, note, by, at }`.
- Builds respect the review: converted items the GM **accepted or tweaked are not rewritten** on rebuild, even
  when their source or the rules changed, so manual edits survive. `build({ force: true })` rewrites them too
  (their status goes back to pending and `previous` records the old one; the note is kept). Skip, Reject and
  notes are carried onto rewritten items. **Rejected** items are left out of every roll table from the next
  build, also when conversion is turned off later. The build summary and Build Report list "kept as reviewed"
  and "rejected" counts, and the GM review page has a Status column.
- **Quality colours** (setting, on by default, needs a reload; off registers nothing): item names are shown in
  their quality colour on actor sheet inventories, item sheet titles, dnd5e chat item cards, content links (chat,
  journals), roll table results, the Items sidebar and Item compendium windows, and Item Piles pile / merchant /
  vault windows when Item Piles is active. One CSS class per quality (`ll-q ll-q-<quality>`), coloured with the shared
  `--wc-q-*` tokens (light- and dark-theme values). Qualities: poor, common, uncommon, rare, epic,
  legendary, artifact, heirloom.
  - "Colour by 5e rarity when no quality is set" (on by default): common white, uncommon green, rare blue, very
    rare purple, legendary orange, artifact gold. An explicit quality always wins.
  - Setting quality by hand (setting "Quality picker for GMs", on by default): a **Quality** dropdown in the item
    sheet header (GM only), a **Set quality** entry in the Items sidebar and Item compendium context menus (applies
    to every selected entry when the clicked one is selected, otherwise to the one clicked), and
    `api.setQuality(items, quality)` (documents or UUIDs; `null` clears). Stored as `flags["loot-ledger"].quality`,
    the same key Build writes. `api.qualityOf(item)` returns the quality an item shows.
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

- **Hook `loot-ledger.itemDropped`** (experimental): fires with `{ item, source, actor?, table?, query? }` when
  `api.roll()` draws an item (`"roll"`) and when a Loot Ledger item is created on an actor or Item Piles pile
  (`"actor"`, active GM's client only). README now has a Public API and hooks table marked stable / experimental.
- **`api.removeData()`** (GM, experimental): removes Loot Ledger's compendiums, Build Report journal and settings;
  dry run by default; `itemFlags: true` also clears `flags["loot-ledger"]` from items. README lists where the
  data lives.
- Tests for the release tag check, manifest compatibility, the hook payload and its bail-outs, the cleanup plan,
  and converter-version bumps leaving accepted / tweaked items alone.

### Security
- **GM-only API.** `build`, `roll`, `findTable`, `convertToPack`, `auditHandWritten`, `replaceList`, `rollSuffix`, `removeData`, `reviewBoard` and `setQuality` now show "GM only" and return `undefined` for players. Pure helpers (`convert`, `rules`, `suffixes`, `qualityOf`, `auditHandAuthored`, `sellPrice`, `bandForLevel`, `formatCoins`, lookup lists) stay open. `auditHandWritten` checks for a GM itself before it can write the Build Report journal.
- **Random suffixes only roll for items created by a GM user.** A player could put the suffix flag on an item they create on their own actor and trigger a roll (or a GM whisper). The hook now checks the creating user id; use the item's Roll suffix action or `api.rollSuffix` for a player's item.
- **Chat card names are escaped.** The "GM picks" whisper put item and actor names into the message as raw HTML; they are now escaped.

### Merged 0.2.1-0.2.2
- `main` merged into this branch: the Shift item tooltip with compare (0.2.1), and wanderers-core 0.5.0 vendored with the tooltip on core's shared quality tokens / `formatCoins` and the Item Piles row fix (0.2.2). Also from main: ESLint (`npm run lint`), the pinned CI and Release workflows with the core pin check. Entries for 0.2.2 and 0.2.1 are below. The version stays 0.3.0 (unreleased).
- The tooltip's quality colours come from core's `--wc-q-*` tokens; since the unification below, so do the name colours.

### Changed
- **One quality colour system.** Quality colours (names, item sheet title, pickers, chat cards, links, tables,
  sidebar, Item Piles, review board) now use the shared `--wc-q-*` tokens of the vendored wanderers-core, the same
  ones the item tooltip uses; the module's own `--ll-q-*` colour set is gone. `quality-model.mjs` is now a thin
  normaliser over core's `QUALITIES` / `quality()`: colour-word and rarity aliases ("purple", "Very Rare",
  "light blue"), the extra heirloom tier, and no colour for an item with no quality or rarity (core's `quality()`
  would say poor) or an unknown value (core would say common). Later in 0.3.0: items below common are grey, see
  *Items below common are grey* below. The tooltip reads flags through the same normaliser,
  so aliases and heirloom colour it too. Coloured elements carry core's root classes and their window's theme class,
  so light and dark themes follow core. Heirloom has no core token yet: one `--wc-q-heirloom` token in core's
  pattern lives in `styles/loot-ledger.css` (core candidate; drop it when core ships one).
  Colour changes (core's values win where they differed): dark theme poor `#9d9d9d` (was `#a5a5a5`), uncommon
  `#2fd24a` (`#3ee620`), rare `#3d8bff` (`#4ea6ff`), epic `#b86cf0` (`#bf7af5`), legendary `#ff8a1f` (`#ff8f26`);
  light theme poor `#6e6e6e` (`#5e5e5e`), uncommon `#1b7a2b` (`#166b00`), rare `#285aa6` (`#0055aa`), epic
  `#814ca8` (`#7a22b8`), legendary `#9e5613` (`#984300`), artifact `#615636` (`#6f5716`), heirloom `#18647a`
  (`#006480`). Common is now coloured (`#f2f2f2` dark, mid grey `#5c5c5c` light) instead of keeping the
  surrounding text colour. Dark artifact and dark heirloom are unchanged.
- **Items below common are grey.** With *Colour by 5e rarity* on, a physical item (weapon, equipment, consumable,
  tool, loot, container) with no rarity, `""`, `"mundane"` or `"none"` now shows as poor (grey) instead of no colour;
  `normalizeQuality("mundane")` is now `"poor"`. Unchanged: an explicit quality flag still wins; empty / "none" /
  "auto" flags still mean "not set" (the picker's *Auto*); an unknown (homebrew) rarity stays uncoloured, since it
  may rank above common and grey would call it junk; items with no rarity field at all (spells, features, classes)
  stay uncoloured; with the fallback off nothing is coloured without a flag. Build is unaffected (it always writes
  the source quality flag, and poor items keep rarity common). The tooltip already showed these items grey.
- **Heirloom token, later**: after a wanderers-core release with `--wc-q-heirloom` (0.5.2, pushed, not yet
  published) run `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node vendor/wanderers-core/vendor.mjs update 0.5.2`,
  then drop `--wc-q-heirloom` from `styles/loot-ledger.css`. Code then: `EXTRA_QUALITIES` can be empty (core's
  `QUALITIES` will include heirloom, so `COLOUR_QUALITIES` must not add it twice; the order test expects
  `[...QUALITY_KEYS, "heirloom"]`), and `CLAUDE.md` / the vendored-core version line updated.
- `module.json`: minimum Foundry 14 (verified 14); dnd5e verified 6.0.6; Item Piles and Wayfarer's Toolkit
  listed under `recommends` (neither is required).
- Release workflow fails at once when the release tag is not `vMAJOR.MINOR.PATCH`.
- Hot hooks bail out earlier: the chat-message colour hook returns when a message has no item card or content
  link, and the suffix `createItem` hook checks the cheap conditions (actor parent, flag) before the active-GM
  lookup.
- `<Random enchantment>` lines are treated as flavour: they no longer count as "not converted" lines (they
  now mark the item for a random suffix instead). `CONVERTER_VERSION` 3, so converted items pick up the flag.
- Every tunable number moved to one commented file, `scripts/rules.mjs` (rarity by quality, drop weights, price
  rule, weapon / armour mapping, +N curves, stat passives, trinket bonuses, line thresholds, proc dice, Flurry and
  blast uses, consumables, level bands, creature-table spread, potion reflavour tiers, the empty-item review
  threshold, the Strength carry multiplier). Values are unchanged from 0.2.0 and the converter output is identical.
  `convert.mjs` re-exports them under the same names.
- Build no longer clears the item compendium before copying; it updates it in place.

### Untested in Foundry
- As a player, every gated `api.*` member shows "GM only" and returns `undefined`; `api.rules()` and `api.suffixes()` still work.
- A player creates a flagged item on their own actor: nothing rolls and no whisper is sent. A GM drags a flagged item onto an actor: it rolls (Roll on drop) or whispers (GM picks).
- Item Piles: loot moved from a pile to a player's actor still rolls (it is created by the GM's client); confirm.
- An item named with HTML characters shows as plain text in the "GM picks" whisper.
- Quality colours after the unification, light and dark interface theme, and a sheet whose own theme differs from
  the interface: actor inventory names, item sheet title and Quality picker options, chat item card, content link,
  roll table result, Items sidebar and compendium entry, Item Piles row and vault cell, review board list and header.
  Each tier reads as listed above; common is the near-white / mid-grey; heirloom is light blue; an item with no
  rarity or "mundane" rarity is grey (a spell or feature without rarity stays uncoloured, so does a homebrew
  rarity). Switching the interface theme recolours open names without a reload.
- The Shift tooltip of an item whose quality flag is "heirloom" or an alias ("purple") shows that colour.

## 0.2.3 (2026-11-01)

- Fix: tooltip prices were wrong in a world whose currency conversions differ from the **Coin ratio** setting (for example a
  100:1 three-coin world with the setting at 10:1: 2 sp showed "2c", 1 cp showed nothing, 15 sp showed "1s 5c"). The price
  mixed the world's conversions with the setting. It now reads the ratio from the world's own conversions (sp 10 or 100, cp the
  square) and uses the setting only when the world has no usable conversions. Worlds where both agree are unchanged.
  (Prices written into items at build time are not affected: they are stored as a value and a denomination.)

### Untested in Foundry
- In a 100:1 world with the setting at 10:1, an item priced 2 sp shows "2s", 1 cp shows "1c", 15 sp shows "15s", 123 cp shows
  "1s 23c"; in a standard 10:1 world they show "2s", "1c", "1g 5s", "1g 2s 3c".

## 0.2.2 (2026-11-01)

- Fix: the Shift item tooltip now works in **Item Piles** windows (item piles, merchants, vaults; checked against Item Piles
  3.3.4 source). Their rows carry no item id, so the item comes from Item Piles' own documented row hooks
  (`item-piles-renderPileItem` / `-renderMerchantItem` / `-renderVaultGridItem` and the matching hover hooks, which pass the row
  element and its item). For a row drawn before the tooltip was turned on, the window's pile or merchant actor is searched by the
  row's shown name and image (name and image, then name, then image; only a single match is used, so two identical items in one
  pile show nothing).
- Shared look: the module now vendors **wanderers-core 0.5.0** (`vendor/wanderers-core/`, pinned by `wanderers-core.lock.json`).
  The tooltip's rarity colours are core's item quality tokens (`--wc-q-*`, via core `quality()`), and prices are written by core's
  `formatCoins` using the module's *Coin ratio* setting (100:1 or 10:1). The tooltip keeps its own dark in-world surface; quality
  colours are darkened on the light theme by core.
- Dev: CI and the Release workflow check the vendored core against its pin (`vendor.mjs verify --remote`); the release zip
  includes `vendor/` without core's dev-only `config/`, `vendor.mjs` and `testing/`. ESLint skips `vendor/`. New tests in
  `tests/item-piles.test.mjs`.

**Untested in Foundry** (Node tests only):

- Item Piles pile, merchant and vault windows: Shift-hover shows the right item; the hooks fill the row map (merchant rows use
  `display: contents`, so hovering any cell should find the row); the name/image fallback after turning the tooltip on with a
  window already open; the trading window (rows without hooks, not expected to resolve).
- Core stylesheet loads first (`module.json` styles) and the tooltip's quality colours in the dark and light themes, including
  common (near-white on dark, grey on light).
- Prices with the 10:1 coin ratio in a standard-currency world, and with 100:1.
- Turning the tooltip off removes the Item Piles hook listeners.

## 0.2.1 (2026-11-01)

**Untested in Foundry**: written and unit-tested in Node only; not yet run in a live world.

- New: optional item tooltip (client setting *Item tooltip (hold Shift)*, off by default). Hold Shift while hovering a dnd5e
  item on actor sheets, the Items sidebar, compendium windows and browser, or chat item cards to see its rarity-coloured name,
  type and slot, damage / AC / properties, magical bonus, attunement, charges, a short description excerpt, price in g/s/c,
  weight, and a comparison (↑/↓) with your character's equipped item in the same slot. Read-only.
- Dev: `package.json` with `npm test` (`node --test`), `npm run check` and `npm run lint` (ESLint flat config, no plugins);
  tests for the tooltip's pure logic in `tests/tooltip-data.test.mjs`.
- Removed an unused variable in the converter (no behaviour change).

## 0.2.0 (2026-10-30)

- Prices stored in the largest denomination with decimals; 5e converter preview (`api.convert`,
  `api.convertToPack`); unofficial fan content notice.
