# Conversion: how it works, calibration and replace list

Developer notes for Loot Ledger's 5e conversion. The user-facing summary is in the [README](../README.md#5e-conversion).
Conversion is off by default (setting **Convert items to 5e when building**); everything below applies only when it is on.
Loot Ledger stores no item data and no official rules text. Where an official item is used, its mechanics are read
from your installed compendiums at build time.

## Pipeline at a glance

For each copied source item, in order:

1. **Parse** the tooltip into lines (stats, equip / use / proc lines, resistances, weapon damage, profession lines).
2. **Skip** hand-made items (setting **Hand-made items**, or `flags.loot-ledger.handmade`): never converted, copied or
   overwritten. Route `handmade`.
3. **Book match**: an exact name match in the **Book compendium** is used as is; only price, quality colour and the
   focus tag are added. Route `book`. These items never re-base, gap-fill or collapse.
4. **Source text**: if the source module carries its own hand-written 5e rules, they pass the traceability audit,
   the item is not on the replace list **and no decided rule covers the item** (see "Source text vs decided rules"
   below), that text and shape are kept and the rules only add what it lacks (the +N backbone). The item is marked
   as a source-text item. Otherwise the rules win and the hand text is listed as replaced.
5. **Baseline**: plain grey / white gear maps to plain equipment of its kind; it is never magic. Route `baseline`.
6. **Stat variant and line rules** decide what the item's lines mean (see below).
7. **Official-base matcher** looks for a base. Route `base` when one is accepted, `convert-review` when a base is
   only suggested or lines need a human, `convert-auto` when the tooltip conversion is complete.
8. **Gap-fill** adds one extra effect for needed lines the base does not cover.
9. **Collapse** groups items that now follow the same rule.
10. **Review**: every converted item lands on the Review board.

Prices are never taken from a base or book item: they stay twice the source sell price, in the coin ratio you chose.
Rarity follows the source quality even when the base is rarer or plainer.

## Calibration: `scripts/rules.mjs`

Every tunable number lives in one commented file, `scripts/rules.mjs`, so tuning is editing values, not logic:
rarity by quality, mixed-drop weights, the price rule, base weapon and chest-armour mapping, the +N curves for
weapons, shields and chest armour (`WEAPON_BONUS`, `GEAR_BONUS`, `ARMOR_BONUS`), attunement, stat variants
(`VARIANT_RULE`, `VARIANT_SLOTS`, `STAT_RULE`), the line budget (`LINE_BUDGET`, `LINE_WEIGHT`), trinket and line
rules (`TRINKET_RULE`, `HIT_RULE`, `DEFENSE_RULE`, `SPELL_RULE`, `RESIST_RULE`, `RESIST_RING`, `CRIT_RULE`,
`PARRY_RULE`, `MANA_REGEN`, `HEALTH_REGEN`, `FLAVOUR_RULE`), proc dice (`PROC_RULE`, `BLEED_RULE`, `STAT_DEBUFF_RULE`), limited uses (`DAILY_USES`,
`BLAST_USES`), official bases (`OFFICIAL_BASES`, `VARIANT_BASES`), collapse (`COLLAPSE_RULE`) and consumable tables.
`convert.mjs` re-exports them. Changing any value changes every affected item's hash, so the next build re-converts
exactly those items. `tests/rules.test.mjs` pins the current values; update it alongside any deliberate change.
Level bands (`LEVEL_BANDS`) and creature-table spread (`CREATURE_TABLE`) live there too.

