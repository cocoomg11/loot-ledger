/**
 * Converter: classic MMO item -> dnd5e (2024 rules) item. Second pass.
 *
 * Ground rules (every table below follows them):
 *
 *  1. Traceability. Every mechanical feature comes from one specific tooltip line of the source item: a stat
 *     line, an Equip: / Use: / Chance on hit: line, a resistance line, the weapon damage line, or the item
 *     type and slot. Quality on its own only sets the plain enhancement bonus of weapons, armour and shields,
 *     and attunement. Nothing else is ever added because of quality.
 *     Common (white) and Poor (grey) items are baseline gear (decided by the user): the base 5e item only (its
 *     weapon or armour statistics and its price). Their stat, resistance and effect lines are all listed as
 *     "Not converted" (common item, baseline gear). Consumables keep their consumable function.
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
import { suffixGroup } from "./suffix.mjs";
import { matchBase, variantStep, uncoveredRiders, MATCHER_VERSION, PROC_DAMAGE, STAT_FAMILY } from "./base-match.mjs";
import { KEYS, aeChange, effectData } from "./effects.mjs";
import { slotFacts, slotRule, mainStat, statThreshold, variantFeature, variantKeys, overBudget, lineWeight, isFree, STAT_ORDER } from "./variants.mjs";
// Every tunable number lives in rules.mjs (book-day calibration edits values there, not logic here).
import {
  WEAPON_RULES, CHEST_RULES, CLOTH_CHEST, SLOT_EQUIPMENT, TIER, GEAR_BONUS, ARMOR_BONUS, GREEN_RULE, ATTUNE_TIER, ATTUNE_RIDERS, STAT_RULE, STAT_PASSIVE, STAT_PASSIVE_NOTE, TRINKET_RULE, HIT_RULE, DEFENSE_RULE, SPELL_RULE, RESIST_RULE, SCHOOL_MAP, PROC_RULE, WEAPON_EXTRA_DICE, DAILY_USES, BLAST_USES, EXTRA_ATTACK_RULE, POTION_HEALING, MANA_POTION_SLOT, FOOD_HEALING, GEAR_HEALING, POTION_REFLAVOUR, EMPTY_REVIEW_TIER,
  BLEED_RULE, STAT_DEBUFF_RULE, WEAPON_BONUS, CRIT_RULE, PARRY_RULE, MANA_REGEN, HEALTH_REGEN, RESIST_RING, THORNS_DICE, FLAVOUR_RULE, SPELL_SURGE, LINE_BUDGET
} from "./rules.mjs";
export {
  WEAPON_RULES, CHEST_RULES, CLOTH_CHEST, SLOT_EQUIPMENT, TIER, GEAR_BONUS, ARMOR_BONUS, GREEN_RULE, ATTUNE_TIER, ATTUNE_RIDERS, STAT_RULE, STAT_PASSIVE, STAT_PASSIVE_NOTE, TRINKET_RULE, HIT_RULE, DEFENSE_RULE, SPELL_RULE, RESIST_RULE, SCHOOL_MAP, PROC_RULE, WEAPON_EXTRA_DICE, DAILY_USES, BLAST_USES, EXTRA_ATTACK_RULE, POTION_HEALING, MANA_POTION_SLOT, FOOD_HEALING, GEAR_HEALING, POTION_REFLAVOUR, EMPTY_REVIEW_TIER
};

/** Bump when the rules (rules.mjs) or the conversion logic change: it is part of every item's source hash, so
 * Build re-converts items converted under an older version. */
export const CONVERTER_VERSION = 9;

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
  scimitar:      { label: "Scimitar",       type: "martialM", dmg: [1, 6, "slashing"],     props: ["fin", "lgt"],              mastery: "nick",   weight: 3 },
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
/*  Fixed labels and rider groups               */
/* -------------------------------------------- */

