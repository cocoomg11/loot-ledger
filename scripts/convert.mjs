/**
 * Converter: classic MMO item -> dnd5e (2024 rules) item. Second pass.
 *
 * Ground rules (every table below follows them):
 *
 *  1. Traceability. Every mechanical feature comes from one specific tooltip line of the source item: a stat
 *     line, an Equip: / Use: / Chance on hit: line, a resistance line, the weapon damage line, or the item
 *     type and slot. Quality on its own only sets the plain enhancement bonus of weapons, armour and shields,
 *     and attunement. Nothing else is ever added because of quality.
 *  2. Explained. Each feature is written out as a complete 5e rule (what it does, when, how often, any save
 *     or recharge) followed by a "Source:" note naming the line it came from.
 *  3. Proportionate. The line decides WHAT a feature is; the rarity (and for weapons the level band) decides
 *     HOW MUCH, using the tables below, kept in line with SRD 5.2 magic items of the same rarity.
 *  4. Unclear lines are flagged, not guessed: the item gets needsReview and a "GM review" note, and the line
 *     stays as flavour with no mechanics.
 *  5. No automation. Riders (extra damage, check / save bonuses, resistances ...) are described in text and
 *     recorded as structured data in flags["loot-ledger"].riders for a later automation pass. Only the plain
 *     enhancement bonus uses dnd5e's own data field (magicalBonus), and only consumables get an activity.
 *
 * Every line on the tooltip ends up in exactly one of three places in the 5e block: a feature, the
 * "Not converted" list (with the reason, e.g. it is already covered by the base weapon), or "GM review".
 *
 * Weapon and armour statistics (damage, properties, mastery, AC, weight) and the potion of healing dice come
 * from the System Reference Document 5.2 (CC-BY-4.0). All rules text is Loot Ledger's own wording.
 *
 * Nothing in here reads or writes Foundry documents: `convertItem()` takes plain source data and returns
 * plain item data, so it can be tested outside Foundry.
 */
import { MODULE_ID, SOURCE_MODULE, QUALITY_BY_KEY, analyse, tooltipLines, priceFor, formatCoins } from "./data.mjs";

export const CONVERTER_VERSION = 2;

/* -------------------------------------------- */
/*  SRD 5.2 reference data                      */
/* -------------------------------------------- */

/**
 * Base weapons (SRD 5.2). dmg = [number, faces, type]; ver = versatile [number, faces];
 * range = [normal, long] in feet for thrown / ammunition weapons.
 */
export const WEAPON_BASES = {
  club:          { label: "Club",           type: "simpleM",  dmg: [1, 4, "bludgeoning"],  props: ["lgt"],                     mastery: "slow",   weight: 2 },
  dagger:        { label: "Dagger",         type: "simpleM",  dmg: [1, 4, "piercing"],     props: ["fin", "lgt", "thr"],       mastery: "nick",   weight: 1,  range: [20, 60] },
  handaxe:       { label: "Handaxe",        type: "simpleM",  dmg: [1, 6, "slashing"],     props: ["lgt", "thr"],              mastery: "vex",    weight: 2,  range: [20, 60] },
  javelin:       { label: "Javelin",        type: "simpleM",  dmg: [1, 6, "piercing"],     props: ["thr"],                     mastery: "slow",   weight: 2,  range: [30, 120] },
  mace:          { label: "Mace",           type: "simpleM",  dmg: [1, 6, "bludgeoning"],  props: [],                          mastery: "sap",    weight: 4 },
  quarterstaff:  { label: "Quarterstaff",   type: "simpleM",  dmg: [1, 6, "bludgeoning"],  props: ["ver"], ver: [1, 8],        mastery: "topple", weight: 4 },
  dart:          { label: "Dart",           type: "simpleR",  dmg: [1, 4, "piercing"],     props: ["fin", "thr"],              mastery: "vex",    weight: 0.25, range: [20, 60] },
  shortbow:      { label: "Shortbow",       type: "simpleR",  dmg: [1, 6, "piercing"],     props: ["amm", "two"],              mastery: "vex",    weight: 2,  range: [80, 320] },
  lightcrossbow: { label: "Light Crossbow", type: "simpleR",  dmg: [1, 8, "piercing"],     props: ["amm", "lod", "two"],       mastery: "slow",   weight: 5,  range: [80, 320] },
  battleaxe:     { label: "Battleaxe",      type: "martialM", dmg: [1, 8, "slashing"],     props: ["ver"], ver: [1, 10],       mastery: "topple", weight: 4 },
  glaive:        { label: "Glaive",         type: "martialM", dmg: [1, 10, "slashing"],    props: ["hvy", "rch", "two"],       mastery: "graze",  weight: 6 },
  greataxe:      { label: "Greataxe",       type: "martialM", dmg: [1, 12, "slashing"],    props: ["hvy", "two"],              mastery: "cleave", weight: 7 },
  greatsword:    { label: "Greatsword",     type: "martialM", dmg: [2, 6, "slashing"],     props: ["hvy", "two"],              mastery: "graze",  weight: 6 },
  halberd:       { label: "Halberd",        type: "martialM", dmg: [1, 10, "slashing"],    props: ["hvy", "rch", "two"],       mastery: "cleave", weight: 6 },
  longsword:     { label: "Longsword",      type: "martialM", dmg: [1, 8, "slashing"],     props: ["ver"], ver: [1, 10],       mastery: "sap",    weight: 3 },
  maul:          { label: "Maul",           type: "martialM", dmg: [2, 6, "bludgeoning"],  props: ["hvy", "two"],              mastery: "topple", weight: 10 },
  pike:          { label: "Pike",           type: "martialM", dmg: [1, 10, "piercing"],    props: ["hvy", "rch", "two"],       mastery: "push",   weight: 18 },
  shortsword:    { label: "Shortsword",     type: "martialM", dmg: [1, 6, "piercing"],     props: ["fin", "lgt"],              mastery: "vex",    weight: 2 },
  warhammer:     { label: "Warhammer",      type: "martialM", dmg: [1, 8, "bludgeoning"],  props: ["ver"], ver: [1, 10],       mastery: "push",   weight: 5 },
  heavycrossbow: { label: "Heavy Crossbow", type: "martialR", dmg: [1, 10, "piercing"],    props: ["amm", "hvy", "lod", "two"], mastery: "push",  weight: 18, range: [100, 400] },
  longbow:       { label: "Longbow",        type: "martialR", dmg: [1, 8, "piercing"],     props: ["amm", "hvy", "two"],       mastery: "slow",   weight: 2,  range: [150, 600] },
  musket:        { label: "Musket",         type: "martialR", dmg: [1, 12, "piercing"],    props: ["amm", "lod", "two"],       mastery: "slow",   weight: 10, range: [40, 120] },
  pistol:        { label: "Pistol",         type: "martialR", dmg: [1, 10, "piercing"],    props: ["amm", "lod"],              mastery: "vex",    weight: 3,  range: [30, 90] },
  /** Not an SRD weapon: Loot Ledger's stand-in for claw / knuckle weapons (simple, light, finesse). */
  fist:          { label: "Fist Weapon",    type: "simpleM",  dmg: [1, 4, "slashing"],     props: ["fin", "lgt"],              mastery: "nick",   weight: 1, custom: true }
};

/** Body armour and shield (SRD 5.2). dex = max Dex bonus (null = unlimited, 0 = none). */
export const ARMOR_BASES = {
  padded:      { label: "Padded Armor",     type: "light",  ac: 11, dex: null, stealth: true,  weight: 8 },
  leather:     { label: "Leather Armor",    type: "light",  ac: 11, dex: null,                 weight: 10 },
  studded:     { label: "Studded Leather",  type: "light",  ac: 12, dex: null,                 weight: 13 },
  hide:        { label: "Hide Armor",       type: "medium", ac: 12, dex: 2,                    weight: 12 },
  chainshirt:  { label: "Chain Shirt",      type: "medium", ac: 13, dex: 2,                    weight: 20 },
  scalemail:   { label: "Scale Mail",       type: "medium", ac: 14, dex: 2,    stealth: true,  weight: 45 },
  breastplate: { label: "Breastplate",      type: "medium", ac: 14, dex: 2,                    weight: 20 },
  halfplate:   { label: "Half Plate",       type: "medium", ac: 15, dex: 2,    stealth: true,  weight: 40 },
  ringmail:    { label: "Ring Mail",        type: "heavy",  ac: 14, dex: 0,    stealth: true,  weight: 40 },
  chainmail:   { label: "Chain Mail",       type: "heavy",  ac: 16, dex: 0,    stealth: true,  weight: 55, strength: 13 },
  splint:      { label: "Splint Armor",     type: "heavy",  ac: 17, dex: 0,    stealth: true,  weight: 60, strength: 15 },
  plate:       { label: "Plate Armor",      type: "heavy",  ac: 18, dex: 0,    stealth: true,  weight: 65, strength: 15 },
  shield:      { label: "Shield",           type: "shield", ac: 2,  dex: null,                 weight: 6 }
};

const PROP_LABEL = {
  fin: "Finesse", lgt: "Light", thr: "Thrown", ver: "Versatile", hvy: "Heavy", two: "Two-Handed", rch: "Reach",
  amm: "Ammunition", lod: "Loading", foc: "Spellcasting Focus"
};

/* -------------------------------------------- */
/*  Item shape tables (tune these)              */
/* -------------------------------------------- */

/**
 * Weapon type -> base weapon. First matching row wins.
 * hands: "one" (One-Hand / Main Hand / Off Hand), "two" (Two-Hand), "ranged", "thrown".
 * maxSpeed: classic attack speed in seconds. name: regex on the item name (only picks between bases of the
 * same weapon family, never adds features).
 */
export const WEAPON_RULES = [
  { wow: "Sword",       hands: "two",                     base: "greatsword" },
  { wow: "Sword",       hands: "one", slot: "Off Hand",   base: "shortsword" },
  { wow: "Sword",       hands: "one", name: /rapier|foil|epee|short ?sword|dirk|gladius/i, base: "shortsword" },
  { wow: "Sword",       hands: "one", maxSpeed: 1.79,     base: "shortsword" },
  { wow: "Sword",       hands: "one",                     base: "longsword" },
  { wow: "Axe",         hands: "two",                     base: "greataxe" },
  { wow: "Axe",         hands: "one", slot: "Off Hand",   base: "handaxe" },
  { wow: "Axe",         hands: "one", maxSpeed: 2.29,     base: "handaxe" },
  { wow: "Axe",         hands: "one",                     base: "battleaxe" },
  { wow: "Mace",        hands: "two",                     base: "maul" },
  { wow: "Mace",        hands: "one", name: /hammer|mallet/i, base: "warhammer" },
  { wow: "Mace",        hands: "one",                     base: "mace" },
  { wow: "Dagger",                                        base: "dagger" },
  { wow: "Fist Weapon",                                   base: "fist" },
  { wow: "Polearm",     name: /spear|pike|lance|harpoon|trident/i, base: "pike" },
  { wow: "Polearm",     name: /halberd|axe|poleaxe|cleaver/i,      base: "halberd" },
  { wow: "Polearm",                                       base: "glaive" },
  { wow: "Staff",                                         base: "quarterstaff", focus: true },
  { wow: "Bow",         maxSpeed: 2.59,                   base: "shortbow" },
  { wow: "Bow",                                           base: "longbow" },
  { wow: "Crossbow",    maxSpeed: 2.99,                   base: "lightcrossbow" },
  { wow: "Crossbow",                                      base: "heavycrossbow" },
  // Guns lean musket (decided by the user): pistol only for a pistol name or a very fast gun.
  { wow: "Gun",         name: /pistol|derringer|handgun/i, base: "pistol" },
  { wow: "Gun",         maxSpeed: 1.99,                   base: "pistol" },
  { wow: "Gun",                                           base: "musket" },
  { wow: "Thrown",      name: /axe|tomahawk|hatchet/i,    base: "handaxe" },
  { wow: "Thrown",      name: /spear|javelin/i,           base: "javelin" },
  { wow: "Thrown",      name: /dagger|knife|blade/i,      base: "dagger" },
  { wow: "Thrown",                                        base: "dart" },
  { wow: "Fishing Pole",                                  base: "club" }
];

