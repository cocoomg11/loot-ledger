# Changelog

## 0.4.0 (unreleased)

The former v0.3.0 development work (5e conversion on build, review board, quality colours, random suffixes, official
bases, stat variants, collapse) on top of 0.3.0's merchant tables, with wanderers-core 0.6.0 and the 2026-11-08
conversion decisions. Conversion stays off by default; every new option is a setting that can be turned off. How it
works: [docs/conversion.md](docs/conversion.md).

### 0.4.0 release round (conversion only)
- **Main stats default to the stat variant.** Ability-score bases are no longer chosen automatically. A new
  per-item **Score item** toggle on the Review board (`flags.loot-ledger.overrides.scoreItem`) gives one picked
  item the ability-score base for its main stat, one rarity above the base; such an item never also gets its own
  ability's variant. The **Ability-score bases** setting now only allows picked score items.
- **Coverage.** A base covers lines only through its own tags (matches carry them): no gap-fill variant for what a
  base already does (a stealth cloak gets no extra Stealth bonus). A main stat is covered only by its stat tag, the
  chosen variant's tag or a picked score tag, so Agility boots whose variant is Acrobatics keep Nimble (+1) with no
  base; the stealth boots stay on the board as a candidate, and choosing them replaces the variant.
- **Score tags.** Only a change that sets a score (upgrade / override) makes a score base; one that adds to it is a
  stat bonus.
- **Bleeds.** Damage-over-time procs are a lingering wound (start-of-turn damage for up to 1 minute, Constitution
  save ends it, DC 13 / 15 / 17 / 19 by quality, a new wound restarts the duration) instead of an instant blast;
  dice a third of the band's dice (at least 1d6), uses as the blast had. Not automated; the `bleed` rider stores the
  data. A small over-time tail folds into the instant damage line.