const TIER_NAME = { 0: "Common", 1: "Uncommon", 2: "Rare", 3: "Very Rare", 4: "Legendary" };
const QUALITY_NAME = { poor: "Poor", common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", artifact: "Artifact" };

/** Rider types that count as an "effect" for GEAR_BONUS. */
export const EFFECT_RIDERS = new Set(["extraDamage", "burstDamage", "bleed", "debuff", "extraAttack", "heal", "attackBonus", "spellBonus", "healBonus", "resistance", "acBonus", "cantrip",
  "variant", "critDice", "parry", "slotRecovery", "concentration", "regeneration", "thorns", "ward", "flavour", "spellSurge"]);

/** Rule-family settings read by the converter (all default on; blastThreshold default PROC_RULE.burstFrom). */
export const RULE_OPTIONS = { critDice: true, flavourBonuses: true, manaRegen: true, parryReaction: true, statDebuff: true, blastThreshold: PROC_RULE.burstFrom };

/** Classic stat -> 5e ability. Charisma has no classic counterpart. */
export const STAT_MAP = { Strength: "str", Agility: "dex", Stamina: "con", Intellect: "int", Spirit: "wis" };
export const ABILITY_LABEL = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

/** Reason listed for every stat / effect line of a Common or Poor item. */
const BASELINE_WHY = "common item, baseline gear";

/** Caster gear (Intellect / Spirit / spell power): its "+hit" line becomes +1 to spell attack rolls instead. */
const isCasterGear = p => !!(p.stats.int || p.stats.wis) || p.effects.some(e => /spells and effects/i.test(e.text));

const usesText = n => n === 1
  ? "This property can't be used again until you finish a Long Rest."
  : `This property has ${n} uses. You regain all expended uses when you finish a Long Rest.`;

/**
 * Official bases: the matcher (base-match.mjs) picks them from the user's installed compendiums at build time; the
 * repo stores names only (rules.mjs section 10). The 2024 SRD is always a candidate source when installed.
 */
export const SRD_PACKS = ["dnd5e.equipment24"];

/** Wands: their damage school decides the cantrip they let you cast (SRD 5.2 cantrips). Missing school -> GM review. */
export const WAND_CANTRIP = { Fire: "Fire Bolt", Frost: "Ray of Frost", Arcane: "Eldritch Blast", Nature: "Poison Spray", Holy: "Sacred Flame", Shadow: "Chill Touch" };


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
  return rules.find(r => (!r.wow || [r.wow].flat().includes(p.wowType))
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
  if (p.hands && WEAPON_RULES.some(r => [r.wow].flat().includes(p.wowType))) return "weapon";
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
      } else if (c.id === "crit" && p.damage && /this weapon/i.test(text)) {
        // A weapon's own critical-hit rule ("when you score a critical hit with this weapon") traces to its damage line.
        ok = true;
        used.add(`${p.damage.min} - ${p.damage.max} Damage`);
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
 * @param {boolean} [options.forceReplace=false]   the item is on the replace list (replace-list.mjs): its
 *                                                  hand-written rules are replaced by Loot Ledger's conversion
 *                                                  even when they pass the audit
 * @param {boolean} [options.officialBases=true]   run the official-base matcher (base-match.mjs)
 * @param {object}  [options.bases]                base index from indexBases() (build time); without it only the
 *                                                  +N template can match
 * @param {object}  [options.baseConfidence]       {accept, suggest} thresholds (setting baseConfidence)
 * @param {boolean} [options.scoreItems=true]      allow ability-score bases (setting scoreItems)
 * @param {boolean} [options.gapFills=true]        re-based items get one extra effect for lines the base lacks
 * @returns {{data: object, result: object, parsed: object, match: object|null, basedOn: object|null}}
 *   basedOn: the compendium base to apply with applyOfficial() (accepted matches only), else null.
 */
export function convertItem(src, options = {}) {
  const {
    ratio = "100", keepHandAuthored = true, forceReplace = false, officialBases = true, bases = null,
    baseConfidence = undefined, scoreItems = true, gapFills = true, rules: ruleOpts = {}, overrides = null,
    dnd5eMajor = Number(String(globalThis.game?.system?.version ?? "6").split(".")[0])
  } = options;
  const p = parseSource(src);
  const base = typeof src.toObject === "function" ? src.toObject() : structuredClone(src);
  const rarity = QUALITY_BY_KEY[p.quality]?.rarity ?? "common";
  const shape = classify(p);
  const ctx = {
    p, shape, tier: TIER[p.quality] ?? 0, features: [], notConverted: [], review: [], riders: [], flagged: [],
    bonus: 0, attune: false, attuneBy: "", magic: false, summary: "", basis: "", extras: {},
    opts: { ...RULE_OPTIONS, ...ruleOpts },
    // Review-board overrides (flags.loot-ledger.overrides on the source or converted item): advantage swap, +1 step.
    overrides: overrides ?? src.flags?.[MODULE_ID]?.overrides ?? {}
  };

  const auto = buildSystem(shape, ctx);
  let system = auto.system ?? clone(base.system);
  let itemType = auto.type;

  // The source module's own hand-written rules: kept only when every mechanic in them traces to a line and no
  // decided rule covers the item (sourceTextWins).
  let hand = null;
  if (p.handAuthored) {
    const audit = auditHandAuthored(p);
    const decided = audit.pass ? sourceTextWins(shape, ctx) : { wins: true, ruled: [] };
    hand = { audit, kept: keepHandAuthored && audit.pass && !forceReplace && decided.wins, forced: !!forceReplace, ruled: decided.ruled };
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

  // Source always wins: a kept hand-written rule is used as is (only the +N backbone is added when it lacks one).
  if (hand?.kept && ctx.bonus && ["weapon", "chest", "shield"].includes(shape)) {
    if (itemType === "weapon" && !Number(system.magicalBonus)) system.magicalBonus = ctx.bonus;
    else if (itemType === "equipment" && system.armor && !Number(system.armor.magicalBonus) && ["light", "medium", "heavy", "shield"].includes(system.type?.value)) system.armor.magicalBonus = ctx.bonus;
  }

  // Official base (base-match.mjs): not for kept hand-written rules, baseline gear, loot or containers.
  let match = null;
  if (officialBases && !hand?.kept && ctx.tier >= 1 && !["loot", "container"].includes(shape)) {
    const armorKey = system.type?.baseItem || null;
    match = variantStep(matchBase({ p, shape, tier: ctx.tier, bonus: ctx.bonus, riders: ctx.riders, extras: ctx.extras, armorKey, variant: ctx.extras.variant ?? null,
      weaponDamageType: WEAPON_BASES[ctx.extras.base]?.dmg?.[2] ?? null, scoreItem: !!ctx.overrides.scoreItem },
      bases, { thresholds: baseConfidence, scoreItems }), { p, shape }, ctx);
  }
  if (match) match = applyBaseOverride(match, ctx, bases);
  const basedOn = match?.status === "accept" && match.base?.source === "compendium" ? match.base : null;
  raiseFlags(ctx, hand, match);

  const sourceHtml = base.system?.description?.value ?? "";
  const price = priceFor(p.vendorSellCopper, ratio);
  system.description = { value: sourceHtml + rulesBlock(ctx, hand, shape), chat: "" };
  system.price = price;
  if (dnd5eMajor >= 6) { system.rarities = [rarity]; delete system.rarity; }
  else { system.rarity = rarity; delete system.rarities; }
  system.identified = true;
  system.quantity ??= 1;

  const kept = hand?.kept;
  // Daily-recharge features carry their uses on the item itself (dnd5e system.uses, recovered on a Long Rest).
  // One system.uses per item: an effect line's uses win over the stat passive's (the other stays in text / riders).
  const dailies = kept ? [] : ctx.riders.filter(r => r.recovery === "lr" && r.uses >= 1);
  const daily = dailies[0];
  if (daily) system.uses = { spent: 0, max: String(daily.uses), recovery: [{ period: "lr", type: "recoverAll" }] };
  const needsReview = !kept && ctx.review.length > 0;
  const matched = match?.status === "accept";
  const route = ctx.tier === 0 && !kept ? "baseline" : matched ? "base"
    : (needsReview || kept || match?.status === "suggest") ? "convert-review" : "convert-auto";
  const flags = clone(base.flags ?? {});
  flags[MODULE_ID] = {
    sourceUuid: src.uuid ?? null, quality: p.quality, itemLevel: p.itemLevel,
    ...(p.requiredLevel !== null ? { requiredLevel: p.requiredLevel } : {}),
    vendorSellCopper: p.vendorSellCopper, vendorSell: formatCoins(p.vendorSellCopper), noSell: p.noSell,
    slot: p.slot, category: p.category, band: p.band, coinRatio: ratio,
    riders: kept ? [] : ctx.riders,
    // "<Random enchantment>": the item can roll a random suffix when it drops (suffix.mjs, suffix-hooks.mjs).
    ...(p.randomEnchant ? { randomSuffix: true, suffixGroup: suffixGroup(p, shape) } : {}),
    ...(match?.base ? { base: baseFlag(match) } : {}),
    // The top candidates of the match (for "pick another base" on the review board), even when none was accepted.
    ...(match?.candidates?.length ? { baseCandidates: candidateList(match) } : {}),
    ...(Object.keys(ctx.overrides).length ? { overrides: clone(ctx.overrides) } : {}),
    converted: {
      version: CONVERTER_VERSION, shape, needsReview, route,
      ...(kept ? { sourceText: true } : {}),
      ...(hand && !kept ? { sourceTextConflict: true } : {}),
      ...(match?.pattern ? { pattern: match.pattern } : {}),
      ...(match?.armorBase ? { armorBase: match.armorBase } : {}),
      handAuthored: !!p.handAuthored, handAuthoredKept: !!kept,
      ...(hand && !kept ? { handAuthoredReplaced: replacedWhy(hand).map(x => `${x.claim}: ${x.text}`) } : {}),
      ...(hand?.forced ? { replaceList: true } : {}),
      summary: ctx.summary, review: ctx.review.map(r => `${r.line} — ${r.why}`),
      notConverted: ctx.notConverted.map(r => r.line),
      // Review flags (REVIEW_FLAGS): open questions the GM should look at; they do not by themselves need review.
      ...(ctx.flagged.length ? { flags: ctx.flagged.map(f => ({ ...f })) } : {})
    }
  };

  // Active Effects: kept hand-written items keep their own; matched items get only gap-fills (applyOfficial adds
  // the base's own effects); unmatched items get one effect built from their flat riders.
  let effects;
  if (kept) effects = base.effects ?? [];
  else if (matched) {
    const gaps = gapFills ? uncoveredRiders(ctx.riders, match.base) : [];
    effects = gapFillEffects(gaps, base);
    flags[MODULE_ID].gapFills = gapFillList(gaps);
  } else effects = riderEffects(ctx.riders, base);
  const data = { _id: base._id, name: base.name, type: itemType, img: base.img, system, effects, flags, sort: 0 };

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
    route, officialBase: match?.base ? `${match.base.name} (${match.status}, ${match.base.confidence})` : "",
    needsReview,
    reviewReason: needsReview ? ctx.review.map(r => `${short(r.line, 60)}: ${r.why}`).join(" | ") : "",
    flags: ctx.flagged.map(f => f.kind).join(","),
    price: `${price.value} ${price.denomination}`,
    ...(hand ? { handAuthored: kept ? "kept (passes audit)" : `replaced: ${replacedWhy(hand).map(x => x.text).join("; ")}` } : {})
  };
  return { data, result, parsed: p, basedOn, match, sourceHtml };
}

/** Converted-item routes (flags.loot-ledger.converted.route). "handmade" items are skipped by Build. */
export const ROUTES = ["base", "convert-auto", "convert-review", "baseline", "book", "handmade"];

/** flags.loot-ledger.base for a match. */
function baseFlag(match) {
  const b = match.base;
  return {
    uuid: b.uuid ?? null, name: b.name, pack: b.pack ?? null, source: b.source, confidence: b.confidence,
    status: match.status, covered: b.covered ?? [], excess: b.excess ?? 0, plus: b.plus ?? 0,
    matcherVersion: MATCHER_VERSION,
    ...(match.pinned ? { pinned: true } : {}),
    ...(b.scoreAbility ? { scoreItem: b.scoreAbility } : {}),
    candidates: candidateList(match)
  };
}

/** The top candidates of a match: [{uuid, name, pack, confidence}]. */
function candidateList(match) {
  return (match.candidates ?? []).map(c => ({ uuid: c.uuid ?? null, name: c.name, pack: c.pack ?? null, confidence: c.confidence, ...(c.related ? { related: true } : {}) }));
}

/**
 * Review-board base override (flags.loot-ledger.overrides.base): "none" drops the base (tooltip conversion); a
 * {uuid} pins one of the indexed bases (usually one of the match's candidates) as accepted. Other items are left as
 * the matcher decided.
 */
function applyBaseOverride(match, ctx, bases) {
  const o = ctx.overrides.base;
  if (o === undefined || o === null || o === "") return match;
  if (o === "none") return { ...match, status: "none", base: null, dropped: true };
  const uuid = typeof o === "string" ? o : o.uuid;
  if (!uuid) return match;
  const entry = (bases?.entries ?? []).find(e => e.uuid === uuid) ?? null;
  if (!entry) { review(ctx, "Base override", `the chosen base (${uuid}) is not in the indexed compendiums; the matcher's choice is kept`); return match; }
  // The GM's pick stands in for the main stat when it shares that stat's family (e.g. stealth boots on Agility boots):
  // no variant gap-fill on top of it.
  const v = ctx.riders.find(r => r.type === "variant");
  const coversVariant = !!v && (STAT_FAMILY[v.ability] ?? []).some(t => entry.tags.has(t));
  const base = { uuid: entry.uuid, name: entry.name, pack: entry.pack, source: "compendium", attune: !!entry.attune, plus: 0, confidence: 1,
    covered: [...entry.tags], tags: new Set(entry.tags), excess: 0, slot: entry.slot ?? null, ...(coversVariant ? { coversVariant: true } : {}) };
  return { ...match, status: "accept", base, pinned: true };
}

/**
 * Review flags (converted.flags): open questions raised at build and shown on the review board. Each is a kind
 * from REVIEW_FLAGS with a short reason; current behaviour is kept, only the flag is raised.
 */
export const REVIEW_FLAGS = {
  zeroPrice: "no vendor price",
  sourceTextConflict: "source rules text replaced by the rules",
  nonDamageProc: "a non-damage proc became a feature with uses",
  fistStandIn: "stand-in fist weapon",
  stackableThrown: "stackable thrown weapon",
  procParts: "parts of a proc not converted",
  protection: "protection base not found",
  healthRegen: "health regeneration base not found",
  suggestedBase: "a base was suggested, not accepted"
};
function flag(ctx, kind, why = REVIEW_FLAGS[kind]) {
  if (!ctx.flagged.some(f => f.kind === kind)) ctx.flagged.push({ kind, why });
}
function raiseFlags(ctx, hand, match) {
  const { p } = ctx;
  if (!(p.vendorSellCopper > 0)) flag(ctx, "zeroPrice");
  if (hand && !hand.kept) flag(ctx, "sourceTextConflict");
  if (ctx.extras.base === "fist") flag(ctx, "fistStandIn");
  if (p.hands === "thrown") flag(ctx, "stackableThrown");
  if (match?.status === "suggest") flag(ctx, "suggestedBase", `${REVIEW_FLAGS.suggestedBase} (${match.base?.name ?? "?"}, ${match.base?.confidence ?? "?"})`);
}

/**
 * Apply an accepted official base (the full document, loaded at build time from the user's compendium): the item
 * keeps its own name, icon, tooltip, price, quality and rarity, and takes the base's type, system data and own
 * effects, plus the one gap-fill effect the conversion already built. Attunement: the base's own, or required when
 * a gap-fill needs it. The base's rules text is copied from the user's compendium at build time, never stored.
 */
export function applyOfficial(conv, official) {
  const o = typeof official.toObject === "function" ? official.toObject() : clone(official);
  const { data } = conv;
  const f = data.flags[MODULE_ID];
  const rarity = conv.result.rarity;
  const sys = clone(o.system);
  const gapFills = data.effects.filter(e => e.flags?.[MODULE_ID]?.gapFill);
  const gapAttune = (f.gapFills ?? []).some(g => ATTUNE_RIDERS.has(g.kind));
  const note = `<section class="loot-ledger-5e"><p><strong>5e:</strong> uses the rules of an official item from your installed compendium. <em>Based on: ${esc(o.name)}.</em>${gapFills.length ? ` Lines it does not cover are added as one extra effect (${esc(gapFills[0].name)}).` : ""}</p></section>`;
  sys.description = { ...(sys.description ?? {}), value: conv.sourceHtml + note + (o.system?.description?.value ?? "") };
  sys.price = data.system.price;
  sys.identified = true;
  if (Array.isArray(sys.rarities) || sys.rarities instanceof Set || data.system.rarities) { sys.rarities = [rarity]; delete sys.rarity; }
  else sys.rarity = rarity;
  if (gapAttune) sys.attunement = "required";
  if (data.system.properties?.includes?.("foc") && ["weapon", "equipment", "tool"].includes(o.type)) sys.properties = [...new Set([...(sys.properties ?? []), "foc"])];
  data.type = o.type; data.system = sys;
  data.effects = [...(o.effects ?? []).map(e => { const x = clone(e); delete x._id; return x; }), ...gapFills];
  const c = f.converted;
  c.basedOn = { name: o.name, uuid: official.uuid ?? null }; c.summary = `Based on ${o.name}`;
  f.basedOn = c.basedOn; // alias of flags.loot-ledger.base for one version
  f.base = { ...(f.base ?? {}), uuid: official.uuid ?? f.base?.uuid ?? null, name: o.name, modified: o._stats?.modifiedTime ?? null };
  Object.assign(conv.result, {
    type: o.type + (sys.type?.value ? `:${sys.type.value}` : ""), base: sys.type?.baseItem ?? "",
    rarity, bonus: Number(sys.magicalBonus ?? sys.armor?.magicalBonus ?? 0) || 0,
    attunement: sys.attunement === "required" || sys.attunement === true, damage: "", ac: "",
    properties: [...(sys.properties ?? [])].join(","),
    features: [{ text: `Based on: ${o.name}. Official rules and data copied from your compendium.`, source: "official base" },
      ...(f.gapFills ?? []).map(g => ({ text: `Gap-fill: ${g.kind}${g.ability ? ` (${g.ability})` : ""}`, source: g.from }))],
    basedOn: o.name
  });
  return conv;
}

/**
 * Book route: a book item with the same name as the source item is used as is (its mechanics and text). Only the
 * price (2x vendor sell), the quality flag and the focus tag are added; no re-base, no gap-fill.
 * @param {object} src   source item
 * @param {object} book  the book item document or data (from the bookPack setting's compendium)
 * @param {object} [o]   {ratio}
 */
export function bookItem(src, book, { ratio = "100" } = {}) {
  const p = parseSource(src);
  const b = typeof book.toObject === "function" ? book.toObject() : clone(book);
  const data = { ...b };
  delete data._stats; delete data.folder; delete data.ownership;
  data._id = src._id ?? src.id;
  data.sort = 0;
  data.system = { ...(b.system ?? {}), price: priceFor(p.vendorSellCopper, ratio) };
  const focus = isFocusLike(p) && ["weapon", "equipment", "tool"].includes(b.type);
  if (focus) data.system.properties = [...new Set([...(b.system?.properties ?? []), "foc"])];
  const flags = clone(b.flags ?? {});
  flags[MODULE_ID] = {
    sourceUuid: src.uuid ?? null, quality: p.quality, itemLevel: p.itemLevel,
    vendorSellCopper: p.vendorSellCopper, vendorSell: formatCoins(p.vendorSellCopper), noSell: p.noSell,
    slot: p.slot, category: p.category, band: p.band, coinRatio: ratio, riders: [],
    base: { uuid: book.uuid ?? null, name: b.name, pack: book.pack ?? null, source: "book", confidence: 1, status: "exact", covered: [], excess: 0, plus: 0, matcherVersion: MATCHER_VERSION },
    converted: { version: CONVERTER_VERSION, shape: classify(p), needsReview: false, route: "book", summary: `Book item ${b.name}`, review: [], notConverted: [] }
  };
  data.flags = flags;
  return data;
}

/** Staves, wands, totems, orbs and held caster items read as spellcasting foci. */
function isFocusLike(p) {
  return p.wowType === "Staff" || p.wowType === "Wand" || p.wowType === "Totem" || p.slot === "Relic"
    || (/Off-?hand/i.test(p.slot ?? "") && isCasterGear(p));
}

/**
 * Source text vs decided rules. The source module's hand-written rule wins only where Loot Ledger has not decided a
 * rule of its own:
 *   - weapons (shape "weapon"): the hand text wins (its hit / critical-hit / proc shape is kept as written; only the
 *     +N backbone is added when it lacks one);
 *   - every other item: when any of its lines became a rider under a decided line rule (stat variant, critical
 *     dice, parry, mana / health regeneration, spell power, resistances, defence, procs, ...), the rules win and
 *     the hand text is listed as replaced (review flag sourceTextConflict). Items no decided rule covers keep the
 *     hand text.
 * @returns {{wins:boolean, ruled:string[]}} ruled: the rider types that decided it
 */
export function sourceTextWins(shape, ctx) {
  if (shape === "weapon") return { wins: true, ruled: [] };
  const ruled = [...new Set((ctx.riders ?? []).map(r => r.type))];
  return { wins: ruled.length === 0, ruled };
}

/** Why a hand-written rule was replaced: the audit's problems, decided rules, and the replace list. */
function replacedWhy(hand) {
  return [...hand.audit.problems,
    ...(hand.ruled?.length && hand.audit.pass ? [{ claim: "decided-rule", text: `decided rules cover this item (${hand.ruled.join(", ")})` }] : []),
    ...(hand.forced ? [{ claim: "replace-list", text: "on the replace list" }] : [])];
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

/**
 * Flat riders become one transferred Active Effect so equipping/attuning the item changes the
 * sheet. Riders with no flat dnd5e key (per-use DC bump, Hit Dice healing, procs) stay text + uses.
 * Keys and change shape: effects.mjs (dnd5e 6.x roll fields, Foundry 14 system.changes).
 */
export function riderChanges(r) {
  if (r.type === "resistance") return [aeChange(KEYS.resistance, r.damageType)];
  // AC from riders: only the trinket "+Defense" line (+1 AC with attunement); otherwise AC comes from an official
  // base or the chest / shield curve.
  if (r.type === "acBonus") return [aeChange(KEYS.ac, `+ ${r.value}`)];
  if (r.type === "saveBonus") return [aeChange(KEYS.abilitySave(r.ability), `+ ${r.value}`)];
  if (r.type === "checkBonus") return [aeChange(KEYS.abilityCheck(r.ability), `+ ${r.value}`)];
  if (r.type === "spellBonus" && !r.damageType) return [
    ...KEYS.spellAttack.map(k => aeChange(k, `+ ${r.value}`)),
    ...(r.scope === "attackAndDC" ? [aeChange(KEYS.spellDC, r.value)] : [])];
  if (r.type === "attackBonus" && r.value) return (r.scope === "spell" ? KEYS.spellAttack : KEYS.weaponAttack).map(k => aeChange(k, `+ ${r.value}`));
  if (r.type === "concentration") return [aeChange(KEYS.concentration, `+ ${r.value}`)];
  if (r.type === "variant") {
    const k = variantKeys(r.variant);
    if (!k) return []; // grapple DC, Hit Point Dice healing: text only
    if (r.advantage && k.adv) return [aeChange(k.adv, 1)];
    if (r.variant === "hpMax") return [aeChange(k.flat, `+ ${r.formula}`)];
    if (r.variant === "spellDC") return [aeChange(k.flat, r.value)];
    return [aeChange(k.flat, `+ ${r.value}`)];
  }
  return [];
}
/** Unmatched items: one transferred effect "<item> (Loot Ledger)" from their flat riders (Foundry 14 system.changes). */
function riderEffects(riders, base, extra = {}) {
  const fx = effectData({ name: `${base.name} (Loot Ledger)`, img: base.img ?? "icons/svg/aura.svg", changes: riders.flatMap(riderChanges),
    flags: { [MODULE_ID]: { converted: true, ...extra } } });
  return fx ? [fx] : [];
}
/** Re-based items: the single gap-fill effect (flags.loot-ledger.gapFill) for the lines the base does not cover. */
function gapFillEffects(riders, base) { return riderEffects(riders, base, { gapFill: true }); }
/** flags.loot-ledger.gapFills: one entry per uncovered rider. */
function gapFillList(riders) {
  return riders.map(r => ({ kind: r.type, ability: r.ability ?? null, detail: gapDetail(r), from: r.source ?? null, ae: riderChanges(r).length > 0 }));
}
/** The part of a rider that changes its mechanics (beyond kind and tier): variant / damage type / skill, trigger, ability. */
function gapDetail(r) {
  return [r.variant ?? r.damageType ?? r.skill ?? null, r.trigger && r.type !== "variant" ? r.trigger : null, r.ability && r.type !== "variant" ? r.ability : null]
    .filter(Boolean).join("/") || null;
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
  const effect = ctx.features.find(f => f.rider && EFFECT_RIDERS.has(f.rider.type) && !isFree(f.rider.type));
  const table = kind === "armor" ? ARMOR_BONUS : GEAR_BONUS;
  const row = kind === "weapon" ? { plain: WEAPON_BONUS[tier] ?? 0, withEffect: WEAPON_BONUS[tier] ?? 0 } : table[tier] ?? table[0];
  ctx.bonus = effect ? row.withEffect : row.plain;
  // Endgame raise: a review-board override (+1 step on the +N of a weapon, chest armour or shield), never by name.
  // Capped at +3. Items with no +N are not raised.
  const raised = !!(ctx.bonus && ctx.overrides.raise);
  if (raised) ctx.bonus = Math.min(3, ctx.bonus + 1);
  if (!ctx.bonus) return;
  const why = raised ? "; endgame raise (review override)" : row.plain !== row.withEffect ? " with no effect line" : "";
  const text = kind === "weapon"
    ? `You have a +${ctx.bonus} bonus to attack rolls and damage rolls made with this magic weapon.`
    : kind === "shield"
      ? `While holding this shield, you have a +${ctx.bonus} bonus to Armor Class, on top of the shield's normal +2.`
      : `While wearing this armor, you have a +${ctx.bonus} bonus to Armor Class.`;
  ctx.features.unshift({ name: `+${ctx.bonus} ${kind === "weapon" ? "Weapon" : kind === "shield" ? "Shield" : "Armor"}`, text, source: `${QUALITY_NAME[p.quality]} quality${why}` });
  ctx.magic = true;
}

/** Benefit riders that count toward the line budget (the +N enhancement has no rider and never counts). */
function benefitFeatures(ctx) { return ctx.features.filter(f => f.rider && EFFECT_RIDERS.has(f.rider.type)); }

/**
 * The stat variant (variants.mjs): the main stat becomes exactly one variant, by slot. Sub-threshold main stats only
 * when the item would otherwise be blank. A caster weapon that already has a spell line turns an Intelligence
 * spell-DC variant into Concentration (no double DC). Runs after the lines; the budget then decides what stays.
 */
function applyVariant(ctx) {
  const { p, tier } = ctx;
  const facts = slotFacts(p, ctx.shape);
  const main = mainStat(p, facts, tier);
  if (!main) return;
  const rest = STAT_ORDER.filter(k => p.stats[k] && k !== main.ability);
  const blank = !benefitFeatures(ctx).length && !ctx.bonus && !ctx.extras.weapon && ctx.shape !== "wand";
  if (main.sub && !blank) {
    for (const k of STAT_ORDER.filter(x => p.stats[x])) notConverted(ctx, p.statLines[k], `main stat below the conversion threshold (${statThreshold(p.itemLevel)} at item level ${p.itemLevel ?? "?"})`, "below threshold");
    return;
  }
  let variant = slotRule(main.ability, facts, tier)?.variant;
  if (!variant) return;
  if (variant === "spellDC" && ctx.extras.weapon && ctx.extras.spell) variant = "concentration";
  ctx.extras.variant = variant;
  const f = variantFeature(variant, main.ability, tier, { hold: `While ${verb(ctx)} this ${itemNoun(ctx)}`, advantage: !!ctx.overrides.advantage });
  addFeature(ctx, { ...f, sourceLine: main.line, source: `${main.line} (the item's main stat; stat variant${main.sub ? ", below the threshold but the item would otherwise be blank" : ""})` });
  for (const k of rest) notConverted(ctx, p.statLines[k], "only the item's main stat becomes a 5e rule", "secondary stat");
}

/**
 * Line budget (LINE_BUDGET): green 1, blue 2, purple / orange 3 benefits beyond the +N, the variant counting as one;
 * the weakest lines beyond it are listed as not converted. Then the variant's attunement: the spell-DC variant needs
 * attunement, except on green / blue items whose only benefit is the variant (those never require attunement).
 */
function applyBudget(ctx) {
  const { tier } = ctx;
  const feats = benefitFeatures(ctx);
  const benefits = feats.map((f, i) => ({ key: i, weight: lineWeight(f.rider), variant: f.rider.type === "variant", free: isFree(f.rider.type) }));
  for (const i of overBudget(benefits, tier, { weapon: !!ctx.extras.weapon })) dropFeature(ctx, feats[i], `over the line budget for its rarity (${LINE_BUDGET[tier]} benefit${LINE_BUDGET[tier] === 1 ? "" : "s"}); the weakest line is dropped`, "over budget");
  const left = benefitFeatures(ctx).filter(f => !isFree(f.rider.type));
  const v = left.find(f => f.rider.type === "variant");
  if (!v) { ctx.extras.variant = null; return; }
  const onlyVariant = left.length === 1 && !ctx.extras.weapon && ctx.shape !== "shield";
  if (v.rider.attune && !(onlyVariant && tier <= 2)) ctx.attune = true;
}

/** Common and Poor items are baseline gear: every stat, resistance and effect line is listed as not converted. */
function applyBaseline(ctx) {
  const { p } = ctx;
  const lines = [
    ...STAT_ORDER.filter(k => p.stats[k]).map(k => p.statLines[k]),
    ...Object.entries(p.resist).map(([k, v]) => k === "All" ? `+${v} All Resistances` : `+${v} ${k} Resistance`),
    ...p.effects.map(e => e.line)
  ];
  for (const l of lines) notConverted(ctx, l, BASELINE_WHY, BASELINE_WHY);
}
/** Remove a feature (and its rider) that lost out under GREEN_RULE, listing its line as not converted. */
function dropFeature(ctx, f, why, shortWhy) {
  ctx.features = ctx.features.filter(x => x !== f);
  if (f.rider) ctx.riders = ctx.riders.filter(r => !(r.type === f.rider.type && r.source === (f.sourceLine ?? f.source)));
  notConverted(ctx, f.sourceLine ?? f.source, why, shortWhy);
}

/**
 * Resistance lines. Full Resistance at purple+ and full size (RESIST_RULE). Identity test (RESIST_RING): a blue+
 * ring / amulet / cloak whose resistance line is its largest number gets Resistance to that school (the resistance
 * ring pattern). One school per item (biggest, first listed on ties); orange items keep two full-size lines. 3+ small
 * schools on a ring or cloak: the protection base (VARIANT_BASES; the matcher picks it). Never a second source of the
 * same Resistance.
 */
function applyResistances(ctx) {
  const { p, tier } = ctx;
  const entries = Object.entries(p.resist);
  const lineOf = (school, v) => school === "All" ? `+${v} All Resistances` : `+${v} ${school} Resistance`;
  const min = Math.max(RESIST_RULE.minValue, Math.ceil((p.itemLevel ?? 1) * RESIST_RULE.perItemLevel));
  const schools = entries.filter(([k]) => k !== "All");
  const P = RESIST_RING.protection;
  if (schools.length >= P.minSchools && P.slots.includes(p.slot) && tier >= 1 && schools.every(([, v]) => v < min)) {
    ctx.extras.protection = true;
    for (const [k, v] of entries) notConverted(ctx, lineOf(k, v), "several small resistances: covered by the protection base (or GM review)", "protection");
    return;
  }
  const largest = Math.max(0, ...Object.values(p.stats), ...entries.map(([, v]) => v));
  const ring = tier >= RESIST_RING.minTier && RESIST_RING.slots.includes(p.slot);
  const eligible = schools.filter(([, v]) => (v >= min && tier >= RESIST_RULE.minTier) || (ring && v >= largest))
    .sort((a, b) => b[1] - a[1]);
  const full = eligible.filter(([, v]) => v >= min);
  const keep = tier >= 4 && full.length >= 2 ? full.slice(0, RESIST_RING.maxSchools[4]) : eligible.slice(0, 1);
  const given = new Set();
  for (const [school, value] of entries) {
    const line = lineOf(school, value);
    if (school === "All") { notConverted(ctx, line, "a small bonus to every resistance has no proportionate 5e rule", "small"); continue; }
    const type = SCHOOL_MAP[school];
    if (keep.some(([k]) => k === school) && !given.has(type)) {
      given.add(type);
      const identity = value < min || tier < RESIST_RULE.minTier;
      addFeature(ctx, {
        name: `${type} Resistance`, sourceLine: line,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you have Resistance to ${type} damage.`,
        source: identity ? `${line} (the item's largest line: resistance ring pattern)` : line,
        rider: { type: "resistance", damageType: type.toLowerCase(), value: 1, trigger: "equipped" }
      });
    } else if (value >= min && tier < RESIST_RULE.minTier) notConverted(ctx, line, "5e Resistance is a Very Rare-level benefit (a Resistance is worth one rarity step)", "below Very Rare");
    else if (keep.length) notConverted(ctx, line, "one Resistance per item (the biggest school)", "one school");
    else notConverted(ctx, line, `too small for 5e Resistance (needs +${min} at item level ${p.itemLevel ?? "?"})`, `below ${min}`);
  }
}

/** The weapon's own damage type ("Slashing"), for untyped procs. */
function weaponDamageType(ctx) {
  const t = WEAPON_BASES[ctx.extras.base]?.dmg?.[2];
  return t ? cap(t) : "Bludgeoning";
}

/** Bleed dice per turn: the band's dice x BLEED_RULE.share, rounded to whole dice, at least BLEED_RULE.minDice. */
export function bleedDice(bandDice) {
  const [n, d] = String(bandDice).split("d").map(Number);
  const k = Math.round(n * BLEED_RULE.share);
  const [mn, md] = BLEED_RULE.minDice.split("d").map(Number);
  return k < 1 || k * (d + 1) < mn * (md + 1) ? BLEED_RULE.minDice : `${k}d${d}`;
}

/** The Bane-shaped debuff sentence and rider data (STAT_DEBUFF_RULE). */
const debuffText = () => `The target also subtracts ${STAT_DEBUFF_RULE.die} from its attack rolls and saving throws until the end of your next turn.`;
const debuffData = () => ({ die: STAT_DEBUFF_RULE.die, rolls: ["attack", "save"], until: STAT_DEBUFF_RULE.until });
const DEBUFF_REVIEW = "lowering all stats: a Bane-shaped debuff (decided rule STAT_DEBUFF_RULE; check the size against the source)";

/**
 * A damage proc on a weapon (school null: untyped damage, dealt as the weapon's own damage type). The ratio picks the
 * band (critical / on-hit / blast); `o.bleed` turns the band into a bleed (BLEED_RULE), `o.debuff` adds the
 * stat-lowering debuff, `o.overText` is the source's over-time text (kept as a review line for bleeds), `o.tail` a
 * folded over-time tail (named in the source note).
 */
function procFeature(ctx, school, lo, hi, line, kindLabel, o = {}) {
  const { p, tier } = ctx;
  const type = school ? damageType(school, line) : weaponDamageType(ctx);
  const ratio = ((lo + (hi ?? lo)) / 2) / Math.max(1, avg(p.damage ?? { min: 1, max: 1 }));
  const band = ratio < PROC_RULE.critBelow ? "crit" : ratio < (ctx.opts.blastThreshold ?? PROC_RULE.burstFrom) ? "hit" : "blast";
  const amount = `${lo}${hi ? `–${hi}` : ""}`;
  const src = `${kindLabel} — ${amount} ${school ?? "untyped (the weapon's type)"} damage${o.bleed ? " over time" : ""}${o.tail ? ` (including a ${o.tail}-damage over-time tail)` : ""} (${ratio.toFixed(1)}× a normal hit)`;
  const debuff = o.debuff ? ` ${debuffText()}` : "";
  const extra = o.debuff ? { debuff: debuffData() } : {};
  if (o.debuff) review(ctx, line, DEBUFF_REVIEW);
  if (o.bleed) {
    const bandDice = { crit: PROC_RULE.critDice, hit: PROC_RULE.onHitDice, blast: PROC_RULE.burstDice }[band][tier];
    const d = bleedDice(bandDice), uses = BLAST_USES[tier], dc = BLEED_RULE.dc[p.quality] ?? BLEED_RULE.dc.common;
    if (band === "blast") ctx.attune = true; // as the blast it replaces
    review(ctx, line, `damage over time (${o.overText}): converted as a bleed (decided rule BLEED_RULE, ${band} band, ${bandDice} -> ${d} per turn); not automated yet`);
    addFeature(ctx, {
      name: `${type} Wound`, sourceLine: line, source: src,
      text: `When you hit a creature with an attack using this weapon, you can inflict a lingering wound: at the start of each of its turns, for up to ${BLEED_RULE.minutes} minute, the target takes ${d} ${type} damage. At the end of each of its turns, it makes a DC ${dc} Constitution saving throw, ending the wound on a success. A new wound from this weapon restarts the duration instead of stacking.${debuff} ${usesText(uses)}`,
      rider: { type: "bleed", band, formula: d, bandFormula: bandDice, damageType: type.toLowerCase(), trigger: "hit", uses, recovery: "lr",
        save: { ability: BLEED_RULE.save, dc, timing: "endOfTurn", ends: true }, damageTiming: "startOfTurn", duration: { minutes: BLEED_RULE.minutes },
        stacking: "refresh", overTime: o.overText, ...extra }
    });
    return;
  }
  if (band === "crit") {
    const d = PROC_RULE.critDice[tier];
    addFeature(ctx, {
      name: `${type} Strike`, sourceLine: line, source: src,
      text: `When you score a Critical Hit with this weapon, the target takes an extra ${d} ${type} damage. This extra damage isn't doubled by the Critical Hit.${debuff}`,
      rider: { type: "extraDamage", formula: d, damageType: type.toLowerCase(), trigger: "critical", ...extra }
    });
  } else if (band === "hit") {
    const d = PROC_RULE.onHitDice[tier];
    addFeature(ctx, {
      name: `${type} Strike`, sourceLine: line, source: src,
      text: `When you hit a creature with an attack using this weapon, it takes an extra ${d} ${type} damage. You can deal this extra damage only once per turn.${debuff}`,
      rider: { type: "extraDamage", formula: d, damageType: type.toLowerCase(), trigger: "hit", limit: "oncePerTurn", ...extra }
    });
  } else {
    const d = PROC_RULE.burstDice[tier];
    addFeature(ctx, {
      name: `${type} Blast`, sourceLine: line, source: src,
      text: `When you hit a creature with an attack using this weapon, you can release a blast: the target takes an extra ${d} ${type} damage.${debuff} ${usesText(BLAST_USES[tier])}`,
      rider: { type: "burstDamage", formula: d, damageType: type.toLowerCase(), trigger: "hit", uses: BLAST_USES[tier], recovery: "lr", ...extra }
    });
  }
}

/** Over-time damage: "N (to M) [School] damage over T sec" (or "bleed for N damage"), and a trailing "and an additional N damage over T sec". */
const OVER_TIME = /(\d+)(?: to (\d+))? (?:(Fire|Frost|Nature|Shadow|Arcane|Holy) )?damage over (\d+) (?:sec|min)/i;
const OVER_TAIL = /,?\s*(?:and|with) an additional (\d+) damage over (\d+) (?:sec|min)\.?/i;
/** A stat-lowering clause (with its "of target", "by N" and "for T" parts), for removal from the proc text. */
const LOWER_ALL = /,?\s*(?:and\s+)?lower(?:s|ing)? all (?:stats|attributes)(?: of (?:the )?target)? by \d+(?: for \d+ (?:sec|min)\.?)?/i;
/** Non-damage parts of a damage proc that are not converted (flag procParts). */
const OTHER_PART = /\b(slow(?:s|ing)?|stun(?:s|ning)?|snares?|roots?|reduc(?:es|ing)|increas(?:es|ing)|decreas(?:es|ing)|lowers? (?!all)\w+)\b/i;
/** A proc that hits several targets (converted as one target; flagged). */
const MANY_TARGETS = /\b(all (?:nearby )?enemies|nearby enemies|up to \d+ targets|affects \d+ targets|within an? \d+ yard|jumping to)\b/i;

/** Review line for a green / blue health-regen line (removed again by base-match variantStep when a base is found). */
export const HEALTH_REGEN_REVIEW = "health regeneration at this rarity uses an official base (wound-closure item); none was found in your compendiums";

/** Equip / Use / Chance-on-hit lines (gear and weapons; consumables have their own handler). */
function applyEffects(ctx) {
  const { p, tier } = ctx;
  const o = ctx.opts;
  const isWeapon = !!ctx.extras.weapon;
  for (const fx of p.effects) {
    const t = fx.text, line = fx.line, label = KIND_LABEL[fx.kind];
    let m;
    const absorbed = NOT_CONVERTED.find(r => r.rx.test(t));
    // Damage procs: "Chance on hit: ... N (to M) School damage" or "Equip: Chance to strike ... for N to M School damage".
    // Untyped damage ("Wounds the target for N to M damage") takes the weapon's own damage type.
    const dmg = t.match(PROC_DAMAGE);
    const isProc = fx.kind === "hit" || (fx.kind === "equip" && /\bchance\b/i.test(t));
    const lowers = isProc && STAT_DEBUFF_RULE.clause.test(t) && o.statDebuff !== false;
    // A healing proc ("Heals wielder of N damage over T sec") is not damage: GM review.
    if (dmg && isProc && /\bheals?\b/i.test(t)) { review(ctx, line, "a healing proc is not damage; write this one by hand"); continue; }
    if (dmg && isProc) {
      if (!isWeapon) { review(ctx, line, "damage proc on an item that is not a weapon; no weapon to attach it to"); continue; }
      // Over-time tail ("... and an additional 9 damage over 6 sec") and stat-lowering clause are parts of the damage
      // line, not extra effects: take them out before checking for other clauses.
      const tail = t.match(OVER_TAIL);
      let rest = tail ? t.replace(OVER_TAIL, "") : t;
      if (lowers) rest = rest.replace(LOWER_ALL, "");
      const extra = rest.replace(/\(.*?\)/g, "").split(/\.\s+/).filter(x => x.trim()).length > 1;
      // "... damage and <does something else>": the damage converts, the rest is flagged (procParts). An untyped
      // proc with such a clause is mostly its other effect: it stays a review line.
      const core = rest.match(PROC_DAMAGE) ?? dmg;
      const clause = /damage\b[^.]*\band\s+\w+/i.test(rest);
      if (extra || (clause && !core[3])) { review(ctx, line, "the proc does more than deal damage (extra targets or effects); write this one by hand"); flag(ctx, "procParts"); continue; }
      if (clause || (STAT_DEBUFF_RULE.clause.test(t) && !lowers)) flag(ctx, "procParts");
      // Other parts the conversion leaves out (slows, stuns, armour or speed changes): flagged, never silently dropped.
      if (OTHER_PART.test(rest)) flag(ctx, "procParts");
      if (MANY_TARGETS.test(rest)) flag(ctx, "procParts", `${REVIEW_FLAGS.procParts} (hits several targets; converted as one)`);
      const over = !tail && rest.match(OVER_TIME);
      const school = core[3] ? cap(core[3].toLowerCase()) : null;
      let lo = +core[1], hi = core[2] ? +core[2] : null, bleed = !!over, overText = over ? over[0] : null, folded = null;
      if (tail) {
        const add = +tail[1], inst = (lo + (hi ?? lo)) / 2;
        overText = tail[0].replace(/^,?\s*(?:and|with) /i, "");
        bleed = add / (inst + add) >= BLEED_RULE.mixedFrom;
        // A big tail makes the proc a bleed (the total picks the band); a small tail is part of the instant damage
        // line: it is named in the source note and the band stays as the instant damage gives it.
        if (bleed) { lo += add; if (hi) hi += add; } else folded = add;
      }
      procFeature(ctx, school, lo, hi, line, label, { bleed, overText, debuff: lowers, tail: folded });
      continue;
    }
    // "Lowers all attributes of target by N": the Bane-shaped debuff on a hit, with uses (STAT_DEBUFF_RULE).
    if (lowers && isWeapon && !/\d+ (?:\w+ )?damage/i.test(t.replace(LOWER_ALL, ""))) {
      const uses = DAILY_USES[tier];
      flag(ctx, "nonDamageProc");
      review(ctx, line, DEBUFF_REVIEW);
      addFeature(ctx, {
        name: "Weakening Strike", sourceLine: line, source: `${label} — ${short(t, 60)}; ${uses}/Long Rest by quality`,
        text: `When you hit a creature with an attack using this weapon, you can weaken it: until the end of your next turn, it subtracts ${STAT_DEBUFF_RULE.die} from its attack rolls and saving throws. ${usesText(uses)}`,
        rider: { type: "debuff", ...debuffData(), trigger: "hit", uses, recovery: "lr" }
      });
      continue;
    }
    if ((m = t.match(/(\d+|an?) extra attacks?/i)) && isProc) {
      const n = Math.min(EXTRA_ATTACK_RULE.max[tier], /^\d+$/.test(m[1]) ? +m[1] : 1);
      const melee = /melee/i.test(t) || (isWeapon && !ctx.extras.ranged);
      const weaponText = isWeapon ? "this weapon" : melee ? "a melee weapon" : "a weapon";
      const uses = EXTRA_ATTACK_RULE.uses[tier];
      const often = usesText(uses);
      flag(ctx, "nonDamageProc");
      addFeature(ctx, {
        name: "Flurry", sourceLine: line, source: `${label} — ${short(t, 60)}; ${uses}/Long Rest by quality`,
        text: `When you hit a creature with ${weaponText} as part of the Attack action, you can immediately make ${n === 1 ? "one additional attack" : `${n} additional attacks`} with that weapon as part of the same action. ${often}`,
        rider: { type: "extraAttack", value: n, trigger: melee ? "meleeHit" : "hit", uses, recovery: "lr" }
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
    // Flavour / profession lines: a small situational bonus, free (not counted in the line budget).
    if (fx.kind === "equip" && (m = t.match(/\b(Mining|Fishing|Herbalism|Skinning|Lockpicking|Engineering|Enchanting|Alchemy|Blacksmithing|Leatherworking|Tailoring|Cooking|First Aid)\b[^\d]*\+?(\d+)?/i))) {
      if (!o.flavourBonuses) { notConverted(ctx, line, "flavour / profession bonuses are turned off (setting)", "setting off"); continue; }
      const prof = Object.keys(FLAVOUR_RULE.map).find(k => k.toLowerCase() === m[1].toLowerCase());
      const n = Number(m[2] ?? 0) >= FLAVOUR_RULE.bigFrom ? FLAVOUR_RULE.big : FLAVOUR_RULE.small;
      addFeature(ctx, { name: `${prof} Knack`, sourceLine: line, source: `Equip — ${short(t, 60)} (flavour line, free)`,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you have a +${n} bonus to ${FLAVOUR_RULE.map[prof]}, when it fits the situation.`,
        rider: { type: "flavour", skill: prof, value: n, trigger: "situational" } });
      continue;
    }
    // "+N% critical strike" (and with spells): extra dice on a Critical Hit, not doubled.
    if (fx.kind === "equip" && /critical strike/i.test(t)) {
      if (!o.critDice) { notConverted(ctx, line, "critical-strike dice are turned off (setting)", "setting off"); continue; }
      if (ctx.extras.crit) { notConverted(ctx, line, "only one critical-hit rider per item", "duplicate"); continue; }
      ctx.extras.crit = true;
      const d = CRIT_RULE.dice[tier], spell = /spell/i.test(t);
      addFeature(ctx, { name: spell ? "Spell Crit" : "Keen Edge", sourceLine: line, source: `Equip — ${short(t, 60)}`,
        text: spell ? `While ${verb(ctx)} this ${itemNoun(ctx)}, when you score a Critical Hit with a spell attack, the target takes an extra ${d} damage of the spell's type. This extra damage isn't doubled.`
          : `While ${verb(ctx)} this ${itemNoun(ctx)}, when you score a Critical Hit with ${isWeapon ? "this weapon" : "a weapon attack"}, the target takes an extra ${d} damage of the weapon's type. This extra damage isn't doubled.`,
        rider: { type: "critDice", formula: d, scope: spell ? "spell" : "weapon", trigger: "critical" } });
      continue;
    }
    // "+N% dodge / parry": a Reaction.
    if (fx.kind === "equip" && /chance to (dodge|parry)/i.test(t)) {
      if (!o.parryReaction) { notConverted(ctx, line, "the parry reaction is turned off (setting)", "setting off"); continue; }
      if (ctx.extras.parry) { notConverted(ctx, line, "only one parry reaction per item", "duplicate"); continue; }
      ctx.extras.parry = true;
      const ac = PARRY_RULE.ac[tier];
      addFeature(ctx, { name: "Parry", sourceLine: line, source: `Equip — ${short(t, 60)}`,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, when a creature you can see hits you with an attack roll, you can take a Reaction to gain a ${ac === "@prof" ? "bonus equal to your Proficiency Bonus" : `+${ac} bonus`} to AC against that attack, possibly turning the hit into a miss. Once used, this property can't be used again until you finish a Short or Long Rest.`,
        rider: { type: "parry", value: ac, trigger: "reaction", uses: PARRY_RULE.uses, recovery: PARRY_RULE.recovery } });
      continue;
    }
    // "Restores N mana per 5 sec.": slot recovery or Concentration, by slot.
    if (fx.kind === "equip" && /mana (per|every) 5 sec/i.test(t)) {
      if (!o.manaRegen) { notConverted(ctx, line, "mana regeneration rules are turned off (setting)", "setting off"); continue; }
      if (MANA_REGEN.slotRecoverySlots.includes(p.slot) || ["Staff", "Wand"].includes(p.wowType)) {
        const lvl = MANA_REGEN.slotLevel[tier];
        addFeature(ctx, { name: "Wellspring", sourceLine: line, source: `Equip — ${short(t, 60)} (slot recovery)`,
          text: `While ${verb(ctx)} this ${itemNoun(ctx)}, when you finish a Short Rest you can regain one expended spell slot of level ${lvl} or lower. Once used, this property can't be used again until you finish a Long Rest.`,
          rider: { type: "slotRecovery", level: lvl, trigger: "shortRest", uses: 1, recovery: "lr" } });
      } else {
        const n = MANA_REGEN.concentration[tier];
        addFeature(ctx, { name: "Steady Focus", sourceLine: line, source: `Equip — ${short(t, 60)} (Concentration)`,
          text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you have a +${n} bonus to Constitution saving throws you make to maintain Concentration.`,
          rider: { type: "concentration", value: n, trigger: "equipped" } });
      }
      continue;
    }
    // "Restores N health per 5 sec.": purple / orange regeneration pattern; green / blue route to a base (else review).
    if (fx.kind === "equip" && /health (per|every) 5 sec/i.test(t)) {
      if (tier >= HEALTH_REGEN.patternFrom) {
        addFeature(ctx, { name: "Regeneration", sourceLine: line, source: `Equip — ${short(t, 60)} (regeneration pattern)`,
          text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you regain ${HEALTH_REGEN.dice} Hit Points every ${HEALTH_REGEN.minutes} minutes, provided that you have at least 1 Hit Point.`,
          rider: { type: "regeneration", formula: HEALTH_REGEN.dice, minutes: HEALTH_REGEN.minutes, trigger: "equipped" } });
      } else { review(ctx, line, HEALTH_REGEN_REVIEW); flag(ctx, "healthRegen"); }
      continue;
    }
    // "When struck" / "Protects" lines that damage the attacker: a passive rider, no uses.
    if (fx.kind === "equip" && /when struck|when hit|attackers?|protects/i.test(t) && (m = t.match(/(\d+) (Fire|Frost|Nature|Shadow|Arcane|Holy) damage/i))) {
      const type = damageType(cap(m[2].toLowerCase()), t), d = THORNS_DICE[tier];
      addFeature(ctx, { name: `${type} Ward`, sourceLine: line, source: `Equip — ${short(t, 60)} (passive)`,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, a creature that hits you with a melee attack takes ${d} ${type} damage.`,
        rider: { type: "thorns", formula: d, damageType: type.toLowerCase(), trigger: "struck" } });
      continue;
    }
    if (fx.kind === "equip" && /^Protects\b|when struck/i.test(t)) {
      addFeature(ctx, { name: "Ward", sourceLine: line, source: `Equip — ${short(t, 60)} (passive)`,
        text: `While ${verb(ctx)} this ${itemNoun(ctx)}, you have Advantage on saving throws against the effect this line names (${short(t.replace(/\.$/, ""), 60)}).`,
        rider: { type: "ward", trigger: "equipped" } });
      continue;
    }
    // "Use: Increases damage and healing done by spells by up to N for X sec.": a limited-use surge.
    if (fx.kind === "use" && /spells and effects by up to \d+/i.test(t)) {
      const b = SPELL_RULE.bonus[tier], d = WEAPON_EXTRA_DICE[tier], uses = DAILY_USES[tier];
      ctx.attuneBy ||= "by a spellcaster";
      addFeature(ctx, { name: "Spell Surge", sourceLine: line, source: `Use — ${short(t, 60)}`,
        text: `As a Bonus Action, you can awaken this ${itemNoun(ctx)} for ${SPELL_SURGE.minutes} minute. For the duration, you have a +${b} bonus to spell attack rolls and to the saving throw DCs of your spells, and once on each of your turns one spell you cast deals an extra ${d} damage to one target. ${usesText(uses)}`,
        rider: { type: "spellSurge", value: b, formula: d, trigger: "bonusAction", uses, recovery: "lr" } });
      continue;
    }
    if (fx.kind === "equip" && (m = t.match(/chance to hit by (\d+)%/i)) && !/spell/i.test(t)) {
      if (isWeapon) { notConverted(ctx, line, "the weapon's enhancement bonus already covers accuracy", "covered by weapon bonus"); continue; }
      if (tier < HIT_RULE.minTier) { notConverted(ctx, line, "a few % hit chance converts only on Very Rare and Legendary items (with attunement)", "below Very Rare"); continue; }
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
      if (!DEFENSE_RULE.slots.includes(p.slot)) { notConverted(ctx, line, "AC comes only from an official base or chest armour and shields (only trinkets turn a defence line into +1 AC)", "slot rule"); continue; }
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
  if (ctx.tier === 0) applyBaseline(ctx);
  else {
    applyResistances(ctx);
    applyEffects(ctx);
    applyVariant(ctx);
    applyBudget(ctx);
  }
  const { p } = ctx;
  for (const s of p.sets) notConverted(ctx, s, "set bonuses are not converted yet, as there are no set rules", "set bonus");
  // "<Random enchantment>" is flavour (nothing to roll or convert), so it is not a "not converted" line.
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
    if (p.extraDamage && ctx.tier === 0) notConverted(ctx, p.extraDamage.line, BASELINE_WHY, BASELINE_WHY);
    else if (p.extraDamage && SCHOOL_MAP[p.extraDamage.school]) {
      const type = damageType(p.extraDamage.school, p.name);
      const d = WEAPON_EXTRA_DICE[ctx.tier];
      addFeature(ctx, {
        name: `${type} Edge`, sourceLine: p.extraDamage.line, source: `${p.extraDamage.line} (bonus damage on every hit)`,
        text: `When you hit a creature with an attack using this weapon, it takes an extra ${d} ${type} damage. You can deal this extra damage only once per turn.`,
        rider: { type: "extraDamage", formula: d, damageType: type.toLowerCase(), trigger: "hit", limit: "oncePerTurn" }
      });
    }
    applyLinesCommon(ctx);
    // Held caster weapons (scepters, caster maces) with a spell line are spellcasting foci too.
    if (ctx.extras.spell && !props.includes("foc")) props.push("foc");
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
    if (ctx.tier === 0) notConverted(ctx, line, BASELINE_WHY, BASELINE_WHY);
    else if (cantrip) {
      addFeature(ctx, {
        name: "Wand Bolt", sourceLine: line, source: `${line} (the wand's ranged ${school} attack)`,
        text: `While holding this wand, you can cast the ${cantrip} cantrip. Use your spellcasting ability for it; if you don't have one, use Intelligence.`,
        rider: { type: "cantrip", spell: cantrip, trigger: "held" }
      });
    } else review(ctx, line, school ? `no SRD cantrip matches ${school} damage for a wand` : "the wand's damage line has no school");
    applyLinesCommon(ctx);
    if (ctx.tier > 0) ctx.magic = true;
    ctx.summary = "Wand";
    return { type: "equipment", system: finish(ctx, sys) };
  }

  if (shape === "gear") {
    const t = SLOT_EQUIPMENT[p.slot];
    if (p.armor) notConverted(ctx, `${p.armor} Armor`, "the plain armour value gives no AC outside chest armour and shields (slot rule)", "slot rule");
    if (t === "clothing") return clothing(ctx, sys, `Worn item (${p.slot.toLowerCase()}${p.wowType ? `, ${p.wowType.toLowerCase()}` : ""}, no AC)`,
      `${p.slot}${p.wowType ? ` (${p.wowType})` : ""} → worn item with no AC; only an Equip line that raises armour or defence gives AC.`);
    Object.assign(sys, { type: { value: t, baseItem: "" }, weight: { value: t === "ring" ? 0 : 1, units: "lb" } });
    if (p.slot === "Relic" || (/Off-?hand/i.test(p.slot ?? "") && isCasterGear(p))) sys.properties.push("foc"); // caster off-hand orbs and tomes are spellcasting foci
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
  if (tier >= EMPTY_REVIEW_TIER && !ctx.bonus && !real.length && !ctx.extras.protection) review(ctx, `${QUALITY_NAME[p.quality]} quality`, `${TIER_NAME[tier]} item with no line that converts; decide whether it needs a feature`);
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
  const rarityName = TIER_NAME[ctx.tier] ?? "Common";
  if (hand?.kept) {
    const slot = hand.slotNote ? ` Converted to a worn item with no AC (${esc(hand.slotNote)}).` : "";
    return `<section class="loot-ledger-5e"><p><strong>5e:</strong> rules above were hand-written by the source module and kept: every mechanic in them traces to the tooltip (${esc(hand.audit.support.join("; ") || "—")}).${slot}</p></section>`;
  }
  const att = ctx.attune ? `, requires attunement${ctx.attuneBy ? ` ${ctx.attuneBy}` : ""}` : "";
  const parts = [`<p><strong>5e:</strong> ${esc(ctx.summary)} — ${rarityName}${att}.</p>`];
  if (ctx.basis) parts.push(`<p><em>Based on: ${esc(ctx.basis)}</em></p>`);
  if (hand && !hand.kept) parts.push(hand.audit.problems.length
    ? `<p><em>The source module's hand-written rule was replaced: it names mechanics the tooltip doesn't support (${esc(replacedWhy(hand).map(x => x.text).join("; "))}).</em></p>`
    : `<p><em>The source module's hand-written rule was replaced: it is on Loot Ledger's replace list (reviewed by hand and found not traceable to the tooltip).</em></p>`);
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
