# Book day checklist (v0.3.0)

The 5e converter's numbers were set before an official World of Warcraft book for D&D existed. This checklist
turns book day into a fixed routine: read the book, write down what it says, edit values in one file, run the
tests, build in a world, work the review pages, release.

Everything happens on the `v030-dev` branch until step 9.

**Public repo rule.** This repository is public. Write down the book's *conventions* in your own words and as
numbers (for example "a +1 weapon is Uncommon", "potions in this tier cost about N gp"). Never paste the book's
rules text, item descriptions or tables into the repo, commits, tests or issues. Keep any notes that quote the
book outside the repo. SRD 5.2 text is fine; nothing else.

---

## 0. Before you open the book

```sh
git switch v030-dev && git pull
npm test                                        # should be all green
node tools/calibration-report.mjs > before.txt  # snapshot of today's rules and sample conversions (do not commit)
```

`before.txt` is your baseline. After every edit you can run the report again and diff it to see exactly what
changed (`diff before.txt after.txt`).

---

## 1. What to look up in the book

Work through this list and fill in the **Book says** column in your private notes. Each row names the
constant(s) in `scripts/rules.mjs` that the answer feeds (step 2 has the details).

| # | Question to answer from the book | Feeds |
|---|---|---|
| 1 | How does the book map WoW item quality (grey / white / green / blue / purple / orange) to 5e rarity? Is there a separate tier for "heirloom" or "artifact"? | `RARITY_BY_QUALITY`, `TIER` |
| 2 | What enhancement bonus (+1 / +2 / +3) does each rarity get, for weapons, shields and armour separately? Does a green weapon get +1, or an effect instead? | `GEAR_BONUS`, `ARMOR_BONUS`, `GREEN_RULE` |
| 3 | Which rarities require attunement? Are any effect types always attuned? | `ATTUNE_TIER`, `ATTUNE_RIDERS` |
| 4 | Pricing: does the book give gold prices by rarity, or a conversion from WoW gold? Does selling at half price still apply? Which coin ratio does it assume (100 copper per silver as in WoW, or 10 as in 5e)? | `PRICE_RULE`, the coin-ratio setting default |
| 5 | Stats: does the book turn Strength / Agility / Stamina / Intellect / Spirit on gear into anything? If so, what, and at what size per rarity? Does it ever raise an ability score? | `STAT_RULE`, `STAT_PASSIVE`, `TRINKET_RULE` |
| 6 | Hit chance, defence, armour, dodge / parry / block, crit, attack power, spell power, healing power, mana/health per 5 seconds: what does each become, if anything? | `HIT_RULE`, `DEFENSE_RULE`, `SPELL_RULE`, the `NOT_CONVERTED` list in `convert.mjs` |
| 7 | Resistances (+N Fire Resistance etc.): when does an item grant 5e Resistance? Is there a partial version? | `RESIST_RULE`, `SCHOOL_MAP` |
| 8 | Damage schools: which 5e damage type does each WoW school become (especially Nature and Arcane)? | `SCHOOL_MAP` |
| 9 | "Chance on hit" procs: how often do they fire in 5e (crit only, once per turn, X per rest)? How big are the dice by rarity? | `PROC_RULE`, `WEAPON_EXTRA_DICE`, `BLAST_USES` |
| 10 | Extra-attack procs (the "Flurry" family): uses per rest, attacks per use | `EXTRA_ATTACK_RULE`, `DAILY_USES` |
| 11 | Limited-use item powers in general: per Long Rest, per Short Rest, or charges with a recharge roll? How many per rarity? | `DAILY_USES`, `BLAST_USES` |
| 12 | Weapon types: does the book map WoW weapon types to specific 5e weapons (e.g. guns, fist weapons, polearms, thrown)? Does attack speed matter? | `WEAPON_RULES` |
| 13 | Armour: do cloth / leather / mail / plate map to light / medium / heavy, and does item level pick the specific armour? Do helmets, gloves, boots etc. give AC? | `CHEST_RULES`, `CLOTH_CHEST`, `SLOT_EQUIPMENT` |
| 14 | Consumables: healing potion dice by tier, mana potions (spell slots?), food and drink, elixirs and flasks | `POTION_HEALING`, `POTION_REFLAVOUR`, `MANA_POTION_SLOT`, `FOOD_HEALING`, `GEAR_HEALING` |
| 15 | Mounts: does the book have mounts as items? Speed, cost, rarity, riding skill? | No rule yet (see step 2, "New rules") |
| 16 | Item level vs character level: which character levels does each item-level band suit? | `LEVEL_BANDS` |
| 17 | Loot frequency: how often should each quality drop? | `DROP_WEIGHT` |
| 18 | Set bonuses, sockets / gems, enchantments, random "of the X" suffixes, bind on pickup / equip: any rules? | No rule yet (set lines are kept as flavour; suffix names feed `GREEN_RULE.identitySuffix`) |
| 19 | Anything the book does with WoW-only item mechanics we have not listed (durability, unique-equipped, class restrictions, quest items, reputation items) | Note it; most stay flavour |