- **Stat-lowering clauses** become a Bane-shaped debuff (the target subtracts 1d4 from attack rolls and saving
  throws until the end of the wielder's next turn), kept with the proc's damage. New world setting
  **Stat-lowering procs** (on by default).
- Healing procs are no longer read as damage (review); slows and multi-target procs are flagged.
- **Active Effects**: dnd5e 6.x keys (`skills.X.roll.bonus`, `abilities.X.save.roll.bonus`,
  `abilities.X.check.roll.bonus`, `attributes.init.roll.bonus`, `attributes.concentration.roll.bonus`,
  `rolls.attack.*.bonus`) in the Foundry 14 shape (`system.changes`, `type: "add"`, `phase: "initial"`), for
  converted items, variants and random suffixes. The old shimmed keys go away in dnd5e 7.0; a test fails on them.
- **Review board**: biggest collapse groups first within a status; kind filters **Source text replaced** and
  **Score item (picked)**.
- Converter version 9, matcher version 3 (unreviewed converted items are rewritten on the next Build; accepted and
  tweaked ones are kept unless `force`).

### 0.4.0 release round (module)
- Merged with 0.3.0 (merchant tables) and 0.2.5 (GM-only API, cached table indexes): one API gate
  (`GM_ONLY_MEMBERS` / `OPEN_MEMBERS`; `auditHandAuthored` and `healthReport` stay GM only), the merchant settings in
  the cleanup list, base sources read once per run.
- wanderers-core 0.6.0. CI uses core's reusable `module-checks.yml@v0.6.0` with a committed `package-lock.json`
  (eslint only), plus the module.json version check. Release workflow: tag format check before the hardened build.

### Live checklist (test world; only a live world can confirm)
- [ ] Module loads on Foundry 14 / dnd5e 6.0.6 with no console errors; the Merchants window and the Review board both
  open (settings on).
- [ ] A dry run (`api.build({ dryRun: true, convert: true })`) writes nothing and lists the items the 0.4.0 round
  changed (score-base items now variants, bleeds, debuffs).
- [ ] A converted item's transferred effect applies on an actor: a Constitution-save variant shows on the save, an
  Acrobatics variant on the skill, an Initiative variant on Initiative; no dnd5e deprecation warning in the console.
- [ ] Mark one item **Score item** on the Review board, build: it gets the ability-score base, no variant for that
  ability, and its other lines as gap-fills. Toggle it off and build: back to the variant.
- [ ] **Use this base** offers a related base (stealth boots on Agility boots); after a build the item has that base
  and no Acrobatics gap-fill.
- [ ] A bleed weapon's feature text reads clearly at the table and its uses (Long Rest) count down on the sheet.
- [ ] The queue lists the biggest groups first; the Source text replaced and Score item filters work.
- [ ] Accepted / tweaked items survive the converter version bump without `force`.
- [ ] Merchant tables unchanged from 0.3.0 (plan, apply, restock on one merchant).

### Unreleased: official bases (phase 1, conversion only)
- **Official bases.** When converting, an item can be re-based on a matching official item from your installed
  compendiums (scored by the lines it covers, with a confidence; accept / suggest / tooltip conversion). It keeps
  its own name, icon, price, quality and rarity; lines the base lacks become one extra effect. Weapons, chest
  armour and shields can use the +N template. Mechanics are read from your compendium at build time; Loot Ledger
  stores no official text.
- New world settings, each can be turned off: **Official bases**, **Base compendiums** (priority order),
  **Book compendium** (exact-name matches used as is; only price, quality and focus added), **Base confidence**,
  **Ability-score bases**, **Gap-fills on bases**, **Hand-made items** (names / UUIDs Build leaves alone; also
  `flags.loot-ledger.handmade`).
- Converted items carry `flags.loot-ledger.base`, `gapFills` and `converted.route`
  (base | convert-auto | convert-review | baseline | book | handmade); `basedOn` is kept as an alias for one version.
- Changed: rule values from the book review (level bands, Legendary-only attunement tier, armour with features,
  weapon rider dice, Resistance from Very Rare, uses per Long Rest, Initiative, mana potion slots). Removed: the
  random reflavour pick and the per-item AC effect. Converter version 5 (unreviewed converted items are rewritten
  on the next Build).

### Unreleased: stat variants and line rules (phase 2, conversion only)
- **Stat variants.** The main stat becomes exactly one flat bonus chosen by slot (skills, saves, Initiative, max HP,
  Concentration, spell save DC, Grapple / Shove DC, Hit Point Dice healing); never an ability score or weapon
  damage. Advantage instead of the bonus only by a per-item opt-in (`flags.loot-ledger.overrides.advantage`).
  Green / blue items whose only benefit is the variant need no attunement.
- **Line budget**: green 1, blue 2, purple / orange 3 benefits beyond the +N; the weakest extra line is listed as
  not converted. Profession lines are free.
- **Line rules**: critical-hit dice, parry / dodge reaction, mana regeneration (slot recovery or Concentration),
  health regeneration, resistance on jewellery and cloaks, protection for several small resistances, passive
  "when struck" riders, spell surges, +1 AC from trinket defence lines (now actually applied), +hit on non-weapons
  from Very Rare (attuned).
- **Weapons**: +1 / +1 / +2 / +3 at every tier (the +1 always wins at green), scimitar by name, blasts from 2x a
  normal hit; an endgame +1 step only by override (`flags.loot-ledger.overrides.raise`).
- New world settings, each can be turned off: **Critical-hit dice**, **Profession bonuses**, **Mana regeneration**,
  **Parry reaction**, **Blast threshold**. Converter version 6.

### Unreleased: collapse and review board (phase 3, conversion only)
- **Collapse.** Converted items that follow the same rule (shape, slot, type, quality, tier band, official base,
  bonus and gap-fills; white / grey gear by shape, slot, type and band) are grouped (`flags.loot-ledger.collapse`)
  and reviewed once; every item keeps its own name, icon, price, item level, tooltip and quality. Book, hand-made
  and source-text items never collapse; a member with an override, a Tweak or an explicit split stands alone.
  New world setting **Collapse same-rule items** (shared | off).
- **Review board.** Every converted item is on the board. New kind filters (suggested base, no base, collapsed
  group, source-text item, flagged); a group is one entry with its members and a decision applies to all of them;
  new actions: accept base, use another candidate, drop base, split from group, Advantage opt-in (epic / legendary),
  endgame +1 raise. These write `flags.loot-ledger.overrides` (and `collapse.split`); the next Build rewrites the
  item from them (the overrides are part of the conversion hash).
- **Review flags** raised at build (`converted.flags`): no vendor price, source text replaced by the rules,
  non-damage proc turned into a feature, stand-in fist weapon, stackable thrown weapon, proc parts not converted,
  protection / health-regeneration base not found, suggested base.
- **Build Report**: an "Official bases" page (matched share, by route, collapse groups, lowest-confidence bases);
  `build({ dryRun: true })` returns `plan.items` with route, base, confidence, candidates, gap-fills and collapse per
  item. Base candidates are stored on every matched item (`baseCandidates`). Converter version 7.
- Docs: `docs/conversion.md` rewritten for the whole rework; README conversion section and troubleshooting updated; a test
  keeps the doc's rule names in sync with `rules.mjs`.

### Unreleased: dry-run fix round (conversion only)
- **Source text vs decided rules.** The source module's hand text now wins only where no rule is decided: weapons
  keep a hand text that passes the audit; other items use the rules when any line became a rider, and the hand
  text is listed as replaced (review flag). A weapon's own critical-hit rule traces to its damage line.
- **Untyped procs.** "N to M damage" procs with no school convert in the weapon's own damage type (they were
  dropped to review before); procs that also do something else are flagged.
