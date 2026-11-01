# Loot Ledger

A Foundry VTT module for **dnd5e** that turns a classic MMO item compendium into **priced, rollable loot pools**.

Loot Ledger ships no item data of its own. It reads the item compendium from the
[`wow-classic-items`](#requirements) module at runtime and generates, inside your world:

- **Loot Ledger · Items**: a world compendium with a copy of every source item, re-priced so that
  selling it gives exactly the original vendor sell price, with dnd5e rarity set from item quality.
- **Loot Ledger · Converted Items** (only when 5e conversion is on): every item converted to dnd5e rules.
- **Loot Ledger · Tables**: a world compendium of roll tables by level band, quality, item type,
  mixed drop and creature type. Every result links to an item in the converted compendium when conversion is
  on, otherwise in the items compendium.
- **Loot Ledger · Build Report**: a journal entry with the last build's summary and the GM review list.

The source module and its compendium are never modified.

There is also an optional, **off-by-default 5e conversion** that rewrites each source item as a dnd5e (2024 rules) item from its own tooltip lines, flagging anything it can't translate for the GM to review. Its rules are still being tuned; see [5e conversion](#5e-conversion).

## Contents

- [Requirements](#requirements) · [Install](#install) · [Quick start](#quick-start)
- [Building the loot pools](#building-the-loot-pools) · [Prices](#prices) · [Rarity](#rarity) · [Level bands](#level-bands)
- [Roll tables](#roll-tables) · [Item flags](#item-flags) · [Review board](#review-board) · [Quality colours](#quality-colours)
- [API](#api) · [Item tooltip (hold Shift)](#item-tooltip-hold-shift) · [Public API and hooks](#public-api-and-hooks)
- [5e conversion](#5e-conversion) · [Development](#development) · [License](#license)

## Requirements

| | |
|---|---|
| Foundry VTT | v13 or later (verified on v14) |
| System | dnd5e 5.x or 6.x |
| Module | `wow-classic-items` (provides the source item compendium), enabled in the world |

## Install

Install with this manifest URL (Setup → Add-on Modules → Install Module):

```
https://github.com/cocoomg11/loot-ledger/releases/latest/download/module.json
```

Enable **Loot Ledger** and `wow-classic-items` in your world.

## Quick start

1. **Install the source module first.** Loot Ledger ships no items. Install and enable `wow-classic-items` (its item compendium is what gets copied), then enable **Loot Ledger**. You need a dnd5e world and you must be the GM.
2. **Open the settings.** Go to **Game Settings › Configure Settings › Loot Ledger**. Pick a **Coin ratio**: *100:1* if your world uses three coins (copper, silver, gold), or *Standard 5e (10:1)* if it uses normal 5e coins.
3. **Build.** Click **Build loot pools** (under *Loot pools*) and confirm. A progress bar runs for a few minutes. Nothing outside the two Loot Ledger compendiums is touched.
4. **Find your tables.** Open the **Compendium Packs** sidebar and look for **Loot Ledger · Tables**. Open one, for example `Loot · Band 2 (L3–5) · Drop (mixed)`, and click **Roll** or **Draw**. Each result links to an item.
5. **Hand out the loot.** Drag an item from **Loot Ledger · Items** onto a character sheet or an NPC. Its price is already set so that selling it pays the original vendor amount.
6. **Roll from a macro (optional).** Make a script macro with `game.modules.get("loot-ledger").api.roll({ level: 6, chat: true })` to draw a mixed drop for a level 6 party and post it to chat. See [Public API and hooks](#public-api-and-hooks) for more.

<!-- screenshot: the Loot Ledger settings page with Coin ratio and the Build loot pools button -->
<!-- screenshot: the Loot Ledger · Tables compendium open on a mixed-drop table -->

## Building the loot pools

1. As GM, open **Game Settings → Configure Settings → Loot Ledger**.
2. Choose a **Coin ratio** (see below) and whether to **Convert items to 5e when building** (see below).
3. Click **Build loot pools** and confirm.

A progress bar shows the copy (about 12,000 items in batches of 500), the 5e conversion when it is on, and
table generation. The first build takes a few minutes.

**Re-running is incremental.** Every item Loot Ledger writes carries a hash of its source item and of every
setting and rule that shaped it (coin ratio, the values in `scripts/rules.mjs`, converter version, replace
list, installed official compendiums). A re-run skips items whose hash is unchanged, rewrites the ones that
changed, and removes items that are no longer in the source. Running it twice never duplicates anything, and a
build that stops part-way (closed tab, server restart) picks up where it left off the next time. Roll tables
are regenerated every time. Item ids are kept from the source compendium and table ids are derived from table
names, so UUID links stay valid across rebuilds. Nothing else in the world is touched apart from the Build
Report journal entry.

Change the coin ratio, update the source module or edit a rule? Just build again. To rewrite everything
anyway: `game.modules.get("loot-ledger").api.build({ force: true })`.

After each build the GM gets a chat whisper with the counts (copied, converted, GM review needed, hand-written
rules replaced, skipped as unchanged) and a link to the **Loot Ledger · Build Report** journal entry.

### Convert items to 5e when building

World setting, **off by default** in this version. When on, Build also runs the 5e converter (see
[5e conversion](#5e-conversion)) over every copied item and writes the results to **Loot Ledger · Converted
Items**; the roll tables then point at the converted versions. The plain copies in **Loot Ledger · Items** are
kept, so turning the setting off and building again points the tables back at them.

### GM review list

The converter never invents a feature. A tooltip line it has no rule for stays as flavour on the item (marked
**GM review** in the item's description) and the item is listed on the **GM review** page of the Build Report,
with the exact lines to look at and a link to the item. Very Rare or better items that end up with nothing beyond
their base item are listed too. An item the converter fails on outright is listed with the error, and the tables
use its plain copy. The **Hand-written** page lists source items whose own 5e rules were replaced (with the
reason) or kept.

<!-- screenshot: a Loot Ledger item sheet showing its price and the "Sells for" line -->

## Prices

The source data records each item's vendor sell price (gold / silver / copper, 100 copper = 1 silver,
100 silver = 1 gold). In dnd5e, characters usually sell items for **half** their listed price, so Loot
Ledger sets:

> **dnd5e price = 2 × vendor sell price**

so selling an item at half price yields exactly its classic sell price. The price is stored in the
largest denomination it reaches, with decimals, so mixed amounts stay readable: 1g 2s 3c sells → listed
2g 4s 6c → stored as 2.0406 gp; 23s 50c sells → 47 sp; 7c sells → 14 cp. Multiplying the stored value by
the denomination's conversion (rounded to the nearest coin) gives back the exact copper amount. The item
sheet and chat cards show the exact value; the actor inventory column and item header round to three
decimals, so they can hide the last copper.

**Coin ratio** setting:

- **100:1 (default)**: classic MMO coinage, for worlds whose currency is configured as three coins at
  100:1 (copper / silver / gold). Copper, silver and gold carry over one-to-one.
- **Standard 5e (10:1)**: converted by value, 1 classic gold = 1 gp, so 1 classic silver = 1 cp. Prices
  are rounded to the nearest copper piece with a minimum of 1 cp, so very cheap items lose precision.

Items with no vendor price get price 0 and the flag `noSell: true`. Each copied item also gets a small
"Sells for 1g 2s 3c" line at the end of its description.

## Rarity

| Item quality | dnd5e rarity |
|---|---|
| Poor (grey), Common (white) | common |
| Uncommon (green) | uncommon |
| Rare (blue) | rare |
| Epic (purple) | very rare |
| Legendary (orange) | legendary |
| Artifact / heirloom | artifact |

Quality is read from the tooltip title colour in the source data. The original quality is kept in the
item flags.

## Level bands

Items are banded by item level (or required level when the item level is missing). Bands are mapped to
character levels for a 1–20 game:

| Band | Item level | Character levels | `bandForLevel()` returns this band for |
|---|---|---|---|
| 1 | 1–10 | L1–3 | 1–2 |
| 2 | 11–20 | L3–5 | 3–4 |
| 3 | 21–30 | L5–7 | 5–6 |
| 4 | 31–40 | L7–9 | 7–8 |
| 5 | 41–50 | L9–11 | 9–10 |
| 6 | 51–60 | L11–14 | 11–14 |
| 7 | 61+ | L15+ | 15–20 |

## Roll tables

Tables are named so they sort cleanly, e.g. `Loot · Band 2 (L3–5) · Uncommon`. Empty tables are skipped.

- **By quality** (`· Poor`, `· Common`, `· Uncommon`, `· Rare`, `· Epic`): one table per quality per band,
  plus one `Loot · Legendary & Artifact` table across all bands.
- **By item type**: per band, `Weapons`, `Armour · Head & Shoulders`, `Armour · Chest & Legs`,
  `Armour · Hands, Wrists, Waist & Feet`, `Armour · Cloaks`, `Shields`, `Jewellery & Trinkets`
  (neck, finger, trinket, held in off-hand, relic), `Consumables`, `Trade Goods & Bags` and `Junk`
  (grey non-gear items). Grey weapons and armour appear under their gear type.
- **Mixed drops** (`· Drop (mixed)`): one per band. Rolls one of that band's quality tables with weights
  poor 60, common 25, uncommon 12, rare 2.5, epic 0.5 (stored as 120 / 50 / 24 / 5 / 1). Missing
  qualities are left out and the rest re-weighted. Foundry rolls the inner table automatically.
- **By creature type** (`· Creature · Beast` …): per band, grey junk that fits the creature (about half the
  time) or the band's mixed drop (the other half). Junk comes from the same band ±1 when at least three
  items match, otherwise from any band.

Creature keyword lists (matched at the start of a word in the item name, case-insensitive):

| Creature | Keywords |
|---|---|
| Beast | fang, claw, talon, pelt, hide, fur, hair, tooth, teeth, tusk, horn, scale, feather, beak, bill, paw, tail, flank, mane, wing, eye, heart, gland, bladder, carcass, whisker, palp, limb, web, shell, venom, spine, meat, egg, skin, sinew, antler, hoof, snout, stinger, mandible, chitin, carapace, ear |
| Humanoid | watch, bauble, doll, diary, page, letter, boot, glove, belt, candle, barrel, mug, flask, bottle, cup, pipe, dice, comb, spoon, fork, coin, locket, button, buckle, trinket, map, book, note, toy, collar, rag, tooth, gold, silver, copper, pouch; **plus the band's grey weapons and armour** |
| Undead | bone, skull, rib, femur, jawbone, dust, ash, ectoplasm, shroud, rot, decay, grave, coffin, tomb, flesh, maggot, ichor, embalm, skeletal, ghost, spectral, lifeless, ancient |
| Elemental | elemental, ember, ash, stone, pebble, rock, crystal, shard, earth, water, flame, fire, frost, ice, cinder, sand, slime, ooze, essence, mote, core, chip, salt, charged, smooth, molten, storm |
| Dragonkin | dragon, drake, whelp, molting, wyrm, brood |
| Demon | demon, fel, imp, infernal, satyr, horn, hoof, sulfur, brimstone, shadow, void, familiar |
| Giant | giant, ogre, boulder, stone, rock, toe, knuckle, club, huge, massive, large, thick |
| Mechanical | gear, cog, bolt, spring, sprocket, scrap, metal, iron, gizmo, gadget, widget, mechanical, rust, wire, watch, bracket, flywheel, barrel, copper |

Not rolled: unsellable non-gear items (mostly quest items) and internal placeholder entries. They are still
copied into the items compendium.

## Item flags

Each copied item carries `flags["loot-ledger"]`:

```js
{
  sourceUuid,        // UUID of the original item in the source compendium
  quality,           // poor | common | uncommon | rare | epic | legendary | artifact
  itemLevel,         // number or null
  requiredLevel,     // only when the item has one
  vendorSellCopper,  // classic sell price in copper
  vendorSell,        // e.g. "1g 2s 3c"
  noSell,            // true when it cannot be sold
  slot,              // e.g. "Chest", "Two-Hand", null
  category,          // item-type table key
  band,              // 1–7
  coinRatio,         // "100" or "10", the setting used for this build
  hash               // build fingerprint: source + settings + rules; unchanged hash = skipped on rebuild
}
```

Converted items also carry `riders` and `converted` (`needsReview`, `review`, `notConverted`,
`handAuthored`, `handAuthoredKept`, `handAuthoredReplaced`, `replaceList`, `summary`, `version`).

Review board decisions are stored on the converted item as `review` (`status`: pending, accepted, tweaked,
skipped or rejected; `note`, `by`, `at`). Accepted and tweaked items are not rewritten by later builds unless
`build({ force: true })`; rejected items are left out of the roll tables.

## Review board

GM only (setting **Review board**, on by default). Open it from the Loot Ledger settings window, the button on
the **Loot Ledger · Build Report** journal entry, or `api.reviewBoard()`. It lists every converted item that
needs review, with filters (status, quality, item type, slot, reason, search) and progress counts. For each item
it shows the source tooltip with the unconverted lines highlighted, the converted result and a note field.
Actions: **Accept** (A), **Tweak** (T: opens the item sheet, marked tweaked on close), **Skip** (S), **Reject**
(R: left out of the roll tables from the next build); arrow keys move between items.

## Quality colours

Setting **Quality colours** (on by default): item names show in their quality colour on actor and item sheets,
chat item cards, content links, roll tables, the Items sidebar, Item compendiums and Item Piles windows. Items
with no quality are coloured by dnd5e rarity (setting, on by default). GMs can set a quality on any item, for
example homebrew or book items: the **Quality** dropdown in the item sheet header, **Set quality** in the Items
sidebar / compendium context menu, or:

```js
await ll.setQuality(items, "epic");   // documents or UUIDs; poor | common | uncommon | rare | epic | legendary | artifact | heirloom
await ll.setQuality(items, null);     // clear (falls back to rarity)
await ll.qualityOf(item);             // the quality the item shows
```

## API

```js
const ll = game.modules.get("loot-ledger").api;

await ll.build();                                   // same as the settings button (asks to confirm)
await ll.build({ confirm: false });                 // scripted rebuild (incremental)
await ll.build({ confirm: false, convert: true });  // override the conversion setting for this run
await ll.build({ confirm: false, force: true });    // ignore stored hashes, rewrite every item

await ll.roll({ level: 6 });                        // mixed drop for a level 6 party → Item[]
await ll.roll({ band: 3, quality: "rare" });        // rare items, band 3
await ll.roll({ band: 2, type: "weapon", count: 3 });
await ll.roll({ level: 12, creature: "undead", chat: true });  // also posts the draw to chat

ll.sellPrice(item);     // { copper: 10203, text: "1g 2s 3c", noSell: false }
ll.bandForLevel(9);     // 5
await ll.findTable({ band: 4, type: "jewelry" });   // the RollTable document
```

`roll()` query keys: `band` (1–7) or `level` (1–20), and at most one of `quality`
(`poor` `common` `uncommon` `rare` `epic` `legendary`), `type` (`weapon` `armor-head` `armor-body`
`armor-limbs` `armor-back` `shield` `jewelry` `consumable` `goods` `junk`) or `creature` (`beast`
`humanoid` `undead` `elemental` `dragonkin` `demon` `giant` `mechanical`). With none of them it rolls
the band's mixed drop. A `loot-ledger.ready` hook fires on ready with the API as its argument.

## Item tooltip (hold Shift)

An optional MMO-style tooltip for dnd5e items. It is a **client setting, off by default**
(*Configure Settings → Loot Ledger → Item tooltip (hold Shift)*), so each user turns it on for themselves.
When it is on, **hold Shift** while hovering an item; releasing Shift, clicking, scrolling or moving off the item hides it.
Without Shift nothing changes, and dnd5e's own tooltips work as before.

It works on any item, not just Loot Ledger's copies, wherever the item's row carries its id or UUID: actor sheets
(including the dnd5e 6 sheets), the Items sidebar, compendium windows, the dnd5e compendium browser, chat item cards and
item links. **Item Piles** windows (item piles, merchants, vaults) work too: their rows carry no item id, so Loot Ledger reads the
item from Item Piles' own row hooks, or, for a row drawn before you turned the tooltip on, from the pile's items by the row's name
and image (two identical items in one pile cannot be told apart and show no tooltip). Other modules' item lists work when their
rows carry an item id or UUID.

Contents, top to bottom:

- **Name** in the rarity colour: mundane grey, common white, uncommon green, rare blue, very rare purple, legendary orange,
  artifact gold (the shared item quality colours of the author's modules, darkened on the light theme). Loot Ledger items use their original quality (poor items show grey); other items use their dnd5e rarity.
- Rarity, item type and slot (weapon type, armour weight, equipment or consumable type; the source slot for Loot Ledger items).
- Damage (with the magical bonus), versatile damage, range, AC (with the Dex cap), mastery and item properties.
- Magical bonus, attunement, charges / uses with their recovery period, Strength requirement.
- A short plain-text excerpt of the item's own description (HTML, links and the "Sells for" line are stripped).
- Price in gold / silver / copper (`1g 2s 3c`) using the world's currency conversions and the *Coin ratio* setting, the classic sell price for Loot Ledger
  items, and weight.
- **Compare**: if your character already has an *equipped* item in the same slot, arrows show the difference in AC, magical
  bonus and average damage (↑ better, ↓ worse). Slots are body armour, shield, melee weapon, ranged weapon, ring, and the
  source slot for Loot Ledger items. "Your character" is a controlled token you own, otherwise your assigned character.

Unidentified items show only their unidentified name and description to players (GMs see everything). The tooltip follows the
light / dark theme of the window it is shown over, never takes focus, ignores the mouse and does not move any layout.
It only reads documents; it never writes anything.

## Public API and hooks

Everything below is reached through `game.modules.get("loot-ledger").api` or the hooks listed here. Do not import
the module's scripts or read its settings directly. **Stable** = kept compatible across 0.x releases;
**experimental** = may change in any release.

| Name | Status | What it does |
| --- | --- | --- |
| `api.build(options)`, `api.roll(query)`, `api.findTable(query)` | stable | Build the pools; roll loot; find a generated table. GM only. |
| `api.sellPrice(item)`, `api.bandForLevel(level)`, `api.formatCoins(copper)` | stable | Price and band helpers. |
| `api.BANDS`, `api.QUALITIES`, `api.TYPES`, `api.CREATURES` | stable | Lookup lists. |
| `api.setQuality(items, quality)`, `api.qualityOf(item)` | stable | Quality colours (undefined `setQuality` while the setting is off). |
| `api.convert`, `api.convertToPack`, `api.rules()`, `api.replaceList()`, `api.auditHandWritten()`, `api.auditHandAuthored()` | experimental | 5e conversion and calibration tools. |
| `api.reviewBoard()`, `api.rollSuffix(item, options)`, `api.suffixes()` | experimental | Review board and random suffixes. |
| `api.removeData({ dryRun, confirm, itemFlags })` | experimental | GM: remove Loot Ledger's data (see below). |
| Hook `loot-ledger.ready` (argument: the API) | stable | Fires on `ready`. |
| Hook `loot-ledger.itemDropped` | experimental | Fires when a Loot Ledger item is rolled or lands on an actor. |

**GM only (0.3.0):** `build`, `roll`, `findTable`, `convertToPack`, `auditHandWritten`, `replaceList`, `rollSuffix`, `removeData`, `reviewBoard` and `setQuality` show a "GM only" notice and return `undefined` for players. The pure helpers (`convert`, `rules`, `suffixes`, `qualityOf`, `auditHandAuthored`, `sellPrice`, `bandForLevel`, `formatCoins` and the lookup lists) stay open. Random suffixes are rolled only for items created by a GM user.

```js
// source "roll": api.roll() drew the item from a table.
// source "actor": a Loot Ledger item was created on an actor or Item Piles pile (active GM's client only).
Hooks.on("loot-ledger.itemDropped", ({ item, source, actor, table, query }) => {
  console.log(source, item.name);
});
```

The payload is one object: `item` (the Item document) and `source` always; `actor` for `"actor"`; `table` and
`query` for `"roll"`. Fired with `Hooks.callAll`, so return values are ignored.

### Where Loot Ledger keeps its data, and removing it

- World compendiums **Loot Ledger · Items**, **· Converted Items** and **· Tables**.
- The **Loot Ledger · Build Report** journal entry.
- World settings (all small: booleans and one short string; nothing grows over time).
- Item flags under `flags["loot-ledger"]` (source link, quality, price, hash, review decision, random suffix).
  They live on the items in those compendiums and on any item you copied out of them.

Everything is stored under its own `loot-ledger` namespace. To remove it, run `await ll.removeData()` for a dry
run (it lists what would go), then `await ll.removeData({ dryRun: false })` to delete the compendiums, the Build
Report and the settings after a confirm dialog. Add `itemFlags: true` to also clear `flags["loot-ledger"]` from
world and actor items (this removes hand-set qualities too). Export a backup first.

## 5e conversion

`scripts/convert.mjs` turns each source item into a dnd5e (2024 rules) item. Build runs it when the **Convert
items to 5e when building** setting is on (off by default; its rules are still being tuned). The ground rules:

- **Traceable.** Every feature comes from one specific tooltip line (a stat line, an Equip / Use /
  Chance-on-hit line, a resistance, the weapon damage line, or the item type and slot). Quality on its own
  only sets the plain enhancement bonus of weapons, armour and shields, and attunement.
- **Explained.** Each feature is written out in full under the tooltip, with a *Source:* note naming the
  line it came from. Every other line is listed under **Not converted** with the reason.
- **Proportionate.** The line decides what a feature is; rarity (and for weapons the level band) decides how
  big it is, in line with SRD magic items of the same rarity.
- **Flag, don't guess.** A line with no rule stays as flavour, and the item gets
  `flags["loot-ledger"].converted.needsReview = true` and a **GM review** note.
- **No automation yet.** Riders (extra damage, check or save bonuses, resistances and so on) are text only
  and are recorded in `flags["loot-ledger"].riders` for a later automation pass. Only the enhancement bonus
  uses dnd5e's own `magicalBonus` field.

Items the source module converted by hand are kept only when every mechanic in their rules traces to the
tooltip (`auditHandAuthored`) and the item is not on the replace list; otherwise Loot Ledger's own conversion
replaces them.

### Calibration: `scripts/rules.mjs`

Every tunable number lives in one commented file, `scripts/rules.mjs`, so tuning is editing values, not logic:
rarity by quality, mixed-drop weights, the price rule, base weapon and chest-armour mapping, the +N curves for
weapons, shields and chest armour (`GEAR_BONUS`, `ARMOR_BONUS`), the green-item rule, attunement, stat passives
(`STAT_RULE`, `STAT_PASSIVE`), trinket bonuses (`TRINKET_RULE`), hit / defence / spell power / resistance
thresholds, proc dice (`PROC_RULE`), limited uses (`DAILY_USES` for Flurry and the like, `BLAST_USES`) and
consumable tables. `convert.mjs` re-exports them. Changing any value changes every affected item's hash, so the
next build re-converts exactly those items. `tests/rules.test.mjs` pins the current values; update it alongside
any deliberate change. Level bands (`LEVEL_BANDS`) and creature-table spread (`CREATURE_TABLE`) live there too.

`node tools/calibration-report.mjs` prints every rule as a table and shows how a set of sample items converts
(`tools/fixtures/sample-items.json`, about 40 made-up items, or your own JSON file; `--detail` prints each
item's features in full, `--json` gives machine-readable rows). [BOOK-DAY.md](BOOK-DAY.md) is the step-by-step
calibration and release checklist.

### Replace list: `scripts/replace-list.mjs`

Some hand-written conversions from the source module pass the automatic audit but were found by review not to
trace to their tooltip. List them in `REPLACE_LIST` (by exact source item name, or by classic `itemId`, which is
matched first) and Build uses Loot Ledger's conversion for them. The list holds identifiers only. It currently
names 3 of the 47 known failures; the Build Report shows which entries matched a hand-written item, which matched
an item with no hand-written rules, and which matched nothing.

```js
const ll = game.modules.get("loot-ledger").api;
ll.convert(sourceItem);                                    // → { data, result } without saving anything
ll.auditHandAuthored(sourceItem);                          // → { pass, problems } for a hand-written source item
await ll.auditHandWritten();                               // every hand-written source item: failing / passing,
                                                           // on the replace list or not, plus a paste-ready snippet
await ll.auditHandWritten({ journal: true });              // same, also as a "Hand-written audit" Build Report page
await ll.convertToPack({ names: ["Some Item"], pack: { name: "my-test", label: "My Test" } });
await ll.build({ convert: true });                         // full build with converted items
```

## Development

```sh
npm run check   # node --check every script and test
npm run lint    # eslint (the only dev dependency)
npm test        # node --test tests/*.test.mjs
```

The tests cover the rules tables, build hashing and the sync plan, the replace list, review routing and the
report, and run `build()` end to end against a small in-memory Foundry stand-in (`tests/_foundry.mjs`) with
made-up items (`tests/_fixtures.mjs`). GitHub Actions runs them on every push and pull request.

## License

Loot Ledger is unofficial fan content. It is not affiliated with, endorsed, sponsored or approved by Blizzard Entertainment or Wizards of the Coast. All trademarks belong to their respective owners.


Code is released under the [MIT licence](LICENSE). Loot Ledger contains no item data, artwork or audio;
all item content comes from the separately installed source module.

This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC,
available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0
International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. (Used: weapon and
armour statistics in `scripts/convert.mjs`.)