Also write down 10 to 20 example items the book itself converts (name, quality, item level, what it becomes
in 5e). These are your calibration targets in step 4. Record only the name, the numbers and the result in your
own words.

---

## 2. Which constant to change for each finding

All of these are in `scripts/rules.mjs`, in the order they appear in the file. Change values only; the logic
in `convert.mjs` reads them. If the book contradicts a *rule shape* (not just a number), see "New rules" below.

| Section in rules.mjs | Constant | What it controls | Change it when the book says |
|---|---|---|---|
| 0 | `LEVEL_BANDS` | item-level range of each band, the character levels it suits, the label | which character levels an item level is for |
| 0 | `CREATURE_TABLE` | creature tables: band spread and the minimum item count before using every band | (rarely; table feel) |
| 1 | `RARITY_BY_QUALITY` | dnd5e rarity for each WoW quality, for every built item | quality-to-rarity mapping |
| 1 | `DROP_WEIGHT` | relative odds of each quality in the mixed Drop tables | how common each quality is |
| 1 | `PRICE_RULE` | `sellMultiplier` (listed price = this x vendor sell price) and the 10:1 minimum | the pricing convention |
| 2 | `WEAPON_RULES` | WoW weapon type (+ hands, slot, speed, name) to base 5e weapon; first match wins | weapon mapping |
| 2 | `CLOTH_CHEST` | cloth chest pieces: `"clothing"` (no AC) or `"padded"` | whether robes are armour |
| 2 | `SLOT_EQUIPMENT` | non-chest slots: worn item type (clothing, ring, trinket) | whether helmets, gloves etc. give AC |
| 2 | `CHEST_RULES` | armour class + item level to SRD armour | armour mapping |
| 3 | `TIER` | quality to power tier 0-4 used by every per-tier table | (only if a quality moves rarity) |
| 3 | `GEAR_BONUS` | weapons and shields: `plain` bonus and `withEffect` bonus per tier | enhancement bonus by rarity |
| 3 | `ARMOR_BONUS` | chest armour, same shape | armour bonus by rarity |
| 3 | `GREEN_RULE` | which stats count as caster stats; the "of the X" suffix list | how green items get their one benefit |
| 3 | `ATTUNE_TIER`, `ATTUNE_RIDERS` | from which tier everything attunes; which effect types always attune | attunement |
| 4 | `STAT_RULE` | minimum stat size to count (`minValue`, `perItemLevel`) | when a stat line matters |
| 4 | `STAT_PASSIVE` | the passive each main stat gives, sized per tier (`str.carryMultiplier`, `str.athleticsFrom`, `dex.initiative`, `con.hpPerLevel`, `int.dc` / `int.uses`, `wis.perDie`) | what stats do |
| 4 | `STAT_PASSIVE_NOTE` | the "(provisional)" label on stat passives | **set to a non-provisional label once the book confirms the stat rules** |
| 4 | `TRINKET_RULE` | trinket check / save bonus per tier, and the "defensive" test | trinkets |
| 5 | `HIT_RULE` | "+N% hit" on gear: minimum tier and the attack bonus | hit chance |
| 5 | `DEFENSE_RULE` | "+Defense / +Armor" on gear without AC: minimum tier and AC | defence lines |
| 5 | `SPELL_RULE` | spell power threshold, spell attack bonus per tier, healing die per tier | spell / healing power |
| 5 | `RESIST_RULE` | resistance threshold (`minValue`, `perItemLevel`) | when +N resistance becomes 5e Resistance |
| 5 | `SCHOOL_MAP` | WoW damage school to 5e damage type | damage types |
| 5 | `PROC_RULE` | proc size thresholds (`critBelow`, `burstFrom`) and dice per tier | chance-on-hit procs |
| 5 | `WEAPON_EXTRA_DICE` | a weapon's own "+X-Y Fire Damage" line: dice per tier | bonus elemental damage on weapons |
| 6 | `DAILY_USES` | uses per Long Rest per tier (Flurry and other limited features) | limited uses |
| 6 | `BLAST_USES` | uses per Long Rest for big proc blasts | proc blasts |
| 6 | `EXTRA_ATTACK_RULE` | extra attacks per use per tier; uses (points at `DAILY_USES`) | extra-attack procs |
| 7 | `POTION_HEALING` | healing potion dice by item level | potion dice |
| 7 | `POTION_REFLAVOUR` | which official Potion of Healing tier a healing potion becomes, by item level | potion tiers |
| 7 | `MANA_POTION_SLOT` | mana potion: highest spell slot level regained, by item level | mana potions |
| 7 | `FOOD_HEALING` | food: extra Short Rest healing by item level | food |
| 7 | `GEAR_HEALING` | "Use: Restores N health" on gear: dice by item level | healing gear |
| 8 | `EMPTY_REVIEW_TIER` | from which tier an item with nothing convertible goes to GM review | (rarely) |