/** Chest armour by armour class and item level. First matching row wins. Cloth chests use CLOTH_CHEST. */
export const CHEST_RULES = [
  { wow: "Leather", maxIlvl: 30,  base: "leather" },
  { wow: "Leather",               base: "studded" },
  { wow: "Mail",    maxIlvl: 25,  base: "chainshirt" },
  { wow: "Mail",    maxIlvl: 45,  base: "scalemail" },
  { wow: "Mail",                  base: "breastplate" },
  { wow: "Plate",   maxIlvl: 45,  base: "chainmail" },
  { wow: "Plate",   maxIlvl: 58,  base: "splint" },
  { wow: "Plate",                 base: "plate" }
];

/**
 * Cloth chest handling (decided by the user): "clothing" = no AC, so spellcasters without armour training can
 * wear robes; only an explicit Equip line raising armour or defence gives AC (DEFENSE_RULE). "padded" would
 * make them Padded Armor instead.
 */
export const CLOTH_CHEST = "clothing";

/**
 * Non-weapon, non-chest slots -> dnd5e equipment type (decided by the user: only chest armour and shields
 * give AC, so helmets, gloves, boots and so on are worn items without an AC value, unless an Equip line
 * raises armour or defence; see DEFENSE_RULE).
 */
export const SLOT_EQUIPMENT = {
  Head: "clothing", Shoulder: "clothing", Hands: "clothing", Wrist: "clothing", Waist: "clothing",
  Legs: "clothing", Feet: "clothing", Back: "clothing", Shirt: "clothing", Tabard: "clothing",
  Finger: "ring", Neck: "trinket", Trinket: "trinket", "Held In Off-hand": "trinket", Relic: "trinket"
};

/* -------------------------------------------- */
/*  Power tables (tune these)                   */
/* -------------------------------------------- */