- **Matcher.** Staves use the +N template only; magic entries with no rarity are never candidates; decided-rule
  bases outside their quality range are not free candidates; a wand base no longer gets a cantrip gap-fill.
  Shortlisted candidates are read in full once per build so their Active Effects reach the matcher (the pack index
  has no effect changes); Foundry 14 `system.changes` is read.
- **Variants.** Main-stat ties: quality-gated jewellery row, then armour order (plate / mail: Stamina first), then
  slot rule, then stat order. The endgame raise override now also raises chest armour and shields.
- Converter version 8, matcher version 2 (unreviewed converted items are rewritten on the next Build).

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

### Merged 0.2.4
- `main` 0.2.4 merged in (tooltip fixes): trailing source "Sell Price" text left out of the tooltip description, chest armour / clothing / Chest-flagged items compare in one body slot (Finger items with rings), price and sells-for hidden on unidentified items for players, and a one-time hint with the world setting **Tell players about the item tooltip**. Entry under 0.2.4 below; the version stays 0.3.0 (unreleased). Conflicts were resolved in favour of this branch's quality / colour code (none touched it).

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
  so light and dark themes follow core. Heirloom's token comes from core (0.5.2).
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
- Core 0.5.2: heirloom colour now comes from core (vendored; the module's own heirloom token is gone).
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

## 0.3.0 (2026-11-07)

Merchant tables groundwork (needs Item Piles; GM only). No shop tables are made yet: they come with the item sweep.

- **New: Merchants window** (Configure Settings → Loot Ledger → Merchants). Lists the world's Item Piles merchants by folder.
  Per merchant (or for a whole folder at once): vendor types (16: general, food, inn, reagents, trade, weapons, ammo, bows,
  guns, armor-heavy, armor-light, arcane, healer, tinker, fence, special), level band (B1–B6 by required level 1–10 … 51–60),
  size (city, town, outpost, wandering) and optional buy/sell price overrides. Shows which shop tables exist and which are
  missing.
- **Apply tables** writes each merchant's Item Piles *Populate items* list from roll tables named
  `Shop · <type> · B<n> · <basics|stock|rare>` (basics: every result once; stock and rare: rolled a number of times set by
  size) and its prices (buy ×1.0 / sell ×0.25 by default; arcane and healer buy ×1.1; fence buy ×1.25, sell ×0.5 and hides new
  items). Other tables already on the merchant are kept. Wandering merchants: pick the band when you apply.
- **Restock now** (per merchant, folder or all): deletes the merchant's items not marked *Keep on merchant* (or *keep if
  zero*, or services), rolls its tables, then marks the new basics infinite and not sellable back, on the merchant's copy
  only. It does not use Item Piles' "remove existing items" refresh, which is unreliable in Item Piles 3.3.4.
- **Dry run** previews both without writing. Each run posts a summary card whispered to the GMs.
- All numbers (prices per type, roll formulas per size, bands) are world data with these as defaults, editable through
  `api.merchants.setDefaults()`. New world setting **Merchant tables** (on by default) turns the whole tool off.
- **Remove merchant data** (in the window) resets the mapping and defaults, deletes the summary cards and removes Loot
  Ledger's tag from merchant items; Item Piles' own data is left alone.
- API (GM only, experimental): `api.merchants.plan/apply/restock/setMapping/unmap/defaults/setDefaults/open/health/
  cleanupPlan/removeData`, `api.healthReport({ timeoutMs })`.
- Under the hood: `scripts/merchants-model.mjs` (pure, tested in `tests/merchants.test.mjs`), `scripts/merchants.mjs`,
  `scripts/merchants-app.mjs`; world settings `merchantTables`, `merchantMap` (`{ v: 1, merchants }`, ≤ 500),
  `merchantDefaults` (`{ v: 1, types, sizes, bands }`); Item Piles added to `relationships.recommends`.

### Untested in Foundry
- [ ] With Item Piles 3.3.4 active: Configure Settings → Loot Ledger → Merchants opens; merchants appear by folder; a world
  without Item Piles shows the "not active" line instead.