Two settings live outside rules.mjs:

- Coin ratio default: `scripts/main.mjs`, setting `coinRatio`, `default: "100"`. Change only if the book
  assumes 10:1 coinage.
- Convert on build default: step 7.

**New rules** (the book adds a mechanic the converter has no slot for, such as mounts or sockets): do not
force it into an existing table. Write the convention down, leave those items on GM review for this release,
and open an issue describing the rule in your own words. v0.3.0 should ship with the numbers calibrated, not
with new mechanics.

---

## 3. Edit, test, bump the version

For each change:

1. Edit the value in `scripts/rules.mjs`. Update the comment above it so it says what the book convention is
   (in your own words, e.g. "book: +1 weapons are Uncommon"), and drop "provisional" where the book confirms a
   value.
2. Run `npm test`. `tests/rules.test.mjs` pins every value, so the test for that table fails. That is
   intended: change the expected value in the test to the new one, in the same commit. Each test name says
   which table it pins:
   - `rarity by quality`, `mixed drop weights`, `price rule ...` (section 1)
   - `tier and +N curves`, `chest armour bases by item level` (sections 2 and 3)
   - `stat passives and trinket bonuses` (section 4; note the `<= 2` cap check on trinkets: if the book allows
     more, change that assertion and its message too)
   - `line rules` (section 5), `limited uses ...` (section 6)
   - `level bands, creature tables, potion reflavour, review threshold` (sections 0, 7, 8)
   - `drop table description follows DROP_WEIGHT` (expects the percentages written out; recompute them)
   - `tests/build.test.mjs` and `tests/replace-list.test.mjs` may also assert on converted output (bonus,
     rarity, feature names). If they fail after a deliberate change, update the expected value; if they fail
     for a reason you did not intend, the change is wrong.
3. Bump `CONVERTER_VERSION` in `scripts/convert.mjs` **once** for the whole book-day calibration (2 -> 3).
   Changing rules values already changes every item's hash, but the version bump makes the change visible on
   each item (`flags["loot-ledger"].converted.version`) and covers logic edits too. If `tests/ledger.test.mjs`
   hard-codes `converterVersion: 2`, that is only an input to the hash test and can stay.