`node tools/calibration-report.mjs` prints every rule as a table and shows how a set of sample items converts
(`tools/fixtures/sample-items.json`, about 40 made-up items, or your own JSON file; `--detail` prints each
item's features in full, `--json` gives machine-readable rows). [BOOK-DAY.md](../BOOK-DAY.md) is the step-by-step
calibration and release checklist.

## Source text vs decided rules

The source module's hand-written text wins only where Loot Ledger has not decided a rule of its own
(`sourceTextWins` in `convert.mjs`):

- **Weapons** keep a hand text that passes the audit. Their hit, critical-hit and proc shapes (a wider critical
  range, extra dice on a critical hit, once-per-turn damage, an extra damage roll) are the GM's chosen reading of
  the item; the rules only add the +N backbone when the text lacks one. A weapon's own critical-hit rule ("when you
  score a critical hit with this weapon") traces to the weapon's damage line.
- **Every other item** uses the rules as soon as one of its lines became a rider under a decided line rule (stat
  variant, critical dice, parry, mana or health regeneration, spell power, resistances, defence, thorns, surges,
  and so on). The hand text is then listed as replaced (`converted.handAuthoredReplaced`, entry
  `decided-rule: …`) and the item gets the review flag *source text replaced by the rules*
  (`sourceTextConflict`). A non-weapon none of whose lines a decided rule converts keeps its hand text.

A hand text that fails the audit is always replaced; the replace list still forces a replacement.

## Official bases: `scripts/base-match.mjs`

A converted item may be re-based on an installed official item that already does what the item's lines ask. The
matcher is pure (plain data in, a decision out) and is tested with made-up fixtures.

**Sources.** Pack indexes are read once per build, in priority order (setting **Base compendiums**; default: the
installed core rulebooks, then the 2024 SRD). The first pack that has an item wins on duplicates; 2024 versions are
preferred over the 2014 SRD, which is not searched by default. Theme-breaking items (wishes, flight, summoning and
similar, `OFFICIAL_BASES.exclude`) and cursed, sentient and artifact items are never bases.

A pack index lists an item's Active Effects by name only, without their changes. For each item, the best
candidates by index score (`OFFICIAL_BASES.shortlist`, 3) that have effects are loaded once as full documents, and
their effect changes are added to their tags; if that changes anything, the item is matched again. Loaded documents
are cached for the build and shared with the accepted-base load. This is read-only, so dry runs do it too. Effect
changes are read from `system.changes` (Foundry 14) or the top-level `changes` of older data (`effects.mjs`
`effectChanges`). `convertToPack({ names })` loads one document per name (the first index entry with that exact
name), so a duplicate name in the source compendium converts only once.

**Needs and candidates.** Each line becomes a weighted need (main stat, secondary stat, resistance, effect line, the
+N backbone). Candidates must fit the item's slot (or weapon family, armour type, shield), and their rarity may not
be above the item's. A magic entry with no rarity (multi-tier entries listing several bonuses) is never a
candidate, because its rarity cannot be checked. Weapon types in `OFFICIAL_BASES.templateOnly` (staves) only ever
use the +N template. A decided-rule base (`VARIANT_BASES`, kind `need`) is not a free candidate for items outside
its rule's quality range (for example the green / blue slot-recovery base never goes on a purple item). A wand
base already is the wand's attack, so the fallback cantrip is never added to it as a gap-fill.

**Base signals.** A base is described by tags taken from its Active Effect keys plus a small keyword pass over its
description, run in memory. Only the tags are kept; no description text is stored anywhere. A change to an ability
score makes a `score:<ability>` tag only when it sets the score (change type `upgrade` or `override`, as a headband
does); a change that adds to it (`add`, an ioun stone or a +2 belt) is a `stat:<ability>` tag like a save bonus.
Old numeric `mode` values are read the same way (4 upgrade, 5 override, 2 add).

**Coverage (0.4.0).** A base covers a line only through its own tags; a match carries the base's tags, and gap-fills
are what those tags leave open. A stat line is covered by `stat:<ability>`, by the tag of the variant the converter
chose for that stat, and by `score:<ability>` only on a picked score item; the rest of the stat's family (a stealth
tag for Agility on boots whose variant is Acrobatics) does not count. Such related bases are still listed among the
candidates, so the Review board can offer them ("Use this base"); a base chosen that way for the item's main stat
replaces its variant (no variant gap-fill). A base never also gets a variant for something it already does (a
stealth cloak gets no extra Stealth bonus).

**Score and confidence.** A candidate scores what it covers, minus a penalty for needs it leaves open, for features
the item did not ask for (excess), for rarity steps below the item, and for lower source priority. Confidence is the
covered share, reduced for each needed line left unfilled and when the base is two or more rarities lower. The
+N template (weapons, chest armour, shields; needs no compendium item) has a fixed confidence, lower when two or
more lines would need gap-fills. All weights are in `OFFICIAL_BASES`.

**Decision.** At or above the accept threshold (default 0.6) the item is re-based. Between the suggest threshold
(0.4) and accept the base is recorded for the Review board and the tooltip conversion stays. Below that there is no
base. Thresholds are the **Base confidence** setting.

**Decided rules (`VARIANT_BASES`).** Some cases are fixed rules, checked first and keyed by the official item's
name; the mechanics still come from your compendium. They cover: stealth variants on cloaks and boots, slot
recovery and health regeneration lines, several small resistances to different schools (protection), damage-only
wands by school, chest armour named for a medium armour type, and ability-score items the GM picked (below).
A rule only applies when the base's rarity does not exceed the item's, so a low-quality wand never becomes a rare one.