/** Quality -> power tier used by every table below (0 = no magic from quality). */
export const TIER = { poor: 0, common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, artifact: 4 };
const TIER_NAME = { 0: "Common", 1: "Uncommon", 2: "Rare", 3: "Very Rare", 4: "Legendary" };
const QUALITY_NAME = { poor: "Poor", common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", artifact: "Artifact" };

/**
 * Plain enhancement bonus for weapons, chest armour and shields (decided by the user):
 *   Uncommon (green)   +1 OR an effect: the effect replaces the +1 when the item has a convertible line.
 *   Rare (blue)        +1 AND its effects (its effects use the Rare row of each table, bigger than green's).
 *   Epic (purple)      +2 and its effects.
 *   Legendary (orange) +3 and its effects.
 * "Effect" means a feature from one of the item's own Equip / Use / Chance-on-hit / resistance / bonus-damage
 * lines (see EFFECT_RIDERS); the main-stat check or save bonus is the stat line itself and does not count.
 * Effects are never invented to fill a tier: an item with no convertible line just gets its plain bonus.
 */
export const GEAR_BONUS = {
  0: { plain: 0, withEffect: 0 }, 1: { plain: 1, withEffect: 0 }, 2: { plain: 1, withEffect: 1 },
  3: { plain: 2, withEffect: 2 }, 4: { plain: 3, withEffect: 3 }
};
/** Rider types that count as an "effect" for GEAR_BONUS. */
export const EFFECT_RIDERS = new Set(["extraDamage", "burstDamage", "extraAttack", "heal", "attackBonus", "spellBonus", "healBonus", "resistance", "acBonus", "cantrip"]);
/** Quality tier from which every item requires attunement (Very Rare and Legendary). */
export const ATTUNE_TIER = 3;
/** Rider types that require attunement on their own, as their SRD counterparts do. */
export const ATTUNE_RIDERS = new Set(["resistance", "attackBonus", "spellBonus", "healBonus", "extraAttack", "burstDamage", "acBonus"]);

/** Classic stat -> 5e ability. Charisma has no classic counterpart. */
export const STAT_MAP = { Strength: "str", Agility: "dex", Stamina: "con", Intellect: "int", Spirit: "wis" };
export const ABILITY_LABEL = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const STAT_ORDER = ["str", "dex", "con", "int", "wis"];
const ABILITY_STAT = { str: "Strength", dex: "Agility", con: "Stamina", int: "Intellect", wis: "Spirit" };

/**
 * Primary stat lines. Only the item's highest primary stat counts, and only when it is a real part of the
 * item: at least max(minValue, item level / perItemLevel). It gives a bonus to checks with the matching
 * ability (Stamina gives Constitution saving throws instead, since Stamina is about toughness).
 * The other stat lines are listed as "Not converted".
 */
export const STAT_RULE = { minTier: 1, minValue: 4, perItemLevel: 7, checkBonus: { 1: 1, 2: 1, 3: 2, 4: 2 }, saveBonus: { 1: 1, 2: 1, 3: 2, 4: 2 } };

/**
 * Trinket slot only (decided by the user). The trinket's main stat (highest primary stat, no size threshold)
 * gives +1 / +2 / +3 / +3 (Uncommon / Rare / Epic / Legendary; Legendary stays at +3 because 5e item bonuses
 * top out there) to ability checks OR saving throws with the matching ability:
 *   saving throws when the trinket reads as defensive: its main stat is Stamina, or it has a resistance line,
 *   or an Equip line about armour, defence, dodge, parry or block;
 *   ability checks otherwise (offensive or utility trinkets).
 * Trinkets with convertible effect lines use the normal effect rules; at Uncommon the effect replaces the
 * stat bonus (+1 OR an effect), from Rare up they get both. No stat and no convertible line -> GM review.
 */
export const TRINKET_RULE = { minTier: 1, bonus: { 1: 1, 2: 2, 3: 3, 4: 3 }, defensive: /Armor|Defense|dodge|parry|block/i };

/** "Improves your chance to hit by N%" on a non-weapon item (Uncommon or better): +1 to weapon attack rolls,
 * or +1 to spell attack rolls on caster gear. */
export const HIT_RULE = { minTier: 1, bonus: 1 };
/** Caster gear (Intellect / Spirit / spell power): its "+hit" line becomes +1 to spell attack rolls instead. */
const isCasterGear = p => !!(p.stats.int || p.stats.wis) || p.effects.some(e => /spells and effects/i.test(e.text));

/**
 * "Equip: Increased Defense +N" or "Equip: +N Armor." on an item that has no AC of its own (anything but chest
 * armour and shields, including cloth chests): +1 AC at most, like an SRD ring of protection, and it requires
 * attunement. The item's plain armour value never counts (decided by the user). On chest armour and shields
 * these lines are covered by the base AC and listed as not converted.
 */
export const DEFENSE_RULE = { minTier: 1, ac: 1 };

/**
 * "Increases damage (and healing) done by spells by up to N": a spellcasting bonus, like the SRD's +1 / +2 /
 * +3 spellcasting items, when N >= max(minValue, item level / perItemLevel). School-specific lines only
 * affect spell attack rolls of spells of that damage type. Healing-only lines add a small die to healing
 * spells. All of these require attunement by a spellcaster.
 */
export const SPELL_RULE = { minValue: 4, perItemLevel: 6, bonus: { 0: 1, 1: 1, 2: 1, 3: 2, 4: 3 }, healDie: { 0: "1d4", 1: "1d4", 2: "1d4", 3: "1d6", 4: "1d8" } };

/**
 * "+N <School> Resistance": full 5e Resistance only when the line is large for the item level
 * (N >= max(minValue, item level x perItemLevel)); smaller lines are listed as "Not converted".
 */
export const RESIST_RULE = { minValue: 15, perItemLevel: 0.3 };

/** Classic damage school -> 5e damage type. Nature becomes Lightning when the line mentions lightning or storms. */
export const SCHOOL_MAP = { Fire: "Fire", Frost: "Cold", Nature: "Poison", Shadow: "Necrotic", Arcane: "Force", Holy: "Radiant" };

/**
 * "Chance on hit" damage procs. Classic procs fire now and then (roughly once a minute, i.e. about once per
 * fight), so their 5e frequency is chosen by how big the proc is next to one normal hit of the weapon
 * (ratio = average proc damage / average weapon damage):
 *   ratio < critBelow                -> extra damage on a Critical Hit (small, occasional),
 *   critBelow <= ratio < burstFrom   -> extra damage once per turn on a hit (steady, like SRD elemental weapons),
 *   ratio >= burstFrom               -> one big blast per Short or Long Rest (a signature burst).
 * Dice grow with the item's tier.
 */
export const PROC_RULE = {
  critBelow: 1, burstFrom: 2.5,
  critDice:  { 0: "1d6", 1: "1d6", 2: "2d6", 3: "3d6", 4: "4d6" },
  onHitDice: { 0: "1d4", 1: "1d4", 2: "1d6", 3: "2d6", 4: "3d6" },
  burstDice: { 0: "2d6", 1: "3d6", 2: "4d6", 3: "6d6", 4: "8d6" }
};
/** A weapon's own "+ X - Y <School> Damage" line (every hit in the classic game): once-per-turn extra dice. */
export const WEAPON_EXTRA_DICE = { 0: "1d4", 1: "1d4", 2: "1d4", 3: "1d6", 4: "1d8" };
/** "Extra attack" procs: extra attacks per use (capped by tier); one use per Short or Long Rest. */
export const EXTRA_ATTACK_RULE = { max: { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2 }, uses: { 0: 1, 1: 1, 2: 1, 3: 2, 4: 3 } };

/**
 * Reflavoured official items (first mapping, to be revisited). An Uncommon-or-better worn item whose lines give
 * no 5e feature at all keeps its WoW name, icon and flavour text but takes the system data and rules text of an
 * official magic item of the same slot and rarity. This table holds NAMES and compendium ids only: the data is
 * copied at build time from the user's own installed compendium (OFFICIAL_PACKS), falling back to the SRD by
 * name (SRD_PACKS). Excluded: cursed, artifact, sentient, and theme-breaking items (flight, wishes, summoning).
 * The pick is deterministic: hash(WoW item id) mod candidates. No candidate -> the normal tier rules.
 * D = dnd-dungeon-masters-guide.equipment, A = dnd-arcana-unleashed.items.
 */
export const OFFICIAL_PACKS = { D: "dnd-dungeon-masters-guide.equipment", A: "dnd-arcana-unleashed.items" };
export const SRD_PACKS = ["dnd5e.equipment24", "dnd5e.items"];
export const REFLAVOUR_SLOT = { Feet: "boots", Back: "cloak", Hands: "gloves", Waist: "belt", Wrist: "bracers", Head: "helm", Finger: "ring", Neck: "amulet", Chest: "robe" };
export const REFLAVOUR = {
  boots: {
    uncommon: ["D:Boots of Elvenkind#dmgBootsOfElvenk", "D:Boots of Striding and Springing#dmgBootsOfStridi", "D:Boots of the Winterlands#dmgBootsOfTheWin", "D:Slippers of Spider Climbing#dmgSlippersOfSpi"],
    rare: ["D:Boots of Levitation#dmgBootsOfLevita"]
  },
  cloak: {
    uncommon: ["D:Cloak of Elvenkind#dmgCloakOfElvenk", "D:Cloak of Protection#dmgCloakOfProtec", "D:Cloak of the Manta Ray#dmgCloakOfTheMan", "D:Nature's Mantle#dmgNaturesMantle"],
    rare: ["D:Cape of the Mountebank#dmgCapeOfTheMoun", "D:Cloak of Displacement#dmgCloakOfDispla", "D:Cloak of the Bat#dmgCloakOfTheBat", "D:Mantle of Spell Resistance#dmgMantleOfSpell"],
    veryRare: ["D:Cloak of Arachnida#dmgCloakOfArachn"],
    legendary: ["D:Cloak of Invisibility#dmgCloakOfInvisi"]
  },
  gloves: {
    uncommon: ["D:Gauntlets of Ogre Power#dmgGauntletsOfOg", "D:Gloves of Missile Snaring#dmgGlovesOfMissi", "D:Gloves of Swimming and Climbing#dmgGlovesOfSwimm", "D:Gloves of Thievery#dmgGlovesOfThiev", "A:Magewright's Gloves#aunMagewrightsJC"]
  },
  belt: {
    rare: ["D:Belt of Dwarvenkind#dmgBeltOfDwarven", "D:Belt of Giant Strength (hill)#dmghilBeltofGian"],
    veryRare: ["D:Belt of Giant Strength (fire)#dmgfirBeltofGian", "D:Belt of Giant Strength (frost)#dmgfroBeltofGian", "D:Belt of Giant Strength (stone)#dmgstoBeltofGian"],
    legendary: ["D:Belt of Giant Strength (cloud)#dmgcloBeltofGian", "D:Belt of Giant Strength (storm)#dmgstmBeltofGian"]
  },
  bracers: { uncommon: ["D:Bracers of Archery#dmgBracersOfArch"], rare: ["D:Bracers of Defense#dmgBracersOfDefe"] },
  helm: {
    uncommon: ["D:Cap of Water Breathing#dmgCapOfWaterBre", "D:Circlet of Blasting#dmgCircletOfBlas", "D:Hat of Disguise#dmgHatOfDisguise", "D:Headband of Intellect#dmgHeadbandOfInt", "D:Helm of Comprehending Languages#dmgHelmOfCompreh", "D:Helm of Telepathy#dmgHelmOfTelepat"],
    rare: ["D:Helm of Teleportation#dmgHelmOfTelepor", "A:Secret Keeper's Circlet#aunSecretKeepeVE"],
    veryRare: ["D:Helm of Brilliance#dmgHelmOfBrillia"]
  },
  ring: {
    uncommon: ["D:Ring of Jumping#dmgRingOfJumping", "D:Ring of Mind Shielding#dmgRingOfMindShi", "D:Ring of Swimming#dmgRingOfSwimmin", "D:Ring of Warmth#dmgRingOfWarmth0", "D:Ring of Water Walking#dmgRingOfWaterWa", "A:Ring of Dedicated Focus#aunRingofDediccN"],
    rare: ["D:Ring of Animal Influence#dmgRingOfAnimalI", "D:Ring of Evasion#dmgRingOfEvasion", "D:Ring of Feather Falling#dmgRingOfFeather", "D:Ring of Free Action#dmgRingOfFreeAct", "D:Ring of Protection#dmgRingOfProtect", "D:Ring of Resistance#dmgRingOfResista", "D:Ring of Spell Storing#dmgRingOfSpellSt", "D:Ring of the Ram#dmgRingOfTheRam0", "D:Ring of X-ray Vision#dmgRingOfXrayVis"],
    veryRare: ["D:Ring of Regeneration#dmgRingOfRegener", "D:Ring of Shooting Stars#dmgRingOfShootin", "D:Ring of Telekinesis#dmgRingOfTelekin"],
    legendary: ["D:Ring of Invisibility#dmgRingOfInvisib", "D:Ring of Spell Turning#dmgRingOfSpellTu"]
  },
  amulet: {
    uncommon: ["D:Amulet of Proof against Detection and Location#dmgAmuletOfProof", "D:Medallion of Thoughts#dmgMedallionOfTh", "D:Necklace of Adaptation#dmgNecklaceOfAda", "D:Periapt of Health#dmgPeriaptOfHeal", "D:Periapt of Wound Closure#dmgPeriaptOfWoun", "A:Necklace of the Beastly Familiar (Azurite)#aunNecklaceoftdK"],
    rare: ["D:Amulet of Health#dmgAmuletOfHealt", "D:Necklace of Fireballs#dmgNecklaceOfFir", "D:Necklace of Prayer Beads#dmgNecklaceOfPra", "D:Periapt of Proof against Poison#dmgPeriaptOfProo", "A:Blood Amulet#aunBloodAmuletFw"],
    veryRare: ["D:Amulet of the Planes#dmgAmuletOfThePl"]
  },
  robe: { uncommon: ["D:Robe of Useful Items#dmgRobeOfUsefulI"], veryRare: ["D:Robe of Scintillating Colors#dmgRobeOfScintil", "D:Robe of Stars#dmgRobeOfStars00"] }
};
/** Healing potions -> official Potion of Healing tiers by item level (reflavoured; data from the compendium / SRD). */
export const POTION_REFLAVOUR = [
  { maxIlvl: 25, name: "Potion of Healing" }, { maxIlvl: 35, name: "Potion of Greater Healing" },
  { maxIlvl: 45, name: "Potion of Superior Healing" }, { maxIlvl: Infinity, name: "Potion of Supreme Healing" }
];
function hashStr(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
/** Official item reference for a mapping entry: {name, pack, id}. */
function officialRef(entry) {
  const [, k, name, id] = entry.match(/^(\w):(.+)#(\w+)$/);
  return { name, pack: OFFICIAL_PACKS[k], id };
}

/** Wands: their damage school decides the cantrip they let you cast (SRD 5.2 cantrips). Missing school -> GM review. */
export const WAND_CANTRIP = { Fire: "Fire Bolt", Frost: "Ray of Frost", Arcane: "Eldritch Blast", Nature: "Poison Spray", Holy: "Sacred Flame" };

/** Healing potions by item level (dice from the SRD 5.2 potions of healing). */
export const POTION_HEALING = [
  { maxIlvl: 10, formula: [2, 4, 2] },
  { maxIlvl: 25, formula: [4, 4, 4] },
  { maxIlvl: 45, formula: [8, 4, 8] },
  { maxIlvl: Infinity, formula: [10, 4, 20] }
];
/** Mana potions: regain one expended spell slot of this level or lower. */
export const MANA_POTION_SLOT = [
  { maxIlvl: 15, level: 1 }, { maxIlvl: 30, level: 2 }, { maxIlvl: 45, level: 3 }, { maxIlvl: Infinity, level: 4 }
];
/** Food: extra hit points when eaten during a Short Rest. */
export const FOOD_HEALING = [
  { maxIlvl: 15, formula: [1, 4, 0] }, { maxIlvl: 35, formula: [1, 6, 0] }, { maxIlvl: Infinity, formula: [1, 8, 0] }
];
/** "Use: Restores N health" on gear: once per Long Rest, dice by item level. */
export const GEAR_HEALING = [
  { maxIlvl: 25, formula: [2, 4, 2] }, { maxIlvl: 45, formula: [4, 4, 4] }, { maxIlvl: Infinity, formula: [8, 4, 8] }
];

/**
 * Equip lines that are deliberately not converted, with the reason shown on the item. These are the classic
 * game's small incremental stats; 5e has no proportionate counterpart, or the base item already covers them.
 */
export const NOT_CONVERTED = [
  { rx: /Attack Power/i,                                why: "attack power has no separate 5e rule; weapon damage and the enhancement bonus cover it" },
  { rx: /critical strike/i,                             why: "a few % crit chance has no proportionate 5e rule (a 19–20 crit range would be far stronger)" },
  { rx: /chance to (dodge|parry|block)|block value/i,   why: "avoidance stats have no proportionate 5e rule; only chest armour and shields give AC" },
  { rx: /Increased Defense \+\d+|^\+\d+ Armor\.?$/i,     why: "small defence bonuses have no proportionate 5e rule; only chest armour and shields give AC" },
  { rx: /(mana|health) (per|every) 5 sec/i,             why: "in-combat regeneration has no 5e counterpart" },
  { rx: /Increased (Daggers|Swords|Axes|Maces|Bows|Guns|Crossbows|Staves|Polearms|Fist Weapons|Two-handed \w+) \+\d+/i, why: "weapon skill has no 5e counterpart (proficiency covers it)" },
  { rx: /chance to hit with spells/i,                   why: "a few % spell hit has no proportionate 5e rule" }
];

/* -------------------------------------------- */
/*  Parsing                                     */
/* -------------------------------------------- */

const TOOLTIP_MARK = '<div style="background:#0b0b10';
const HAND_OF = { "Two-Hand": "two", "One-Hand": "one", "Main Hand": "one", "Off Hand": "one", Ranged: "ranged", Thrown: "thrown" };
const ARMOR_SLOT = /^(Head|Shoulder|Chest|Wrist|Hands|Waist|Legs|Feet|Back|Relic)$/;
const ITEM_TYPE = /^(Sword|Axe|Mace|Dagger|Fist Weapon|Polearm|Staff|Bow|Crossbow|Gun|Thrown|Wand|Shield|Fishing Pole|Cloth|Leather|Mail|Plate|Idol|Libram|Totem)$/;
const KIND = { Equip: "equip", Use: "use", "Chance on hit": "hit" };
const KIND_LABEL = { equip: "Equip", use: "Use", hit: "Chance on hit" };

/** Extract the classic item facts from a source item (plain data or document). */
export function parseSource(src) {
  const html = src.system?.description?.value ?? "";
  const cut = html.indexOf(TOOLTIP_MARK);
  const tooltip = cut >= 0 ? html.slice(cut) : html;
  const lines = tooltipLines(tooltip).slice(1).map(l => l.replace(/\s+/g, " ")); // drop the item name
  const meta = analyse(src);
  const out = {
    ...meta, name: src.name, sourceType: src.type, wowType: null, hands: null, speed: null,
    damage: null, extraDamage: null, armor: null, block: null, stats: {}, statLines: {}, resist: {}, effects: [],
    sets: [], randomEnchant: false, flavour: [], classes: null, quest: false,
    handAuthored: !!src.flags?.[SOURCE_MODULE]?.handAuthored, consumableType: src.system?.type?.value ?? "",
    preText: cut > 0 ? html.slice(0, cut) : "", lines
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], next = lines[i + 1] ?? "";
    let m;
    if (!out.wowType && HAND_OF[l] !== undefined && ITEM_TYPE.test(next)) { out.wowType = next; out.hands = HAND_OF[l]; i++; continue; }
    if (!out.wowType && ARMOR_SLOT.test(l) && ITEM_TYPE.test(next)) { out.wowType = next; i++; continue; }
    if (!out.wowType && /^(Cloth|Leather|Mail|Plate)$/.test(l)) { out.wowType = l; continue; }
    if ((m = l.match(/^(\d+) - (\d+) (?:(\w+) )?Damage$/))) out.damage = { min: +m[1], max: +m[2], school: m[3] ?? null };
    else if ((m = l.match(/^\+ ?(\d+) - (\d+) (\w+) Damage$/))) out.extraDamage = { min: +m[1], max: +m[2], school: m[3], line: l };
    else if ((m = l.match(/^Speed ([\d.]+)$/))) out.speed = Number(m[1]);
    else if ((m = l.match(/^(\d+) Armor$/))) out.armor = +m[1];
    else if ((m = l.match(/^(\d+) Block$/))) out.block = +m[1];
    else if ((m = l.match(/^\+(\d+) (Strength|Agility|Stamina|Intellect|Spirit)$/))) { out.stats[STAT_MAP[m[2]]] = +m[1]; out.statLines[STAT_MAP[m[2]]] = l; }
    else if ((m = l.match(/^\+(\d+) (Fire|Frost|Nature|Shadow|Arcane|Holy) Resistance$/))) out.resist[m[2]] = +m[1];
    else if ((m = l.match(/^\+(\d+) All Resistances$/))) out.resist.All = +m[1];
    else if ((m = l.match(/^(Equip|Use|Chance on hit): (.+)$/))) out.effects.push({ kind: KIND[m[1]], text: m[2], line: l });
    else if ((m = l.match(/^\(\d+\) Set ?: (.+)$/))) out.sets.push(l);
    else if (l === "<Random enchantment>") out.randomEnchant = true;
    else if (/^".*"$/.test(l)) out.flavour.push(l);
    else if ((m = l.match(/^Classes: (.+)$/))) out.classes = m[1];
    else if (l === "Quest Item" || l === "This Item Begins a Quest") out.quest = true;
  }
  return out;
}

function byLevel(table, ilvl) { return table.find(r => (ilvl ?? 1) <= r.maxIlvl) ?? table.at(-1); }

function matchRule(rules, p) {
  return rules.find(r => (!r.wow || r.wow === p.wowType)
    && (!r.hands || r.hands === p.hands)
    && (!r.slot || r.slot === p.slot)
    && (r.maxSpeed === undefined || (p.speed ?? 0) <= r.maxSpeed)
    && (r.maxIlvl === undefined || (p.itemLevel ?? 1) <= r.maxIlvl)
    && (!r.name || r.name.test(p.name)));
}

/** Decide the broad target shape for an item. */
export function classify(p) {
  if (p.sourceType === "container") return "container";
  if (p.wowType === "Wand") return "wand";
  if (p.wowType === "Shield") return "shield";
  if (p.hands && WEAPON_RULES.some(r => r.wow === p.wowType)) return "weapon";
  if (p.slot === "Chest") return "chest";
  if (p.slot && SLOT_EQUIPMENT[p.slot]) return "gear";
  if (p.sourceType === "consumable") return "consumable";
  if (p.sourceType === "weapon") return "weapon";
  return "loot";
}

/* -------------------------------------------- */
/*  Hand-written items from the source module   */
/* -------------------------------------------- */

/**
 * Claims a hand-written 5e rule can make, and the tooltip text that has to back each one up.
 * `need` is tested against the item's effect text (Equip / Use / Chance-on-hit lines, resistances, set
 * bonuses and bonus damage lines; primary stat lines and the item's name never count as support).
 */
const DMG_SCHOOL = {
  fire: /Fire/, cold: /Frost|cold|ice/i, lightning: /Nature|lightning|storm|thunder/i, thunder: /Nature|lightning|storm|thunder/i,
  poison: /Nature|poison|venom/i, acid: /Nature|acid/i, necrotic: /Shadow/, radiant: /Holy/, force: /Arcane/, psychic: /\bmind\b|psychic/i
};
export const AUDIT_CLAIMS = [
  { id: "potion-heal",   rx: /regain [^.]*Hit Points when you drink/i,                     need: /Restores [\d.]+ to [\d.]+ health|health/i },
  { id: "spell-slot",    rx: /regain [^.]*spell slots?/i,                                   need: /mana/i },
  { id: "spell-dmg",     rx: /spells? (?:you cast )?that deals? ([A-Za-z, ]+?) damage deal/i, need: /damage (and healing )?done by .*spells|spell damage/i },
  { id: "spell-bonus",   rx: /bonus to spell attack rolls/i,                                need: /done by .*spells|spell damage/i },
  { id: "heal-bonus",    rx: /spell that restores Hit Points/i,                             need: /healing/i },
  { id: "resistance",    rx: /Resistance to (\w+) damage/gi, school: true,                  needResist: true },
  { id: "ignore-res",    rx: /ignore Resistance/i,                                          need: /ignore/i },
  { id: "dealt-dmg",     rx: /(?:extra|taking|take|takes|deal|deals) (?:\d+d\d+(?: \+ \d+)? |\d+ )?(\w+) damage/gi, school: true },
  { id: "crit",          rx: /critical hit|roll of 19 or 20/i,                              need: /critical|Chance on hit|chance to strike/i },
  { id: "reroll-miss",   rx: /miss with an attack roll|reroll/i,                            need: /chance to hit/i },
  { id: "attack-bonus",  rx: /bonus to attack rolls/i,                                      need: /chance to hit/i },
  { id: "ac-bonus",      rx: /bonus to Armor Class/i,                                       need: /Defense|Armor\.|armor by|dodge|parry/i },
  { id: "save-bonus",    rx: /bonus to [^.]*saving throws/i,                                need: /Resistance/i },
  { id: "temp-hp",       rx: /temporary Hit Points/i,                                       need: /absorb|shield|armor by|damage by|kill|Chance on hit/i },
  { id: "heal-other",    rx: /(restore|regains?) (\d+d\d+|an extra \d+d\d+|extra) Hit Points|restore \dd\d+ Hit Points/i, need: /heal|health/i },
  { id: "drop-to-1",     rx: /drop to 1 Hit Point/i,                                        need: /death|die|fatal/i },
  { id: "extra-attack",  rx: /(additional|extra) attacks?/i,                                need: /extra attack/i },
  { id: "speed",         rx: /Speed (is halved|is reduced|increases)|walking speed/i,     need: /slow|snare|speed by|run speed|movement/i },
  { id: "disadv-attack", rx: /Disadvantage on attack rolls/i,                               need: /attack speed|slow|reduce[sd]? .*(hit|attack)/i },
  { id: "cast-spell",    rx: /cast (?:the )?[A-Z][\w' ]+ (spell|cantrip)|as the [A-Z][\w ]+ spell|cast [A-Z][\w ]+ from/,  need: /^Use:/m },
  { id: "summon",        rx: /summon/i,                                                     need: /Summons/i },
  { id: "condition",     rx: /(Poisoned|Petrified|Frightened|Charmed|Prone|Grappled|Restrained|Paralyzed|Stunned|Invisible|Blinded|Deafened)/, need: /poison|stone|fear|charm|knock|root|stun|invis|blind|grip|paraly/i },
  { id: "senses",        rx: /Darkvision|see Invisible|Truesight|Blindsight/i,              need: /vision|detect|see /i },
  { id: "advantage",     rx: /Advantage on [^.]*(checks|Opportunity|saving throws against being|saving throws against the)/i, need: /stealth|detect|resist .*(fear|stun|poison)|^Use:/im },
  { id: "concentration", rx: /Concentration/i,                                              need: /interrupt|pushback|concentrat|casting time/i },
  { id: "terrain",       rx: /Difficult Terrain|no tracks|cannot be tracked|need to sleep|Opportunity Attacks|Half Cover|Sneak Attack|push it \d+ feet|Feather Fall|stonework/i, need: /$^/ },
  { id: "focus",         rx: /used as a Spellcasting Focus|use this \w+ as a Spellcasting Focus/i, needType: /Staff|Wand|Held In Off-hand|Relic/ },
  { id: "charges",       rx: /\bcharges?\b/i,                                               need: /^Use:|Charges|Chance on hit/im }
];

/** Effect text a hand-written rule may be traced to (never stat lines or the name). */
function supportText(p) {
  return [
    ...p.effects.map(e => e.line), ...p.sets,
    ...Object.entries(p.resist).map(([k, v]) => `+${v} ${k} Resistance`),
    ...(p.extraDamage ? [p.extraDamage.line] : []),
    ...(p.damage?.school ? [`${p.damage.school} Damage`] : [])
  ].join("\n");
}

/** Split the source module's hand-written HTML into {name, text} features. */
export function handFeatures(preHtml) {
  const out = [];
  const parts = String(preHtml ?? "").split(/<p><strong>/i).slice(1);
  for (const part of parts) {
    const [nameRaw, rest = ""] = part.split(/<\/strong>/i);
    const name = nameRaw.replace(/<[^>]*>/g, "").trim().replace(/\.$/, "");
    const text = rest.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    out.push({ name, text });
  }
  if (!out.length && preHtml) {
    const text = preHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text) out.push({ name: "", text });
  }
  return out;
}

/**
 * Check the source module's hand-written 5e rule for an item against its tooltip: every mechanic it names
 * has to be backed by a tooltip line. Returns {pass, problems:[{claim, text}], support:[line]}.
 */
export function auditHandAuthored(p) {
  const feats = handFeatures(p.preText);
  const text = feats.map(f => f.text).join(" ");
  const support = supportText(p);
  const problems = [], used = new Set();
  const school = t => DMG_SCHOOL[String(t).toLowerCase()];
  for (const c of AUDIT_CLAIMS) {
    const rx = new RegExp(c.rx.source, c.rx.flags.includes("g") ? c.rx.flags : c.rx.flags + "g");
    for (const m of text.matchAll(rx)) {
      let ok;
      if (c.id === "resistance") {
        if (/ignore\s*$/i.test(text.slice(Math.max(0, m.index - 8), m.index))) continue; // "ignore Resistance to X" is its own claim
        const want = school(m[1]);
        const lines = Object.entries(p.resist).filter(([k]) => k === "All" || (want && want.test(k)));
        ok = lines.length > 0;
        if (ok) used.add(`+${lines[0][1]} ${lines[0][0]} Resistance`);
      } else if (c.id === "dealt-dmg") {
        const t = m[1].toLowerCase();
        if (["slashing", "piercing", "bludgeoning"].includes(t)) ok = !!p.damage && (/damage|wound/i.test(p.effects.map(e => e.text).join(" ")) || /weapon/i.test(m[0]));
        else if (!school(t)) continue; // "Fire" in "Resistance to Fire damage" etc. is handled elsewhere
        else {
          // Damage dealt needs a damage line of that school (a resistance line is not enough).
          const dmgLines = [...p.effects.map(e => e.line), ...(p.extraDamage ? [p.extraDamage.line] : []), ...(p.damage?.school ? [`${p.damage.school} Damage`] : []), ...p.sets];
          const hit = dmgLines.find(l => /damage/i.test(l) && school(t).test(l));
          // "Spells that deal X damage deal extra" is covered by the spell-dmg claim.
          if (/spells? (?:you cast )?that deals?/i.test(text.slice(Math.max(0, m.index - 40), m.index + m[0].length))) continue;
          if (/Resistance to/i.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
          ok = !!hit;
          if (hit) used.add(hit);
        }
      } else if (c.needType) {
        ok = c.needType.test(p.wowType ?? "") || c.needType.test(p.slot ?? "");
      } else {
        const lm = support.split("\n").find(l => c.need.test(l));
        ok = !!lm;
        if (lm) used.add(lm);
      }
      if (!ok && !problems.some(x => x.claim === c.id && x.text.toLowerCase() === m[0].toLowerCase())) problems.push({ claim: c.id, text: m[0] });
    }
  }
  if (feats.length && !support.trim() && !problems.length) problems.push({ claim: "no-line", text: "no Equip / Use / Chance on hit / resistance line to trace to" });
  return { pass: problems.length === 0, problems, support: [...used], features: feats };
}

/* -------------------------------------------- */
/*  Conversion                                  */
/* -------------------------------------------- */

const dice = ([n, d, b]) => `${n}d${d}${b ? ` + ${b}` : ""}`;
const ID = suffix => `lootledger${suffix}`.padEnd(16, "0").slice(0, 16);
const avg = d => (d.min + d.max) / 2;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const short = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Convert one source item.
 * @param {object} src                 source item (plain data or Item document)
 * @param {object} [options]
 * @param {"100"|"10"} [options.ratio="100"]       coin ratio for the price
 * @param {boolean} [options.keepHandAuthored=true] keep the source module's hand-written 5e rules when they
 *                                                  pass auditHandAuthored()
 * @param {string}  [options.dnd5eMajor]           dnd5e major version (rarity field shape)
 * @returns {{data: object, result: object, parsed: object}}
 */
export function convertItem(src, options = {}) {
  const {
    ratio = "100", keepHandAuthored = true,
    dnd5eMajor = Number(String(globalThis.game?.system?.version ?? "6").split(".")[0])
  } = options;
  const p = parseSource(src);
  const base = typeof src.toObject === "function" ? src.toObject() : structuredClone(src);
  const rarity = QUALITY_BY_KEY[p.quality]?.rarity ?? "common";
  const ctx = {
    p, tier: TIER[p.quality] ?? 0, features: [], notConverted: [], review: [], riders: [],
    bonus: 0, attune: false, attuneBy: "", magic: false, summary: "", basis: "", extras: {}
  };

  const shape = classify(p);
  const auto = buildSystem(shape, ctx);
  let system = auto.system ?? clone(base.system);
  let itemType = auto.type;
  const basedOn = pickOfficial(p, shape, ctx, src);

  // The source module's own hand-written rules: kept only when every mechanic in them traces to a line.
  let hand = null;
  if (p.handAuthored) {
    const audit = auditHandAuthored(p);
    hand = { audit, kept: keepHandAuthored && audit.pass };
    if (hand.kept) {
      itemType = base.type;
      system = clone(base.system);
      // Slot rule: only chest armour and shields give AC.
      if (shape === "gear" && SLOT_EQUIPMENT[p.slot] === "clothing" && ["light", "medium", "heavy"].includes(system.type?.value)) {
        hand.slotNote = `was ${system.type.value} armour; only chest armour and shields give AC`;
        system.type = { value: "clothing", baseItem: "" };
        system.armor = { ...(system.armor ?? {}), value: null, dex: null };
      }
    }
  }

  const sourceHtml = base.system?.description?.value ?? "";
  const price = priceFor(p.vendorSellCopper, ratio);
  system.description = { value: sourceHtml + rulesBlock(ctx, hand, shape), chat: "" };
  system.price = price;
  if (dnd5eMajor >= 6) { system.rarities = [rarity]; delete system.rarity; }
  else { system.rarity = rarity; delete system.rarities; }
  system.identified = true;
  system.quantity ??= 1;

  const kept = hand?.kept;
  const needsReview = !kept && ctx.review.length > 0;
  const flags = clone(base.flags ?? {});
  flags[MODULE_ID] = {
    sourceUuid: src.uuid ?? null, quality: p.quality, itemLevel: p.itemLevel,
    ...(p.requiredLevel !== null ? { requiredLevel: p.requiredLevel } : {}),
    vendorSellCopper: p.vendorSellCopper, vendorSell: formatCoins(p.vendorSellCopper), noSell: p.noSell,
    slot: p.slot, category: p.category, band: p.band, coinRatio: ratio,
    riders: kept ? [] : ctx.riders,
    converted: {
      version: CONVERTER_VERSION, shape, needsReview,
      handAuthored: !!p.handAuthored, handAuthoredKept: !!kept,
      ...(hand && !kept ? { handAuthoredReplaced: hand.audit.problems.map(x => `${x.claim}: ${x.text}`) } : {}),
      summary: ctx.summary, review: ctx.review.map(r => `${r.line} — ${r.why}`),
      notConverted: ctx.notConverted.map(r => r.line)
    }
  };

  const data = {
    _id: base._id, name: base.name, type: itemType, img: base.img, system,
    effects: kept ? (base.effects ?? []) : [], flags, sort: 0
  };

  const sys = system;
  const features = kept
    ? hand.audit.features.map(f => ({ text: `${f.name ? `${f.name}. ` : ""}${f.text}`, source: `hand-written by the source module; traces to: ${hand.audit.support.map(s => short(s, 60)).join("; ") || "—"}` }))
    : ctx.features.map(f => ({ text: `${f.name}. ${f.text}`, source: f.source }));
  const result = {
    type: itemType + (sys.type?.value ? `:${sys.type.value}` : ""),
    base: sys.type?.baseItem || (shape === "weapon" && ctx.extras.base) || "",
    rarity,
    bonus: kept ? Number(sys.magicalBonus ?? sys.armor?.magicalBonus ?? 0) || 0 : ctx.bonus,
    attunement: sys.attunement === "required" ? (ctx.attuneBy && !kept ? `required (${ctx.attuneBy})` : true) : false,
    damage: sys.damage?.base?.denomination ? `${sys.damage.base.number}d${sys.damage.base.denomination} ${sys.damage.base.types?.[0] ?? ""}`.trim() : "",
    ac: itemType === "equipment" && sys.armor?.value ? (sys.type?.value === "shield" ? `+${sys.armor.value}` : String(sys.armor.value)) : "",
    properties: (sys.properties ?? []).join(","),
    features,
    notConverted: kept ? [] : ctx.notConverted.map(r => `${short(r.line, 50)} (${r.short ?? r.why})`),
    basedOn: basedOn?.name ?? "",
    needsReview,
    reviewReason: needsReview ? ctx.review.map(r => `${short(r.line, 60)}: ${r.why}`).join(" | ") : "",
    price: `${price.value} ${price.denomination}`,
    ...(hand ? { handAuthored: kept ? "kept (passes audit)" : `replaced: ${hand.audit.problems.map(x => x.text).join("; ")}` } : {})
  };
  return { data, result, parsed: p, basedOn, sourceHtml };
}

/**
 * Reflavour pick (see REFLAVOUR): returns an official item ref {name, pack, id} or null.
 * Gear with no feature from any line, Uncommon or better, in a mapped slot; healing potions by item level.
 */
export function pickOfficial(p, shape, ctx, src = {}) {
  if (shape === "consumable") {
    if (!p.effects.some(e => e.kind === "use" && /^Restores \d+ to \d+ health/i.test(e.text))) return null;
    return { name: byLevel(POTION_REFLAVOUR, p.itemLevel).name, pack: OFFICIAL_PACKS.D, id: null };
  }
  if (ctx.tier < 1 || ctx.features.length || ctx.review.length || p.handAuthored) return null;
  if (!["gear", "chest"].includes(shape) || ctx.extras.armor) return null;
  const slot = REFLAVOUR_SLOT[p.slot];
  const rarity = QUALITY_BY_KEY[p.quality]?.rarity;
  const list = REFLAVOUR[slot]?.[rarity];
  if (!list?.length) return null;
  const key = src.flags?.[SOURCE_MODULE]?.itemId ?? src.flags?.[SOURCE_MODULE]?.id ?? src._id ?? p.name;
  return officialRef(list[hashStr(key) % list.length]);
}

/**
 * Apply an official item's data to a conversion: keep the WoW name, icon, tooltip/flavour and Loot Ledger flags;
 * take type, system data, effects and rules text from the official document (passed in, read at build time
 * from the user's compendium). Adds "Based on: <name>".
 */
export function applyOfficial(conv, official) {
  const o = typeof official.toObject === "function" ? official.toObject() : clone(official);
  const { data } = conv;
  const sys = clone(o.system);
  const note = `<section class="loot-ledger-5e"><p><strong>5e:</strong> reflavoured official item. <em>Based on: ${esc(o.name)}.</em> No line of this item converts, so it uses that item's rules (from your installed compendium).</p></section>`;
  sys.description = { ...(sys.description ?? {}), value: conv.sourceHtml + note + (o.system?.description?.value ?? "") };
  sys.price = data.system.price;
  sys.identified = true;
  data.type = o.type; data.system = sys; data.effects = o.effects ?? [];
  const c = data.flags[MODULE_ID].converted;
  c.basedOn = { name: o.name, uuid: official.uuid ?? null }; c.notConverted = []; c.summary = `Reflavoured ${o.name}`;
  Object.assign(conv.result, {
    type: o.type + (sys.type?.value ? `:${sys.type.value}` : ""), base: sys.type?.baseItem ?? "",
    rarity: sys.rarity ?? sys.rarities?.[0] ?? conv.result.rarity, bonus: 0,
    attunement: sys.attunement === "required" || sys.attunement === true, damage: "", ac: "",
    properties: [...(sys.properties ?? [])].join(","), features: [{ text: `Based on: ${o.name}. Official rules text and data copied from the compendium.`, source: "reflavour (no convertible lines)" }],
    notConverted: [], basedOn: o.name
  });
  return conv;
}

function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

/* -------------------------------------------- */
/*  Features                                    */
/* -------------------------------------------- */

/** "holding" for weapons, shields, wands and held items; "carrying" for trinkets; "wearing" for the rest. */
function verb(ctx) {
  const { p } = ctx;
  if (ctx.extras.weapon || p.wowType === "Shield" || p.wowType === "Wand" || p.slot === "Held In Off-hand" || p.slot === "Relic") return "holding";
  return p.slot === "Trinket" ? "carrying" : "wearing";
}
const SLOT_NOUN = {
  Head: "headgear", Shoulder: "mantle", Chest: "garment", Hands: "pair of gloves", Wrist: "pair of bracers", Waist: "belt",
  Legs: "pair of leggings", Feet: "pair of boots", Back: "cloak", Shirt: "shirt", Tabard: "tabard", Finger: "ring",
  Neck: "amulet", Trinket: "trinket", "Held In Off-hand": "item", Relic: "relic"
};
function itemNoun(ctx) {
  const { p } = ctx;
  if (ctx.extras.weapon) return "weapon";
  if (p.wowType === "Shield") return "shield";
  if (p.wowType === "Wand") return "wand";
  if (ctx.extras.armor) return "armor";
  return SLOT_NOUN[p.slot] ?? "item";
}

function addFeature(ctx, f) {
  ctx.features.push(f);
  if (f.rider) {
    ctx.riders.push({ ...f.rider, source: f.sourceLine ?? f.source });
    if (ATTUNE_RIDERS.has(f.rider.type)) ctx.attune = true;
  }
  ctx.magic = true;
}
function notConverted(ctx, line, why, shortWhy) { ctx.notConverted.push({ line, why, short: shortWhy }); }
function review(ctx, line, why) { ctx.review.push({ line, why }); }

function damageType(school, text = "") {
  if (school === "Nature" && /lightning|storm|thunder/i.test(text)) return "Lightning";
  return SCHOOL_MAP[school] ?? null;
}

/** Enhancement bonus from quality (weapons, chest armour, shields). Run after the lines, see GEAR_BONUS. */
function enhancement(ctx, kind) {
  const { tier, p } = ctx;
  const effect = ctx.features.find(f => f.rider && EFFECT_RIDERS.has(f.rider.type));
  const row = GEAR_BONUS[tier] ?? GEAR_BONUS[0];
  ctx.bonus = effect ? row.withEffect : row.plain;
  if (!ctx.bonus) return;
  const why = row.plain !== row.withEffect ? " with no effect line" : "";
  const text = kind === "weapon"
    ? `You have a +${ctx.bonus} bonus to attack rolls and damage rolls made with this magic weapon.`
    : kind === "shield"
      ? `While holding this shield, you have a +${ctx.bonus} bonus to Armor Class, on top of the shield's normal +2.`
      : `While wearing this armor, you have a +${ctx.bonus} bonus to Armor Class.`;
  ctx.features.unshift({ name: `+${ctx.bonus} ${kind === "weapon" ? "Weapon" : kind === "shield" ? "Shield" : "Armor"}`, text, source: `${QUALITY_NAME[p.quality]} quality${why}` });
  ctx.magic = true;
}

/** The single highest primary stat, when large enough; the rest are listed as not converted. */
function applyStats(ctx) {
  const { p, tier } = ctx;
  const keys = STAT_ORDER.filter(k => p.stats[k]);
  if (!keys.length) return;
  let top = null;
  for (const k of keys) if (top === null || p.stats[k] > p.stats[top]) top = k;
  const min = Math.max(STAT_RULE.minValue, Math.ceil((p.itemLevel ?? 1) / STAT_RULE.perItemLevel));
  const value = p.stats[top];
  if (tier >= STAT_RULE.minTier && value >= min) {
    const line = p.statLines[top];
    if (top === "con") {
      const n = STAT_RULE.saveBonus[tier];
      addFeature(ctx, {
        name: "Fortitude", sourceLine: line,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you have a +${n} bonus to Constitution saving throws.`,
        source: `${line} (the item's main stat)`,
        rider: { type: "saveBonus", ability: "con", value: n, trigger: "equipped" }
      });
    } else {
      const n = STAT_RULE.checkBonus[tier];
      addFeature(ctx, {
        name: { str: "Might", dex: "Deftness", int: "Cunning", wis: "Clarity" }[top], sourceLine: line,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you have a +${n} bonus to ability checks that use ${ABILITY_LABEL[top]} (including skill checks based on ${ABILITY_LABEL[top]}).`,
        source: `${line} (the item's main stat)`,
        rider: { type: "checkBonus", ability: top, value: n, trigger: "equipped" }
      });
    }
    for (const k of keys) if (k !== top) notConverted(ctx, p.statLines[k], "only the item's main stat becomes a 5e rule", "secondary stat");
  } else {
    const why = tier < STAT_RULE.minTier
      ? "stats on Common and Poor items have no 5e rule"
      : `main stat below the conversion threshold (${min} at item level ${p.itemLevel ?? "?"})`;
    for (const k of keys) notConverted(ctx, p.statLines[k], why, tier < STAT_RULE.minTier ? "common item stat" : `below ${min}`);
  }
}

/** Trinket main stat -> check or save bonus (TRINKET_RULE). Runs after the effect lines. */
function applyTrinketStat(ctx) {
  const { p, tier } = ctx;
  const keys = STAT_ORDER.filter(k => p.stats[k]);
  const effect = ctx.features.find(f => f.rider && EFFECT_RIDERS.has(f.rider.type));
  if (!keys.length) {
    if (!ctx.features.length && !ctx.review.length) review(ctx, "Trinket", "trinket with no stat and no convertible line; decide whether it needs a feature");
    return;
  }
  let top = null;
  for (const k of keys) if (top === null || p.stats[k] > p.stats[top]) top = k;
  const rest = keys.filter(k => k !== top);
  if (tier < TRINKET_RULE.minTier) { for (const k of keys) notConverted(ctx, p.statLines[k], "stats on Common and Poor items have no 5e rule", "common item stat"); return; }
  if (tier === 1 && effect) {
    for (const k of keys) notConverted(ctx, p.statLines[k], `an Uncommon trinket gets its effect (${effect.name}) instead of a stat bonus`, "effect instead");
    return;
  }
  const defensive = top === "con" || Object.keys(p.resist).length > 0 || p.effects.some(e => e.kind === "equip" && TRINKET_RULE.defensive.test(e.text));
  const n = TRINKET_RULE.bonus[tier];
  const line = p.statLines[top];
  const why = top === "con" ? "Stamina is its main stat" : defensive ? "its lines are defensive" : "its lines are offensive or utility";
  addFeature(ctx, defensive ? {
    name: "Steadfast", sourceLine: line, source: `${line} (main stat; saving throws because ${why})`,
    text: `While carrying this trinket, you have a +${n} bonus to ${ABILITY_LABEL[top]} saving throws.`,
    rider: { type: "saveBonus", ability: top, value: n, trigger: "equipped" }
  } : {
    name: "Knack", sourceLine: line, source: `${line} (main stat; ability checks because ${why})`,
    text: `While carrying this trinket, you have a +${n} bonus to ability checks that use ${ABILITY_LABEL[top]} (including skill checks based on ${ABILITY_LABEL[top]}).`,
    rider: { type: "checkBonus", ability: top, value: n, trigger: "equipped" }
  });
  for (const k of rest) notConverted(ctx, p.statLines[k], "only the trinket's main stat becomes a 5e rule", "secondary stat");
}

function applyResistances(ctx) {
  const { p } = ctx;
  for (const [school, value] of Object.entries(p.resist)) {
    const line = school === "All" ? `+${value} All Resistances` : `+${value} ${school} Resistance`;
    if (school === "All") { notConverted(ctx, line, "a small bonus to every resistance has no proportionate 5e rule", "small"); continue; }
    const min = Math.max(RESIST_RULE.minValue, Math.ceil((p.itemLevel ?? 1) * RESIST_RULE.perItemLevel));
    if (value >= min) {
      const type = SCHOOL_MAP[school];
      addFeature(ctx, {
        name: `${type} Resistance`, sourceLine: line,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you have Resistance to ${type} damage.`,
        source: line, rider: { type: "resistance", damageType: type.toLowerCase(), value: 1, trigger: "equipped" }
      });
    } else notConverted(ctx, line, `too small for 5e Resistance (needs +${min} at item level ${p.itemLevel ?? "?"})`, `below ${min}`);
  }
}

/** A damage proc on a weapon. */
function procFeature(ctx, school, lo, hi, line, kindLabel) {
  const { p, tier } = ctx;
  const type = damageType(school, line);
  const ratio = ((lo + (hi ?? lo)) / 2) / Math.max(1, avg(p.damage ?? { min: 1, max: 1 }));
  const src = `${kindLabel} — ${lo}${hi ? `–${hi}` : ""} ${school} damage (${ratio.toFixed(1)}× a normal hit)`;
  if (ratio < PROC_RULE.critBelow) {
    const d = PROC_RULE.critDice[tier];
    addFeature(ctx, {
      name: `${type} Strike`, sourceLine: line, source: src,
      text: `When you score a Critical Hit with this weapon, the target takes an extra ${d} ${type} damage. This extra damage isn't doubled by the Critical Hit.`,
      rider: { type: "extraDamage", formula: d, damageType: type.toLowerCase(), trigger: "critical" }
    });
  } else if (ratio < PROC_RULE.burstFrom) {
    const d = PROC_RULE.onHitDice[tier];
    addFeature(ctx, {
      name: `${type} Strike`, sourceLine: line, source: src,
      text: `When you hit a creature with an attack using this weapon, it takes an extra ${d} ${type} damage. You can deal this extra damage only once per turn.`,
      rider: { type: "extraDamage", formula: d, damageType: type.toLowerCase(), trigger: "hit", limit: "oncePerTurn" }
    });
  } else {
    const d = PROC_RULE.burstDice[tier];
    addFeature(ctx, {
      name: `${type} Blast`, sourceLine: line, source: src,
      text: `When you hit a creature with an attack using this weapon, you can release a blast: the target takes an extra ${d} ${type} damage. Once you use this property, you can't use it again until you finish a Short or Long Rest.`,
      rider: { type: "burstDamage", formula: d, damageType: type.toLowerCase(), trigger: "hit", uses: 1, recovery: "sr" }
    });
  }
}

/** Equip / Use / Chance-on-hit lines (gear and weapons; consumables have their own handler). */
function applyEffects(ctx) {
  const { p, tier } = ctx;
  const isWeapon = !!ctx.extras.weapon;
  for (const fx of p.effects) {
    const t = fx.text, line = fx.line, label = KIND_LABEL[fx.kind];
    let m;
    const absorbed = NOT_CONVERTED.find(r => r.rx.test(t));
    // Damage procs: "Chance on hit: ... N (to M) School damage" or "Equip: Chance to strike ... for N to M School damage".
    const dmg = t.match(/(\d+)(?: to (\d+))? (Fire|Frost|Nature|Shadow|Arcane|Holy) damage/i);
    const isProc = fx.kind === "hit" || (fx.kind === "equip" && /\bchance\b/i.test(t));
    if (dmg && isProc) {
      const extra = t.replace(/\(.*?\)/g, "").split(/\.\s+/).filter(x => x.trim()).length > 1;
      if (!isWeapon) { review(ctx, line, "damage proc on an item that is not a weapon; no weapon to attach it to"); continue; }
      if (extra) { review(ctx, line, "the proc does more than deal damage (extra targets or effects); write this one by hand"); continue; }
      const school = cap(dmg[3].toLowerCase());
      procFeature(ctx, school, +dmg[1], dmg[2] ? +dmg[2] : null, line, label);
      continue;
    }
    if ((m = t.match(/(\d+|an?) extra attacks?/i)) && isProc) {
      const n = Math.min(EXTRA_ATTACK_RULE.max[tier], /^\d+$/.test(m[1]) ? +m[1] : 1);
      const melee = /melee/i.test(t) || (isWeapon && !ctx.extras.ranged);
      const weaponText = isWeapon ? "this weapon" : melee ? "a melee weapon" : "a weapon";
      const uses = EXTRA_ATTACK_RULE.uses[tier];
      const often = uses === 1 ? "Once you use this property, you can't use it again until you finish a Short or Long Rest."
        : `You can use this property ${uses === 2 ? "twice" : `${uses} times`}, and you regain all expended uses when you finish a Short or Long Rest.`;
      addFeature(ctx, {
        name: "Flurry", sourceLine: line, source: `${label} — ${short(t, 60)}; ${uses}/Short Rest by quality`,
        text: `When you hit a creature with ${weaponText} as part of the Attack action, you can immediately make ${n === 1 ? "one additional attack" : `${n} additional attacks`} with that weapon as part of the same action. ${often}`,
        rider: { type: "extraAttack", value: n, trigger: melee ? "meleeHit" : "hit", uses, recovery: "sr" }
      });
      continue;
    }
    if (fx.kind === "use" && (m = t.match(/^Restores (\d+) to (\d+) health\.?/i))) {
      const f = byLevel(GEAR_HEALING, p.itemLevel).formula;
      addFeature(ctx, {
        name: "Restore", sourceLine: line, source: `Use — restores ${m[1]}–${m[2]} health`,
        text: `As a Magic action, you can use this ${itemNoun(ctx)} to regain ${dice(f)} Hit Points. Once you do so, you can't do so again until you finish a Long Rest.`,
        rider: { type: "heal", formula: dice(f), trigger: "magicAction", uses: 1, recovery: "lr" }
      });
      continue;
    }
    if (fx.kind === "equip" && (m = t.match(/chance to hit by (\d+)%/i)) && !/spell/i.test(t)) {
      if (isWeapon) { notConverted(ctx, line, "the weapon's enhancement bonus already covers accuracy", "covered by weapon bonus"); continue; }
      if (tier < HIT_RULE.minTier) { notConverted(ctx, line, "hit chance on Common or Poor items has no 5e rule", "common item"); continue; }
      if (ctx.extras.attackBonus) { notConverted(ctx, line, "only one attack bonus per item", "duplicate"); continue; }
      ctx.extras.attackBonus = true;
      const hb = HIT_RULE.bonus, spell = isCasterGear(p);
      addFeature(ctx, {
        name: "Precision", sourceLine: line, source: `Equip — +${m[1]}% chance to hit${spell ? " (caster gear: spell attacks)" : ""}`,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you have a +${hb} bonus to ${spell ? "spell attack rolls" : "attack rolls made with weapons"}.`,
        rider: { type: "attackBonus", value: hb, scope: spell ? "spell" : "weapon", trigger: "equipped" }
      });
      continue;
    }
    if (fx.kind === "equip" && (m = t.match(/^Increases (damage and healing|damage|healing) done by (?:(Fire|Frost|Nature|Shadow|Arcane|Holy) |magical )?spells and effects by up to (\d+)/i))) {
      const what = m[1].toLowerCase(), school = m[2] ? cap(m[2].toLowerCase()) : null, n = +m[3];
      const min = Math.max(SPELL_RULE.minValue, Math.ceil((p.itemLevel ?? 1) / SPELL_RULE.perItemLevel));
      if (n < min) { notConverted(ctx, line, `spell power below the conversion threshold (${min} at item level ${p.itemLevel ?? "?"})`, `below ${min}`); continue; }
      if (ctx.extras.spell) { notConverted(ctx, line, "only one spellcasting bonus per item", "duplicate"); continue; }
      ctx.extras.spell = true;
      ctx.attuneBy = "by a spellcaster";
      if (what === "healing") {
        const d = SPELL_RULE.healDie[tier];
        addFeature(ctx, {
          name: "Mending Light", sourceLine: line, source: `Equip — +${n} healing done by spells`,
          text: `While ${verb(ctx)} this ${itemNoun(ctx)}, when you cast a spell that restores Hit Points, one creature it heals regains an extra ${d} Hit Points.`,
          rider: { type: "healBonus", formula: d, trigger: "healingSpell" }
        });
      } else {
        const b = SPELL_RULE.bonus[tier];
        const type = school ? damageType(school, t) : null;
        addFeature(ctx, {
          name: "Spell Focus", sourceLine: line, source: `Equip — +${n} ${school ? `${school} ` : ""}spell ${what}`,
          text: type
            ? `While ${verb(ctx)} this ${itemNoun(ctx)}, you have a +${b} bonus to spell attack rolls for spells that deal ${type} damage.`
            : `While ${verb(ctx)} this ${itemNoun(ctx)}, you have a +${b} bonus to spell attack rolls and to the saving throw DCs of your spells.`,
          rider: { type: "spellBonus", value: b, damageType: type?.toLowerCase() ?? null, scope: type ? "attack" : "attackAndDC", trigger: "equipped" }
        });
      }
      continue;
    }
    if (fx.kind === "equip" && (m = t.match(/^Increased Defense \+(\d+)|^\+(\d+) Armor\.?$/i))) {
      if (ctx.extras.armor || p.wowType === "Shield") { notConverted(ctx, line, "the armour's or shield's own AC already covers it", "covered by base AC"); continue; }
      if (tier < DEFENSE_RULE.minTier) { notConverted(ctx, line, "defence on Common or Poor items has no 5e rule", "common item"); continue; }
      if (ctx.extras.acBonus) { notConverted(ctx, line, "only one AC bonus per item", "duplicate"); continue; }
      ctx.extras.acBonus = true;
      addFeature(ctx, {
        name: "Warding", sourceLine: line, source: `Equip — ${m[1] ? `+${m[1]} Defense` : `+${m[2]} Armor`}`,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you have a +${DEFENSE_RULE.ac} bonus to Armor Class.`,
        rider: { type: "acBonus", value: DEFENSE_RULE.ac, trigger: "equipped" }
      });
      continue;
    }
    if (absorbed) { notConverted(ctx, line, absorbed.why, short(absorbed.why.split(";")[0], 40)); continue; }
    review(ctx, line, "no conversion rule for this line yet; kept as flavour with no mechanics");
  }
}

function applyLinesCommon(ctx) {
  if (ctx.p.slot === "Trinket") {
    applyResistances(ctx);
    applyEffects(ctx);
    applyTrinketStat(ctx);
  } else {
    applyStats(ctx);
    applyResistances(ctx);
    applyEffects(ctx);
  }
  const { p } = ctx;
  for (const s of p.sets) notConverted(ctx, s, "set bonuses are not converted yet, as there are no set rules", "set bonus");
  if (p.randomEnchant) notConverted(ctx, "<Random enchantment>", "random enchantments are not rolled", "random enchantment");
}

/* -------------------------------------------- */
/*  Item shapes                                 */
/* -------------------------------------------- */

function attackActivity(ranged) {
  return {
    _id: ID("Attack"), type: "attack", sort: 0, name: "",
    activation: { type: "action", value: 1, condition: "", override: false },
    attack: { ability: "", bonus: "", flat: false, critical: { threshold: null }, type: { value: ranged ? "ranged" : "melee", classification: "weapon" } },
    damage: { includeBase: true, parts: [], critical: { bonus: "" } }
  };
}

function healActivity(formula, { activation = "bonus", name = "" } = {}) {
  const [number, denomination, bonus] = formula;
  return {
    _id: ID("Heal"), type: "heal", sort: 0, name,
    activation: { type: activation, value: 1, condition: "", override: false },
    consumption: { targets: [{ type: "itemUses", value: "1", target: "", scaling: {} }], scaling: { allowed: false }, spellSlot: true },
    healing: { number, denomination, bonus: bonus ? String(bonus) : "", types: ["healing"], custom: { enabled: false }, scaling: { number: 1 } },
    range: { units: "touch", override: false },
    target: { affects: { type: "creature", count: "1", choice: false }, override: false, prompt: true }
  };
}

function utilityActivity(text) {
  return {
    _id: ID("Use"), type: "utility", sort: 0, name: "",
    activation: { type: "bonus", value: 1, condition: "", override: false },
    consumption: { targets: [{ type: "itemUses", value: "1", target: "", scaling: {} }], scaling: { allowed: false }, spellSlot: true },
    description: { chatFlavor: text, value: "" }
  };
}

function commonSystem() {
  return {
    source: { rules: "2024", revision: 1, custom: "Loot Ledger (converted)" },
    quantity: 1, identified: true, attunement: "", properties: []
  };
}

/** Build the converted system data for a shape. Returns {type, system}. */
function buildSystem(shape, ctx) {
  const { p } = ctx;
  const sys = commonSystem();

  if (shape === "weapon") {
    const rule = matchRule(WEAPON_RULES, p);
    if (!rule) review(ctx, `${p.wowType ?? "?"} weapon`, "unknown weapon type; used a club as a placeholder");
    const key = rule?.base ?? "club";
    const b = WEAPON_BASES[key];
    ctx.extras.base = key; ctx.extras.weapon = true; ctx.extras.ranged = b.type.endsWith("R");
    const props = rule?.focus ? [...b.props, "foc"] : [...b.props];
    Object.assign(sys, {
      type: { value: b.type, baseItem: b.custom ? "" : key },
      damage: {
        base: { number: b.dmg[0], denomination: b.dmg[1], bonus: "", types: [b.dmg[2]], custom: { enabled: false }, scaling: { number: 1 } },
        versatile: b.ver ? { number: b.ver[0], denomination: b.ver[1], bonus: "", types: [b.dmg[2]], custom: { enabled: false }, scaling: { number: 1 } } : {}
      },
      range: { value: b.range?.[0] ?? null, long: b.range?.[1] ?? null, reach: b.props.includes("rch") ? 10 : null, units: "ft" },
      properties: props,
      mastery: b.mastery,
      weight: { value: b.weight, units: "lb" },
      activities: { [ID("Attack")]: attackActivity(ctx.extras.ranged) }
    });
    const handsLabel = { two: "Two-Hand", one: p.slot ?? "One-Hand", ranged: "Ranged", thrown: "Thrown" }[p.hands] ?? "";
    const propText = props.map(x => x === "ver" ? `Versatile (${b.ver[0]}d${b.ver[1]})` : PROP_LABEL[x]).join(", ");
    ctx.basis = `${handsLabel} ${p.wowType ?? "weapon"}${p.speed ? `, speed ${p.speed.toFixed(2)}` : ""} → ${b.label}${b.custom ? " (Loot Ledger custom weapon)" : ""}: ${b.dmg[0]}d${b.dmg[1]} ${cap(b.dmg[2])}${propText ? `; ${propText}` : ""}; mastery ${cap(b.mastery)}.`;
    if (p.damage) notConverted(ctx, `${p.damage.min} - ${p.damage.max}${p.damage.school ? ` ${p.damage.school}` : ""} Damage`, "the base weapon's damage die replaces it", "base weapon");
    // The weapon's own bonus elemental damage line (every hit in the classic game).
    if (p.extraDamage && SCHOOL_MAP[p.extraDamage.school]) {
      const type = damageType(p.extraDamage.school, p.name);
      const d = WEAPON_EXTRA_DICE[ctx.tier];
      addFeature(ctx, {
        name: `${type} Edge`, sourceLine: p.extraDamage.line, source: `${p.extraDamage.line} (bonus damage on every hit)`,
        text: `When you hit a creature with an attack using this weapon, it takes an extra ${d} ${type} damage. You can deal this extra damage only once per turn.`,
        rider: { type: "extraDamage", formula: d, damageType: type.toLowerCase(), trigger: "hit", limit: "oncePerTurn" }
      });
    }
    applyLinesCommon(ctx);
    enhancement(ctx, "weapon");
    if (ctx.bonus) sys.magicalBonus = ctx.bonus;
    ctx.summary = `${b.label}${ctx.bonus ? ` +${ctx.bonus}` : ""}`;
    return { type: "weapon", system: finish(ctx, sys) };
  }

  if (shape === "chest" || shape === "shield") {
    let key = null;
    if (shape === "shield") key = "shield";
    else if (p.wowType === "Cloth" || !p.wowType) key = CLOTH_CHEST === "padded" ? "padded" : null;
    else key = matchRule(CHEST_RULES, p)?.base ?? null;
    if (p.armor) notConverted(ctx, `${p.armor} Armor`, key ? "the base armour's AC replaces it" : "the plain armour value of a cloth chest gives no AC (cloth chest rule)", key ? "base armour" : "cloth rule");
    if (p.block) notConverted(ctx, `${p.block} Block`, "shield block value has no 5e counterpart beyond the shield's +2", "base shield");
    if (!key) return clothing(ctx, sys, "Clothing (robe, no AC)", `Cloth chest → clothing with no AC; only an Equip line that raises armour or defence gives AC.`);
    const a = ARMOR_BASES[key];
    ctx.extras.armor = true;
    Object.assign(sys, {
      type: { value: a.type, baseItem: key },
      armor: { value: a.ac, dex: a.dex, magicalBonus: null },
      strength: a.strength ?? null,
      properties: a.stealth ? ["stealthDisadvantage"] : [],
      weight: { value: a.weight, units: "lb" }
    });
    ctx.basis = shape === "shield"
      ? `Shield → Shield: +2 AC.`
      : `${p.wowType} chest, item level ${p.itemLevel ?? "?"} → ${a.label}: AC ${a.ac}${a.dex === null ? " + Dex modifier" : a.dex ? ` + Dex modifier (max ${a.dex})` : ""}${a.strength ? `; Strength ${a.strength}` : ""}${a.stealth ? "; Disadvantage on Stealth" : ""}.`;
    applyLinesCommon(ctx);
    enhancement(ctx, shape === "shield" ? "shield" : "armor");
    if (ctx.bonus) sys.armor.magicalBonus = ctx.bonus;
    ctx.summary = `${a.label}${ctx.bonus ? ` +${ctx.bonus}` : ""}`;
    return { type: "equipment", system: finish(ctx, sys) };
  }

  if (shape === "wand") {
    Object.assign(sys, { type: { value: "wand", baseItem: "" }, properties: ["foc"], weight: { value: 1, units: "lb" } });
    ctx.basis = `Wand → wand usable as a Spellcasting Focus (Arcane).`;
    const school = p.damage?.school ?? null;
    const cantrip = school ? WAND_CANTRIP[school] : null;
    const line = p.damage ? `${p.damage.min} - ${p.damage.max}${school ? ` ${school}` : ""} Damage` : "Wand";
    if (cantrip) {
      addFeature(ctx, {
        name: "Wand Bolt", sourceLine: line, source: `${line} (the wand's ranged ${school} attack)`,
        text: `While holding this wand, you can cast the ${cantrip} cantrip. Use your spellcasting ability for it; if you don't have one, use Intelligence.`,
        rider: { type: "cantrip", spell: cantrip, trigger: "held" }
      });
    } else review(ctx, line, school ? `no SRD cantrip matches ${school} damage for a wand` : "the wand's damage line has no school");
    applyLinesCommon(ctx);
    ctx.magic = true;
    ctx.summary = "Wand";
    return { type: "equipment", system: finish(ctx, sys) };
  }

  if (shape === "gear") {
    const t = SLOT_EQUIPMENT[p.slot];
    if (p.armor) notConverted(ctx, `${p.armor} Armor`, "the plain armour value gives no AC outside chest armour and shields (slot rule)", "slot rule");
    if (t === "clothing") return clothing(ctx, sys, `Worn item (${p.slot.toLowerCase()}${p.wowType ? `, ${p.wowType.toLowerCase()}` : ""}, no AC)`,
      `${p.slot}${p.wowType ? ` (${p.wowType})` : ""} → worn item with no AC; only an Equip line that raises armour or defence gives AC.`);
    Object.assign(sys, { type: { value: t, baseItem: "" }, weight: { value: t === "ring" ? 0 : 1, units: "lb" } });
    if (p.slot === "Relic") sys.properties.push("foc");
    ctx.basis = `${p.slot} → ${{ ring: "ring", trinket: p.slot === "Neck" ? "amulet" : "trinket" }[t] ?? "wondrous item"}.`;
    applyLinesCommon(ctx);
    ctx.summary = { ring: "Ring", trinket: p.slot === "Neck" ? "Amulet" : p.slot === "Trinket" ? "Trinket" : "Held item" }[t] ?? "Wondrous item";
    return { type: "equipment", system: finish(ctx, sys) };
  }

  if (shape === "consumable") return consumable(ctx, sys);
  if (shape === "container") {
    ctx.summary = "Container";
    ctx.basis = "Bag → container (unchanged).";
    return { type: "container", system: null };
  }
  const lootType = p.quest ? "" : p.quality === "poor" ? "junk" : "trade";
  Object.assign(sys, { type: { value: lootType, subtype: "" }, weight: { value: 0, units: "lb" } });
  ctx.summary = p.quest ? "Quest item" : p.quality === "poor" ? "Junk" : "Trade good";
  ctx.basis = p.quest ? "Quest item → loot with no rules." : "Trade good → loot (sold for its value).";
  for (const e of p.effects) review(ctx, e.line, "loot item with an effect line; no rule");
  return { type: "loot", system: sys };
}

/** Clothing-type gear: no AC. */
function clothing(ctx, sys, label, basis) {
  Object.assign(sys, { type: { value: "clothing", baseItem: "" }, armor: { value: null }, weight: { value: 1, units: "lb" } });
  ctx.basis = basis;
  applyLinesCommon(ctx);
  ctx.summary = label;
  return { type: "equipment", system: finish(ctx, sys) };
}

function finish(ctx, sys) {
  const { tier, p } = ctx;
  if (tier >= ATTUNE_TIER) ctx.attune = true;
  if (ctx.attuneBy) ctx.attune = true;
  // Very Rare / Legendary gear that ends up with nothing beyond its base: flag it rather than invent.
  const real = ctx.features.filter(f => !/^\+\d /.test(f.name));
  if (tier >= 3 && !ctx.bonus && !real.length) review(ctx, `${QUALITY_NAME[p.quality]} quality`, `${TIER_NAME[tier]} item with no line that converts; decide whether it needs a feature`);
  if (ctx.magic || ctx.bonus) sys.properties = [...new Set([...(sys.properties ?? []), "mgc"])];
  sys.attunement = ctx.attune ? "required" : "";
  return sys;
}

function consumable(ctx, sys) {
  const { p } = ctx;
  const useFx = p.effects.find(e => e.kind === "use");
  const use = useFx?.text ?? "";
  let m;
  Object.assign(sys, { uses: { spent: 0, max: "1", autoDestroy: true, recovery: [] }, weight: { value: 0.5, units: "lb" } });
  if ((m = use.match(/^Restores (\d+) to (\d+) health/i))) {
    const f = byLevel(POTION_HEALING, p.itemLevel).formula;
    sys.type = { value: "potion", subtype: "" };
    sys.activities = { [ID("Heal")]: healActivity(f, { name: "Drink" }) };
    ctx.summary = "Potion of healing";
    ctx.basis = `Healing potion, item level ${p.itemLevel ?? "?"} → SRD potion of healing dice for that level.`;
    ctx.features.push({ name: "Healing", text: `When you drink this potion, you regain ${dice(f)} Hit Points. Drinking it, or giving it to another creature, takes a Bonus Action.`, source: `Use — restores ${m[1]}–${m[2]} health` });
  } else if ((m = use.match(/^Restores (\d+) to (\d+) mana/i))) {
    const lvl = byLevel(MANA_POTION_SLOT, p.itemLevel).level;
    sys.type = { value: "potion", subtype: "" };
    const text = `When you drink this potion, you regain one expended spell slot of level ${lvl} or lower. If you have no expended slot of those levels, the potion has no effect. Drinking it takes a Bonus Action.`;
    sys.activities = { [ID("Use")]: utilityActivity(text) };
    ctx.summary = "Mana potion";
    ctx.basis = `Mana potion, item level ${p.itemLevel ?? "?"} → regain a spell slot (mana is spell slots in 5e).`;
    ctx.features.push({ name: "Restore Magic", text, source: `Use — restores ${m[1]}–${m[2]} mana` });
  } else if (/health over/i.test(use) && /eat|seated/i.test(use)) {
    const f = byLevel(FOOD_HEALING, p.itemLevel).formula;
    sys.type = { value: "food", subtype: "" };
    sys.activities = { [ID("Heal")]: healActivity(f, { activation: "special", name: "Eat (Short Rest)" }) };
    ctx.summary = "Food";
    ctx.basis = "Food (restores health while seated) → extra healing during a Short Rest.";
    ctx.features.push({ name: "Hearty Meal", text: `If you eat this during a Short Rest, you regain an extra ${dice(f)} Hit Points when the rest ends.`, source: `Use — ${short(use, 60)}` });
  } else if (/mana over/i.test(use) && /drink|seated/i.test(use)) {
    sys.type = { value: "food", subtype: "" };
    ctx.summary = "Drink";
    ctx.basis = "Drink (restores mana while seated) → ordinary drink.";
    notConverted(ctx, useFx.line, "mana over time while seated has no 5e counterpart (spell slots come back on rests)", "no counterpart");
  } else {
    sys.type = { value: ["potion", "food", "scroll", "poison", "ammo"].includes(p.consumableType) ? p.consumableType : "wondrous", subtype: "" };
    ctx.summary = `Consumable (${sys.type.value})`;
    ctx.basis = "Consumable → no rule yet.";
    if (useFx) review(ctx, useFx.line, "no consumable rule for this effect yet; kept as flavour");
  }
  for (const e of p.effects) if (e.kind !== "use") review(ctx, e.line, "non-Use line on a consumable; no rule");
  if (TIER[p.quality] >= 1) sys.properties = ["mgc"];
  return { type: "consumable", system: sys };
}

/* -------------------------------------------- */
/*  Rules text                                  */
/* -------------------------------------------- */

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The 5e block appended under the classic tooltip. */
function rulesBlock(ctx, hand, shape) {
  const { p } = ctx;
  const rarityName = TIER_NAME[ctx.tier] ?? "Common";
  if (hand?.kept) {
    const slot = hand.slotNote ? ` Converted to a worn item with no AC (${esc(hand.slotNote)}).` : "";
    return `<section class="loot-ledger-5e"><p><strong>5e:</strong> rules above were hand-written by the source module and kept: every mechanic in them traces to the tooltip (${esc(hand.audit.support.join("; ") || "—")}).${slot}</p></section>`;
  }
  const att = ctx.attune ? `, requires attunement${ctx.attuneBy ? ` ${ctx.attuneBy}` : ""}` : "";
  const parts = [`<p><strong>5e:</strong> ${esc(ctx.summary)} — ${rarityName}${att}.</p>`];
  if (ctx.basis) parts.push(`<p><em>Based on: ${esc(ctx.basis)}</em></p>`);
  if (hand && !hand.kept) parts.push(`<p><em>The source module's hand-written rule was replaced: it names mechanics the tooltip doesn't support (${esc(hand.audit.problems.map(x => x.text).join("; "))}).</em></p>`);
  for (const f of ctx.features) parts.push(`<p><strong>${esc(f.name)}.</strong> ${esc(f.text)} <em>Source: ${esc(f.source)}${/[.…]$/.test(f.source) ? "" : "."}</em></p>`);
  if (!ctx.features.length && shape !== "loot" && shape !== "container") parts.push(`<p>No 5e rules: none of this item's lines convert (see below).</p>`);
  if (ctx.notConverted.length) parts.push(`<p class="loot-ledger-unconverted"><strong>Not converted:</strong> ${ctx.notConverted.map(r => `${esc(r.line)} (${esc(r.why)})`).join("; ")}.</p>`);
  if (ctx.review.length) parts.push(`<p class="loot-ledger-review"><strong>GM review:</strong> ${ctx.review.map(r => `<em>${esc(r.line)}</em> — ${esc(r.why)}`).join("; ")}.</p>`);
  return `<section class="loot-ledger-5e">${parts.join("")}</section>`;
}

/** Short review row for a conversion (used for sample exports). */
export function reviewRow(src, conv) {
  const p = conv.parsed;
  const stats = [
    ...Object.entries(p.stats).map(([k, v]) => `+${v} ${k.toUpperCase()}`),
    ...Object.entries(p.resist).map(([k, v]) => `+${v} ${k} res`),
    p.armor ? `${p.armor} armor` : null,
    p.block ? `${p.block} block` : null,
    p.damage ? `${p.damage.min}-${p.damage.max}${p.damage.school ? ` ${p.damage.school}` : ""} dmg @${p.speed}` : null,
    p.extraDamage ? `+${p.extraDamage.min}-${p.extraDamage.max} ${p.extraDamage.school}` : null
  ].filter(Boolean).join(", ");
  const fx = [...p.effects.map(e => `${KIND_LABEL[e.kind]}: ${e.text}`), ...(p.sets.length ? [`${p.sets.length} set bonuses`] : [])].join(" | ");
  return {
    name: src.name, quality: p.quality, itemLevel: p.itemLevel, wowType: p.wowType ?? src.type, wowSlot: p.slot ?? "",
    wowStats: stats, wowEffects: short(fx, 120),
    result: conv.result
  };
}