4. Run `npm test` again until green, then commit (one commit per area is easiest to review, e.g. "Calibrate
   +N curves to the book", "Calibrate stat passives").

---

## 4. Compare against the book's own examples

```sh
node tools/calibration-report.mjs --items > after.txt && diff before.txt after.txt
node tools/calibration-report.mjs --detail --items             # full feature text per item
node tools/calibration-report.mjs --rules                      # just the rules tables
node tools/calibration-report.mjs --ratio 10                   # prices with 10:1 coinage
```

For the 10 to 20 book examples from step 1, write them into a private JSON file (outside the repo, or
gitignored) in the same shape as `tools/fixtures/sample-items.json`:

```json
[
  { "name": "Example Sword", "quality": "rare", "type": "weapon", "sell": 5000,
    "lines": ["One-Hand", "Sword", "30 - 55 Damage", "Speed 2.40", "+8 Strength", "Item Level 42"] }
]
```

`lines` are the item's tooltip lines after its name, exactly as they appear in the WoW tooltip; `sell` is the
vendor sell price in copper; `type` is `weapon`, `equipment`, `consumable` or `loot`. Then:

```sh
node tools/calibration-report.mjs --items path/to/book-examples.json
```

Compare each row's rarity, bonus, attunement, uses, features and price against what the book gives. Adjust
rules.mjs and repeat until they match or the difference is a deliberate choice (write the reason in the
rules.mjs comment). The bundled sample file covers every shape the converter knows (weapons of each family,
chest armour of each class, other slots, trinkets, shields, wands, consumables, hand-written items, goods);
re-check it for anything that now looks wrong.

---

## 5. Fill the replace list (in the world)

The source module ships hand-written 5e rules for some items. The review found 47 that do not trace to their
tooltip; `scripts/replace-list.mjs` names 3 of them. The other 44 are found in the world:

1. Open the world with `wow-classic-items` and Loot Ledger (this branch) enabled, as GM.
2. Press F12, open the Console, and run:

   ```js
   const ll = game.modules.get("loot-ledger").api;
   const audit = await ll.auditHandWritten({ journal: true });
   ```

   This reads every source item, keeps the ones with hand-written rules, and runs the same traceability
   audit Build uses. It prints:
   - a count line: hand-written items, how many fail, how many are already on the replace list;
   - a table of every failing item with the claims that have no backing tooltip line;
   - a snippet of replace-list entries for the failing items that are not on the list yet.

   With `journal: true` it also writes a **Hand-written audit** page to the Loot Ledger · Build Report journal
   entry, listing failing and passing items. It does not change any item.
3. Items that **fail** the audit are already replaced by Build automatically. Adding them to the list is still
   useful (it records the decision and survives future audit changes), so paste the snippet.
4. Items that **pass** the audit but the review judged failing are the ones only the list can catch. Read
   each passing item on the journal page against its tooltip. For each one you judge failing, collect its
   exact name and run:

   ```js
   const more = await ll.auditHandWritten({ add: ["Item Name One", "Item Name Two"] });
   copy(more.snippet);   // copies the entries to the clipboard
   ```
5. Paste the entries into `REPLACE_LIST` in `scripts/replace-list.mjs`. Prefer entries with `itemId` (the
   snippet includes it when the source has one). Keep each `note` short and in your own words; never paste
   the hand-written rules text.
6. When the list reaches the review total, it should hold 47 entries (`REPLACE_LIST_EXPECTED`). If review on
   book day finds a different total, change `REPLACE_LIST_EXPECTED` to the real number.
7. `npm test` (the replace-list test checks entries hold only `name` / `itemId` / `note`, no duplicates, and no
   more than the expected total). Commit: "Replace list: N of 47".

---

## 6. Build in the world (conversion on)

0. **Run a dry run first.** It runs every stage (conversion, rules, hashing, sync planning, roll-table planning, report
   generation) but writes nothing: no compendium, folder, Build Report journal or chat message is created or changed,
   and no confirm dialog appears. Paste into the console (F12), as GM:

   ```js
   const ll = game.modules.get("loot-ledger").api;
   const dry = await ll.build({ dryRun: true, convert: true });
   console.table(dry.build);            // counts: copied, converted, review, replaced, kept, skipped, removed
   console.log(dry.tables, "roll tables planned;", dry.plan.convert.skip.length, "conversions unchanged");
   console.table(dry.report.rows.filter(r => r.review).map(r => ({ name: r.name, lines: r.reviewLines.join(" | ") })));
   ```

   `dry.plan` holds the item sync plans and the planned tables, `dry.report.pages` the Build Report pages and
   `dry.report.summaryHtml` the chat summary. Packs that already exist are only read; missing ones count as empty.
   If the counts look wrong (a huge review list, nothing converting), fix the rules and dry-run again before
   writing anything.

1. Settings -> Loot Ledger -> turn on **Convert items to 5e when building** -> **Build loot pools**.
   (Or `await game.modules.get("loot-ledger").api.build({ convert: true })`.)
2. The first build after a rules change re-converts every item (about 12,000; a few minutes). Later builds
   only rewrite items whose source or rules changed.
3. Read the GM chat whisper: copied, converted, GM review needed, hand-written replaced / kept.

---

## 7. Work the Build Report review pages

Open the **Loot Ledger · Build Report** journal entry. Do the per-item sweep on the **Review board** (button
at the top of the Build Report, the Loot Ledger settings window, or `game.modules.get("loot-ledger").api.reviewBoard()`):

- Filter by **reason** first: each reason is one missing rule, so a reason with many items is a rule to add in
  rules.mjs / convert.mjs, not items to fix by hand. Leave those items pending, fix the rule, build, re-check.
- For the one-offs, per item: **A**ccept (fine as converted), **T**weak (edit the sheet; marked tweaked when you
  close it), **S**kip (come back later), **R**eject (left off the roll tables from the next build). Arrow keys
  move between items. Write a short note on anything you tweak or reject.
- Accepted and tweaked items are **not overwritten** by later builds, even after a rules change. To pick up a
  rules change on them anyway, run `api.build({ force: true })`: every item is rewritten, accepted / tweaked go
  back to pending (manual edits lost), notes stay. Rejected and skipped items keep their status.
- The progress line shows pending / accepted / tweaked / skipped / rejected; the build whisper shows
  "kept as reviewed" and "rejected" counts.

- **Summary**: counts, and the replace-list status. "No source item found" means a replace-list name has a
  typo or the item was renamed (use its `itemId`). "Not hand-written" means the entry has no effect; remove it.
- **GM review (N)**: every item with a line the converter has no rule for, with the exact lines. For each
  group of similar lines decide one of:
  - it should be a rule -> add or adjust a value in rules.mjs (or note it as a new rule for after the release);
  - it is flavour -> leave it (the item is already usable, with only its traceable features);
  - one-off -> fix that item by hand in the world after the build (it will be overwritten by a later build
    only if its source or the rules change).
  Aim to bring the count down by fixing rules, not items. Re-run `node tools/calibration-report.mjs` and
  Build after each round.
- **Hand-written (replaced / kept)**: check that every "kept" item really traces to its tooltip; anything
  that does not goes on the replace list (step 5).
- **Hand-written audit** (from step 5): reference for the replace list.

Spot-check 10 converted items in each band by opening them: the 5e block under the tooltip should name the
source line of every feature.

When the review count is acceptable, flip the default so new worlds convert:

- `scripts/main.mjs`: in the `convertOnBuild` setting, change `default: false` to `default: true`, and update
  the comment above it.
- `README.md`: "World setting, **off by default** in this version" -> on by default; also the line in
  "5e conversion" saying it is off by default while rules are tuned.
- `lang/en.json`: the setting hint is fine as is; adjust only if wording mentions "off".
- `tests/_foundry.mjs` sets `convertOnBuild: false` for the mock world explicitly, so tests are unaffected.

`npm test`, commit: "Conversion on by default".

---

## 8. Final checks on the branch

- [ ] `npm run check` and `npm test` green.
- [ ] `node tools/calibration-report.mjs` reads sensibly; no "(provisional)" left on rules the book confirmed.
- [ ] `CONVERTER_VERSION` bumped once.
- [ ] Replace list at its review total (or the total corrected).
- [ ] Review board: no pending items you meant to decide; rejected items absent from the tables after a build.
- [ ] `CHANGELOG.md` 0.3.0 section: add "Calibrated against the official book" with a short list of what
      changed (numbers only, your own words), the replace-list count, and "conversion on by default". Change
      "(unreleased)" to the release date.
- [ ] `module.json` version is `0.3.0` (it already is; the release workflow also sets it from the tag).
- [ ] No book text, no non-SRD rules text, no private campaign or world details anywhere in the diff:
      `git diff main...v030-dev` and read it.
- [ ] `git push origin v030-dev`; the Tests workflow passes on GitHub.

---

## 9. Merge and release v0.3.0

```sh
git switch main && git pull
git merge --no-ff v030-dev -m "Merge v030-dev: 5e conversion in Build, calibrated rules (v0.3.0)"
npm test
git push origin main
```

Then on GitHub: **Releases -> Draft a new release**, tag `v0.3.0` on `main`, title "v0.3.0", paste the 0.3.0
CHANGELOG section as the notes, **Publish**. The Release workflow sets the version and URLs in `module.json`,
builds `module.zip` and attaches both. Check the release has `module.json` and `module.zip`, then in Foundry
update the module from the manifest URL and run one more Build to confirm.

---

## Quick reference

| Task | Command |
|---|---|
| All rules as a table | `node tools/calibration-report.mjs --rules` |
| Sample conversions | `node tools/calibration-report.mjs --items [file.json]` |
| Full feature text | `node tools/calibration-report.mjs --detail --items [file.json]` |
| Machine-readable | `node tools/calibration-report.mjs --json [file.json]` |
| Tests | `npm test` |
| Rules in the world | `game.modules.get("loot-ledger").api.rules()` |
| Hand-written audit | `await game.modules.get("loot-ledger").api.auditHandWritten({ journal: true })` |
| Convert one item | `game.modules.get("loot-ledger").api.convert(item)` |
| Dry run (writes nothing) | `await game.modules.get("loot-ledger").api.build({ dryRun: true, convert: true })` |
| Build with conversion | `await game.modules.get("loot-ledger").api.build({ convert: true })` |