**Ability-score bases: score items only** (decided 2026-11-08). A main stat always becomes its stat variant (a Neck
item with a big Stamina line gets Constitution saves, not an ability-score amulet). An ability-score base is used
only for an item the GM marks as a **score item** on the Review board (`overrides.scoreItem`), for that item's own
main stat, and only when the item is one rarity step above the base's own (`OFFICIAL_BASES.scoreRule.stepsUp`). Belts
that set Strength use the score of the item's tier (`beltScore`). A score base is never a free candidate for any
other item. A picked score item never also gets its own ability's variant; its other lines stay gap-fills. The
setting **Ability-score bases** turns score items off altogether. The converter's own rules never raise an ability
score.

**Strength guard.** A specific official item whose extra damage rides much more often, or is much bigger, than the
item's own proc line is never picked. The +N template plus the proc is used instead, so a small proc cannot turn
into an always-on elemental weapon.

**What a re-based item keeps.** Its own name, icon, price, item level, quality and rarity. It gets the base's own
mechanics and effects, plus at most one extra transferred effect (flagged `flags.loot-ledger.gapFill`) for needed
lines the base does not cover (setting **Gap-fills on bases**). Active Effects are otherwise only written for items
without a base and for gap-fills. Attunement is the base's own plus whatever the line rules add.

**Active Effects written by Loot Ledger** (`scripts/effects.mjs`): changes live in `system.changes` in the Foundry 14
shape `{ key, type: "add", value, phase: "initial", priority: null }` (no numeric `mode`). Keys are dnd5e 6.x `roll`
fields, checked against dnd5e 6.0.6: skills `system.skills.<skill>.roll.bonus` (and `.roll.mode` for an Advantage
swap), saves `system.abilities.<ability>.save.roll.bonus`, ability checks `system.abilities.<ability>.check.roll.bonus`,
Initiative `system.attributes.init.roll.bonus`, Concentration `system.attributes.concentration.roll.bonus`, attack
bonuses `system.rolls.attack.<mwak|rwak|msak|rsak>.bonus`, plus `system.attributes.hp.bonuses.overall`,
`system.bonuses.spell.dc`, `system.attributes.ac.bonus` and `system.traits.dr.value`. The old `bonuses.check` /
`bonuses.save` keys are shims in dnd5e 6.x that go away in 7.0; a test fails on any of them.

**Stored on the item:** `flags.loot-ledger.base` (uuid, name, pack, source, confidence, status accept | suggest |
exact, covered, excess, plus, matcherVersion, scoreItem: the ability when a picked score base was used),
`baseCandidates` (related bases marked `related`), `gapFills` and `converted.route`. The hash covers
the base sources and each base's modification time, so updating a compendium re-converts affected items.

## Stat variants: `scripts/variants.mjs`

An item's main stat (its highest primary stat at or above `max(4, item level / 7)`) becomes exactly one flat bonus,
chosen deterministically by slot:

- **Strength**: grapple / shove DC (hands, wrists), Athletics (feet, legs, no slot rule), saves against being moved
  or knocked Prone (plate, shields, belts).
- **Agility**: Acrobatics (feet, legs), Stealth (cloaks, leather chest), Initiative (everything else).
- **Stamina**: max HP (chest, legs, belt), Constitution saves (head, neck, rings, cloaks and cloth worn pieces),
  Concentration (held caster items).
- **Intellect**: spell save DC (caster and held items, and jewellery from Very Rare), Arcana (head),
  Investigation (rings, necks, gloves).
- **Spirit**: Hit Point Die healing (chest, legs, cloth), Wisdom saves (head, neck, held items), Perception (rings,
  cloaks, other).

Ties are broken by (a) a quality-gated slot rule (Very Rare and Legendary jewellery with a caster stat: spell save
DC), (b) armour type in its own order (plate and mail: Stamina, then Strength; leather: Agility; cloth: Intellect,
then Spirit; `VARIANT_RULE.armorStats`), (c) any other slot rule for the slot, (d) stat order. A slot rule always
beats plain stat order. Sizes by quality (green / blue / purple / orange): checks
and saves +1 / +1 / +2 / +2; Initiative +1 / +2 / +2 / +3; max HP +1 per two levels (green, blue) or per level
(purple, orange); Hit Die healing +1 / +1 / +2 / +Proficiency Bonus. A spell save DC variant is a passive bonus with
attunement and is described as not stacking with other items that raise the DC. A variant never changes an ability
score and never adds weapon attack or damage.