- [ ] Pick types / band / size on a merchant and with the folder's Set: the choices stick after closing and reopening.
- [ ] Make by hand a table `Shop · general · B1 · basics` (two items) and `Shop · general · B1 · stock` (several items). Apply on a
  town general merchant: its Item Piles config → Populate items shows the basics table with *add all* and both results at 1, the
  stock table with `1d4+2`; a hand-added table there is still listed; buy/sell modifiers are 1 / 0.25. The missing rare table is
  listed in the window and on the card.
- [ ] Restock: items marked *Keep on merchant* and services stay; others are gone; new stock arrived once (no doubled
  quantities); the basics show infinite quantity and can't be sold to the merchant; the source table items are unchanged.
- [ ] Dry run (row, folder, all) changes nothing and posts a "(dry run)" card to GMs only.
- [ ] Wandering merchant with no band: Apply says "pick a band"; with the window's wandering band set it applies that band.
- [ ] Fence: buy 1.25, sell 0.5, *hide new items* on. Special only: Apply sets prices, Restock skips it.
- [ ] As a player: `game.modules.get("loot-ledger").api.merchants.apply()` warns "only a GM" and returns undefined.
- [ ] Setting **Merchant tables** off (reload): no Merchants menu, `api.merchants` is undefined.
- [ ] `await api.healthReport()` lists merchants mapped and missing tables; Remove merchant data resets the mapping and deletes
  the cards, and Item Piles' Populate items lists stay as they were.

## 0.2.5 (2026-11-07)

Security and speed. Nothing to do after updating.

- **The API is GM only where it matters.** `build`, `convertToPack`, `roll`, `findTable` and `auditHandAuthored` on
  `game.modules.get("loot-ledger").api` now check for a GM when called: on a player's client they show a warning and return
  `undefined` without doing anything. The pure helpers (`convert`, `sellPrice`, `bandForLevel`, `formatCoins`) and the constant
  lists stay open to everyone.
- **Faster conversion.** `convertToPack` reads each official and SRD compendium's index once per run instead of once per item.
- **Faster table lookups.** `roll` / `findTable` keep the tables compendium's index between calls; it is read again after any
  roll table is created, changed or deleted.
- Under the hood: new `scripts/gm.mjs` (`gateApi`), `GM_ONLY` list in `api.mjs`, lang key `LOOTLEDGER.Notice.GmOnly`, tests in
  `tests/api-gate.test.mjs`. The Release workflow now has a read-only build job and a separate upload job (the only one that can
  write), with every action pinned by commit SHA.

### Untested in Foundry
- [ ] As a player, in the console: `game.modules.get("loot-ledger").api.roll({ level: 5 })` shows "Loot Ledger: only a GM can do
  that." and returns `undefined`; the same for `build()`, `convertToPack()`, `findTable()`, `auditHandAuthored(item)`.
  `api.sellPrice(item)` and `api.formatCoins(150)` still work for the player.
- [ ] As a GM: `api.roll({ level: 5, chat: true })` still draws to chat; a second roll right after is quick (no new index read).
- [ ] As a GM: Build loot pools, then `api.roll(...)` immediately afterwards finds the new tables (the cache was cleared by the
  rebuild). Edit one table, roll from it again: works.
- [ ] As a GM: `api.convertToPack({ names: [...a few reflavoured items...] })` still links the official/SRD base items; the run is
  no slower with many items.

## 0.2.4 (2026-11-01)

- Fix: the tooltip description no longer repeats the price. A trailing "Sell Price: ..." line from the item's own text is left
  out of the tooltip (display only; the item is not changed). The footer still shows Price and Sells for.
- Fix: chest armour now compares with what the character wears on the body. Armour of any weight, natural armour and clothing
  count as one body slot, and so do items flagged as Chest, so a cloth vest compares with equipped leather armour or clothes.
  Items flagged Finger compare with rings. Other slots (head, legs, trinket and so on) still compare only within their own slot.
- Fix: for players, price and sells-for are hidden on unidentified items, like the stats. GMs still see them.
- New: a one-time hint. Players who have the item tooltip off get a notification, once per browser, saying it exists and where
  to turn it on (Configure Settings, hold Shift). A new world setting, **Tell players about the item tooltip** (on by default),
  switches the hint off. The tooltip itself stays off by default and is never turned on for anyone.

### Untested in Foundry
- Everything here is covered by Node tests only. In a world: the Thick Cloth Vest tooltip shows a comparison with equipped
  Leather Armor and with Clothes; a description ending "Sell Price: 1s" no longer shows it; an unidentified item shows no
  price to a player; a player with the tooltip off sees the notification once after loading, and not again after a reload.

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