Advantage on the roll instead of the flat bonus exists for epic and legendary items, but only as a per-item or
per-group opt-in on the Review board (`overrides.advantage`). It is never chosen by default.

Green and blue items whose only benefit is the variant need no attunement. A main stat below the threshold only
becomes a variant (or gap-fill) when the item would otherwise have nothing.

**Line budget.** Beyond the +N backbone an item keeps green 1, blue 2, purple / orange 3 benefits. The variant counts
as one; two full resistances count as two. Non-weapons keep the variant first; weapons keep their own lines first
and the variant only fills a free slot. Extra lines are dropped weakest first (`LINE_WEIGHT`) and listed under "Not
converted". Profession lines, wand cantrips and passive "when struck" riders are free.

## Line rules

Each rule has its own numbers in `rules.mjs` and, where noted, a setting that turns the family off (the lines are then
listed as not converted).

- **Critical strike** (setting **Critical-hit dice**): extra dice on a Critical Hit, not doubled (the spell version
  applies to spell attack crits). No wider crit range unless the source's own text says so.
- **Hit chance on non-weapons**: +1 to attack rolls only from Very Rare up and with attunement.
- **Defense on trinkets**: +1 AC, with attunement, applied by the item's own effect. Elsewhere AC comes only from a
  base or the chest / shield curve; there is no AC gap-fill.
- **Dodge / parry** (setting **Parry reaction**): a Reaction adding AC against one attack, once per Short Rest.
- **Mana over time** (setting **Mana regeneration**): once per Long Rest, during a Short Rest, regain one spell slot
  of a level that grows with quality (attunement); or, on other slots, a Concentration save bonus. Green and blue
  items may use an official base instead.
- **Health over time**: green and blue use an official base when one is installed (otherwise GM review); purple and
  orange regain hit points every few minutes while above 0 (attunement).
- **Resistance**: full Resistance only from Very Rare and only when the line is large for the item level. Rings,
  amulets and cloaks from Rare keep a resistance that is the item's largest number. Resistance never stacks (no
  rule adds a second source of the same one); only legendary items may carry two, and only if both lines are full
  size. Three or more small resistances to different schools on a ring or cloak use the protection base.
- **Spell power**: a spell attack and save DC bonus (attunement, spellcaster); healing-only lines add a small die to
  healing spells.
- **"When struck" / "protects" lines**: passive riders, no uses. "Use:" lines have limited uses per Long Rest.
- **Profession lines** (setting **Profession bonuses**): a small situational bonus to the matching skill or tool.
- **Focus tag**: staves, wands, orbs and held caster items get the dnd5e Focus property, on equipment, weapons and
  tools only.

## Weapons

The base weapon is chosen by `WEAPON_RULES` (type, hands, speed, name rules before speed). The +N template gives the
usual +1 / +1 / +2 / +3 at green / blue / purple / orange, and the +1 always wins: a green weapon keeps its +1 and
its one effect. Caster staves get a Focus tag and a spell bonus, never a specific official staff.

- A weapon's own extra-damage line becomes once-per-turn dice.
- Chance-on-hit procs are sized by the ratio of average proc damage to a normal hit: below 1 an extra-dice
  damage on a Critical Hit; from 1 to the blast threshold once per turn on a hit; at or above it a limited-use
  blast (setting **Blast threshold**, default 2). A proc with no damage school deals the weapon's own damage type.
  A proc that also does something else ("… damage and …", a slow, several targets) is flagged (*parts of a proc not
  converted*); with no damage school it stays a review line. A healing proc is never treated as damage (review).
- **Bleeds** (`BLEED_RULE`, decided 2026-11-08). Damage over time ("bleed for N damage over T sec", "N damage over
  T sec") is a lingering wound, not an instant blast. The ratio of the total over-time damage still picks the band
  (critical, on-hit or blast); the item's tier picks the dice and the uses. On a hit, with uses per Long Rest as the
  blast had (`BLAST_USES`; a blast-band wound also requires attunement), the wielder inflicts the wound: at the start
  of each of the target's turns for up to 1 minute it takes the wound dice, and a Constitution save at the end of
  each of its turns ends it. Dice per turn are a third of the band's dice, rounded to whole dice, at least 1d6 (a 6d6
  blast becomes 2d6). Save DC by quality: uncommon 13, rare 15, epic 17, legendary 19; common / poor 11 and
  artifact 21 extend the same two-point steps (baseline gear never converts lines, so 11 only matters for hand
  use). A new wound restarts the duration and does not stack. Not automated yet: the feature text runs by hand and
  the `bleed` rider stores the formula, band dice, save, timing, duration and stacking for a later automation pass.
  A review line keeps the source's over-time text. An instant hit with an over-time tail ("… 40 Fire damage and an
  additional 9 damage over 6 sec") is one damage line: a bleed when the tail is at least half the total
  (`mixedFrom`), otherwise the instant damage (which picks the band) with the tail named in the source note.
- **Stat-lowering clauses** (`STAT_DEBUFF_RULE`, setting **Stat-lowering procs**, on by default). "Lowering all
  stats" / "lowers all attributes" becomes a Bane-shaped debuff in the proc's feature: the target subtracts 1d4 from
  its attack rolls and saving throws until the end of the wielder's next turn. The damage half stays as it is (for
  example a crit-band proc keeps its critical dice). A debuff-only proc becomes an on-hit feature with
  `DAILY_USES` uses. Each such item gets a review line. A single-stat clause ("lowers strength by N") is not this
  rule and stays in review. Off: the clause is flagged (*parts of a proc not converted*) or, alone, reviewed.
- Procs that do not deal damage become a described feature with uses and go to GM review.
- Attack power and hit chance on weapons are covered by the +N and are not converted separately.
- An endgame +1 step is a per-item or per-group override (`overrides.raise`), never decided by name. It raises the
  +N of weapons, chest armour and shields (up to +3); the armour curve itself stays +0 / +0 / +1 / +2.

## Collapse: `scripts/collapse.mjs`

With **Collapse same-rule items** on (`shared`, default), converted items with the same key share one review
decision. The key is: shape, slot, armour or weapon type, quality, tier band (levels 1–4, 5–10, 11–16, 17–20),
base, +N and the sorted gap-fill signature. White and grey gear groups by shape, slot, type and band. Book,
hand-made, source-text and tooltip-conversion items never collapse; a member with an override, a Tweak or an
explicit split stands alone. The canonical member is the first by name, then id. Every item keeps its own name,
icon, price, item level, tooltip and quality; the loot tables keep their seven finer level bands.
`collapseUpdates` writes only flag differences, in place, and is skipped under `dryRun`.

## Review board and overrides

Every converted item is on the board; nothing is approved automatically. Review decisions
(`flags.loot-ledger.review`) survive rebuilds: accepted and tweaked items are not rewritten unless `force`.
Overrides are separate and are part of the conversion hash, so the next Build rewrites the item from them:

```js
flags["loot-ledger"].overrides = { base: "Compendium.…uuid" | "none", advantage: true, raise: true, scoreItem: true }
```

`base` pins another candidate or drops the base; `advantage`, `raise` and `scoreItem` are the opt-ins described above.
The Review board writes these through the group actions (**Accept base**, **Use this base**, **Drop base**, **Split
this item**, **Advantage**, **Raise**) and the per-item **Score item** toggle (never applied to the whole group). The
queue lists pending items first and, within a status, the biggest collapse groups first (one decision covers the
most items). Kind filters include **Source text replaced** (`sourceTextConflict`) and **Score item (picked)**. Review flags raised at build (`converted.flags`, `REVIEW_FLAGS` in `convert.mjs`)
mark open questions: no vendor price, source text replaced by the rules, non-damage proc, stand-in fist weapon,
stackable thrown weapon, proc parts not converted, base not found, suggested base.

## Settings that affect conversion

| Setting | Effect |
|---|---|
| Convert items to 5e when building | Master switch (off by default). |
| Official bases, Base compendiums, Book compendium | Whether and where bases are searched; book items are used as is. |
| Base confidence | Accept and suggest thresholds. |
| Ability-score bases, Gap-fills on bases | Allow score bases for picked score items, and gap-fills. |
| Hand-made items | Names / UUIDs Build leaves alone. |
| Collapse same-rule items | `shared` or `off`. |
| Critical-hit dice, Profession bonuses, Mana regeneration, Parry reaction, Stat-lowering procs | Turn a line-rule family off. |
| Blast threshold | Proc ratio at which a proc becomes a limited-use blast. |

All of them are world settings and are listed in `SETTING_KEYS` (`cleanup.mjs`).

## Dry run

`build({ dryRun: true })` runs every stage up to the writes and returns `plan.items`: per item the route, base,
confidence, candidates, gap-fills, collapse group, flags and review lines, plus the "Official bases" summary. No
write path runs; a test spies on every write call and asserts none happen. Use it to read what a rules change would
do before a real build.

## Replace list: `scripts/replace-list.mjs`

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
await ll.build({ dryRun: true, convert: true });           // plan only, no writes
```
