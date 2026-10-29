/**
 * First-pass converter: classic MMO item -> dnd5e (2024 rules) item.
 *
 * Every rule lives in a plain table near the top of this file so it can be tuned without touching the
 * logic. Weapon and armour numbers (damage dice, properties, mastery, AC, weight) come from the System
 * Reference Document 5.2 (CC-BY-4.0). Everything else is Loot Ledger's own first-pass homebrew and is
 * expected to change once official conversion guidance exists.
 *
 * Nothing in here reads or writes Foundry documents: `convertItem()` takes plain source data and
 * returns plain item data, so it can be tested outside Foundry.
 */
import { MODULE_ID, SOURCE_MODULE, QUALITY_BY_KEY, analyse, tooltipLines, priceFor, formatCoins } from "./data.mjs";

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

/* -------------------------------------------- */
/*  Rule tables (tune these)                    */
/* -------------------------------------------- */

/**
 * Weapon type -> base weapon. First matching row wins.
 * hands: "one" (One-Hand / Main Hand / Off Hand), "two" (Two-Hand), "ranged", "thrown".
 * maxSpeed / minSpeed: classic attack speed in seconds. name: regex on the item name.
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
  { wow: "Gun",         maxSpeed: 2.49,                   base: "pistol" },
  { wow: "Gun",                                           base: "musket" },
  { wow: "Thrown",      name: /axe|tomahawk|hatchet/i,    base: "handaxe" },
  { wow: "Thrown",      name: /spear|javelin/i,           base: "javelin" },
  { wow: "Thrown",      name: /dagger|knife|blade/i,      base: "dagger" },
  { wow: "Thrown",                                        base: "dart" },
  { wow: "Fishing Pole",                                  base: "club" }
];

/**
 * Chest armour by armour class and item level. First matching row wins.
 * Cloth chests use CLOTH_CHEST instead (see below).
 */
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
 * Cloth chest handling: "clothing" (no AC, the default, so spellcasters without armour training can wear
 * robes) or "padded" (Padded Armor, light armour with stealth disadvantage).
 */
export const CLOTH_CHEST = "clothing";

/** Non-weapon, non-chest slots -> dnd5e equipment type. None of these grant AC (only chest armour does). */
export const SLOT_EQUIPMENT = {
  Head: "clothing", Shoulder: "clothing", Hands: "clothing", Wrist: "clothing", Waist: "clothing",
  Legs: "clothing", Feet: "clothing", Back: "clothing", Shirt: "clothing", Tabard: "clothing",
  Finger: "ring", Neck: "trinket", Trinket: "trinket", "Held In Off-hand": "trinket", Relic: "trinket"
};
/** Slots treated as accessories for the quality-tier table. */
export const ACCESSORY_SLOTS = new Set(["Finger", "Neck", "Trinket", "Back", "Held In Off-hand", "Relic"]);

/** Classic stat -> 5e ability. Charisma has no classic counterpart. */
export const STAT_MAP = { Strength: "str", Agility: "dex", Stamina: "con", Intellect: "int", Spirit: "wis" };
/** Skill used for the "minor perk" of each ability (null = use a saving throw instead). */
export const SKILL_FOR_ABILITY = { str: "ath", dex: "ste", con: null, int: "arc", wis: "per", cha: "per" };
export const ABILITY_LABEL = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
export const SKILL_LABEL = { ath: "Athletics", ste: "Stealth", arc: "Arcana", per: "Perception" };

/** Classic damage school -> 5e damage type. Nature becomes lightning when the text mentions lightning. */
export const SCHOOL_MAP = { Fire: "fire", Frost: "cold", Nature: "poison", Shadow: "necrotic", Arcane: "force", Holy: "radiant" };

/**
 * Quality tier for weapons, armour and shields.
 * bonus = magical +N, perk = add the "minor perk" (skill or save +1 from the top stat), attune = requires attunement.
 */
export const GEAR_TIERS = {
  poor:      { tier: 0, bonus: 0, perk: false, attune: false, magic: false },
  common:    { tier: 0, bonus: 0, perk: false, attune: false, magic: false },
  uncommon:  { tier: 1, bonus: 0, perk: true,  attune: false, magic: true },
  rare:      { tier: 2, bonus: 1, perk: false, attune: false, magic: true },
  epic:      { tier: 3, bonus: 2, perk: false, attune: true,  magic: true },
  legendary: { tier: 4, bonus: 3, perk: false, attune: true,  magic: true },
  artifact:  { tier: 4, bonus: 3, perk: false, attune: true,  magic: true }
};

/**
 * Quality tier for accessories (ring, neck, trinket, cloak, held off-hand) and non-chest armour pieces.
 * kind: "perk" (+1 to one skill, or one save for Constitution), "save" (+1 to saves of the top ability),
 * "ability" (+N to the top ability score, max 20 by the rules text), ac: extra +1 AC.
 */
export const ACCESSORY_TIERS = {
  poor:      { kind: null },
  common:    { kind: null },
  uncommon:  { kind: "perk" },
  rare:      { kind: "save" },
  epic:      { kind: "ability", amount: 1, attune: true },
  legendary: { kind: "ability", amount: 1, ac: 1, attune: true },
  artifact:  { kind: "ability", amount: 1, ac: 1, attune: true }
};

/** Elemental resistance lines: tier 2 (rare) gives advantage text only, tier 3+ gives real resistance. */
export const RESISTANCE_RULE = { adviceTier: 2, resistTier: 3 };
/** Extra +1 AC from Defense / bonus Armor lines, from this tier up. */
export const DEFENSE_RULE = { minTier: 3 };

/** On-hit elemental damage: extra dice once per turn by tier (below minTier the line is flavour only). */
export const ON_HIT_DAMAGE = { minTier: 2, dice: { 2: "1d6", 3: "2d6", 4: "3d6" } };

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
/** "Use: Restores N health" on gear: once per Long Rest heal, dice by item level. */
export const GEAR_HEALING = [
  { maxIlvl: 25, formula: [2, 4, 2] }, { maxIlvl: 45, formula: [4, 4, 4] }, { maxIlvl: Infinity, formula: [8, 4, 8] }
];

/**
 * Equip / Use / Chance-on-hit patterns. First matching row wins for each line.
 * effect: what it becomes; minTier: below this the line is kept as flavour only (still "recognised", so no
 * GM review). Lines matching no row are kept as flavour and the item is flagged for GM review.
 */
export const EFFECT_PATTERNS = [
  { id: "onhit-damage",  kinds: ["hit", "equip"], rx: /(\d+)(?: to (\d+))? (Fire|Frost|Nature|Shadow|Arcane|Holy) damage/i, effect: "onHitDamage", minTier: ON_HIT_DAMAGE.minTier, requireChance: true },
  { id: "use-heal",      kinds: ["use"],  rx: /^Restores (\d+) to (\d+) health\.?/i,                    effect: "gearHeal",   minTier: 1 },
  { id: "attack-power",  kinds: ["equip"], rx: /(Attack Power|attack power by)/i,                        effect: "weaponAttack", minTier: 3 },
  { id: "hit-chance",    kinds: ["equip"], rx: /chance to hit by \d+%/i,                                 effect: "weaponAttack", minTier: 3 },
  { id: "spell-power",   kinds: ["equip"], rx: /damage (and healing )?done by .*spells|healing done by .*spells/i, effect: "spellAttack", minTier: 3 },
  { id: "defense",       kinds: ["equip"], rx: /Increased Defense \+\d+|^\+\d+ Armor\.?$/i,              effect: "acBonus",    minTier: DEFENSE_RULE.minTier },
  { id: "crit",          kinds: ["equip"], rx: /critical strike/i,                                       effect: "flavour" },
  { id: "avoidance",     kinds: ["equip"], rx: /chance to (dodge|parry|block)|block value/i,             effect: "flavour" },
  { id: "regen",         kinds: ["equip"], rx: /(mana|health) (per|every) 5 sec/i,                       effect: "flavour" },
  { id: "all-resist",    kinds: ["equip"], rx: /All Resistances/i,                                       effect: "flavour" }
];

/* -------------------------------------------- */
/*  Parsing                                     */
/* -------------------------------------------- */

const TOOLTIP_MARK = '<div style="background:#0b0b10';
const HAND_OF = { "Two-Hand": "two", "One-Hand": "one", "Main Hand": "one", "Off Hand": "one", Ranged: "ranged", Thrown: "thrown" };

/** Extract the classic item facts from a source item (plain data or document). */
export function parseSource(src) {
  const html = src.system?.description?.value ?? "";
  const cut = html.indexOf(TOOLTIP_MARK);
  const tooltip = cut >= 0 ? html.slice(cut) : html;
  const lines = tooltipLines(tooltip).slice(1); // drop the item name
  const meta = analyse(src);
  const out = {
    ...meta, name: src.name, sourceType: src.type, wowType: null, hands: null, speed: null,
    damage: null, extraDamage: null, armor: null, block: null, stats: {}, resist: {}, effects: [], setBonuses: 0,
    classes: null, quest: false, handAuthored: !!src.flags?.[SOURCE_MODULE]?.handAuthored, consumableType: src.system?.type?.value ?? ""
  };
  const pair = tooltip.match(/<span>([^<]*)<\/span><span>([^<]*)<\/span>/);
  if (pair && HAND_OF[pair[1]] !== undefined) { out.wowType = pair[2]; out.hands = HAND_OF[pair[1]]; }
  else if (pair && /^(Head|Shoulder|Chest|Wrist|Hands|Waist|Legs|Feet|Back|Relic)$/.test(pair[1])) out.wowType = pair[2];
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, " ");
    let m;
    if (!out.wowType && /^(Cloth|Leather|Mail|Plate)$/.test(l)) out.wowType = l;
    if ((m = l.match(/^(\d+) - (\d+) (?:(\w+) )?Damage$/))) out.damage = { min: +m[1], max: +m[2], school: m[3] ?? null };
    else if ((m = l.match(/^\+ ?(\d+) - (\d+) (\w+) Damage$/))) out.extraDamage = { min: +m[1], max: +m[2], school: m[3] };
    else if ((m = l.match(/^Speed ([\d.]+)$/))) out.speed = Number(m[1]);
    else if ((m = l.match(/^(\d+) Armor$/))) out.armor = +m[1];
    else if ((m = l.match(/^(\d+) Block$/))) out.block = +m[1];
    else if ((m = l.match(/^\+(\d+) (Strength|Agility|Stamina|Intellect|Spirit)$/))) out.stats[STAT_MAP[m[2]]] = +m[1];
    else if ((m = l.match(/^\+(\d+) (Fire|Frost|Nature|Shadow|Arcane|Holy) Resistance$/))) out.resist[m[2]] = +m[1];
    else if ((m = l.match(/^(Equip|Use|Chance on hit): (.+)$/))) out.effects.push({ kind: { Equip: "equip", Use: "use", "Chance on hit": "hit" }[m[1]], text: m[2] });
    else if (/^\(\d+\) Set ?:/.test(l)) out.setBonuses++;
    else if ((m = l.match(/^Classes: (.+)$/))) out.classes = m[1];
    else if (l === "Quest Item" || l === "This Item Begins a Quest") out.quest = true;
  }
  return out;
}

/** Highest-valued stat's ability key, or null. Ties keep the order str, dex, con, int, wis. */
export function topAbility(stats) {
  let best = null;
  for (const k of ["str", "dex", "con", "int", "wis"]) if ((stats[k] ?? 0) > (stats[best] ?? 0)) best = k;
  return best;
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
/*  Conversion                                  */
/* -------------------------------------------- */

const dice = ([n, d, b]) => `${n}d${d}${b ? ` + ${b}` : ""}`;
const ID = suffix => `lootledger${suffix}`.padEnd(16, "0").slice(0, 16);

function aeChange(key, value, generation) {
  return generation >= 14 ? { key, type: "add", value: String(value) } : { key, mode: 2, value: String(value) };
}

/**
 * Convert one source item.
 * @param {object} src                 source item (plain data or Item document)
 * @param {object} [options]
 * @param {"100"|"10"} [options.ratio="100"]       coin ratio for the price
 * @param {boolean} [options.keepHandAuthored=true] keep the source module's hand-written 5e mechanics when present
 * @param {number}  [options.generation]           Foundry core generation (active-effect change format)
 * @param {string}  [options.dnd5eMajor]           dnd5e major version (rarity field shape)
 * @returns {{data: object, result: object}} item data ready for createDocuments, and a short review summary
 */
export function convertItem(src, options = {}) {
  const {
    ratio = "100", keepHandAuthored = true,
    generation = Number(globalThis.game?.release?.generation ?? 14),
    dnd5eMajor = Number(String(globalThis.game?.system?.version ?? "6").split(".")[0])
  } = options;
  const p = parseSource(src);
  const base = typeof src.toObject === "function" ? src.toObject() : structuredClone(src);
  const rarity = QUALITY_BY_KEY[p.quality]?.rarity ?? "common";
  const ctx = {
    p, generation, tier: GEAR_TIERS[p.quality]?.tier ?? 0, effects: [], notes: [], review: [], changes: [],
    bonus: 0, attune: false, magic: false, summary: "", extras: {}
  };

  const shape = classify(p);
  const auto = buildSystem(shape, ctx);
  let system = auto.system ?? foundry_clone(base.system);
  let itemType = auto.type;
  let handAuthored = false;
  if (keepHandAuthored && p.handAuthored) {
    // Keep the source module's own conversion; only re-price, re-rarity and annotate it.
    handAuthored = true;
    itemType = base.type;
    system = foundry_clone(base.system);
    ctx.handSummary = summariseExisting(base, p);
    // Still enforce the slot rule: only chest armour and shields give AC.
    if (shape === "gear" && SLOT_EQUIPMENT[p.slot] === "clothing" && ["light", "medium", "heavy"].includes(system.type?.value)) {
      system.type = { value: "clothing", baseItem: "" };
      system.armor = { ...(system.armor ?? {}), value: null, dex: null };
      ctx.handSummary = `clothing (was ${base.system.type.value} armour)` + ctx.handSummary.replace(/^[^,]*/, "");
    }
  }

  // Description: keep everything from the source, append the 5e block.
  const sourceHtml = base.system?.description?.value ?? "";
  const price = priceFor(p.vendorSellCopper, ratio);
  system.description = { value: sourceHtml + rulesBlock(ctx, handAuthored, auto), chat: "" };
  system.price = price;
  if (dnd5eMajor >= 6) { system.rarities = [rarity]; delete system.rarity; }
  else { system.rarity = rarity; delete system.rarities; }
  system.identified = true;
  system.quantity ??= 1;

  const effects = handAuthored ? (base.effects ?? []) : ctx.changes.length ? [{
    _id: ID("Fx"), name: `${src.name} (5e)`, img: src.img ?? "icons/svg/aura.svg", type: "base", transfer: true,
    disabled: false, description: "",
    ...(generation >= 14 ? { system: { changes: ctx.changes } } : { changes: ctx.changes })
  }] : [];

  const needsReview = !handAuthored && ctx.review.length > 0;
  const flags = foundry_clone(base.flags ?? {});
  flags[MODULE_ID] = {
    sourceUuid: src.uuid ?? null, quality: p.quality, itemLevel: p.itemLevel,
    ...(p.requiredLevel !== null ? { requiredLevel: p.requiredLevel } : {}),
    vendorSellCopper: p.vendorSellCopper, vendorSell: formatCoins(p.vendorSellCopper), noSell: p.noSell,
    slot: p.slot, category: p.category, band: p.band, coinRatio: ratio,
    converted: { version: 1, shape, handAuthored, needsReview, summary: handAuthored ? ctx.handSummary : ctx.summary, review: ctx.review }
  };

  const data = { _id: base._id, name: base.name, type: itemType, img: base.img, system, effects, flags, sort: 0 };
  const sys = system;
  const result = {
    type: itemType + (sys.type?.value ? `:${sys.type.value}` : ""),
    base: sys.type?.baseItem || (shape === "weapon" && ctx.extras.base) || "",
    rarity,
    bonus: handAuthored ? Number(sys.magicalBonus ?? sys.armor?.magicalBonus ?? 0) || 0 : ctx.bonus,
    attunement: (sys.attunement === "required"),
    damage: sys.damage?.base?.denomination ? `${sys.damage.base.number}d${sys.damage.base.denomination} ${sys.damage.base.types?.[0] ?? ""}`.trim() : "",
    ac: itemType === "equipment" && sys.armor?.value ? (sys.type?.value === "shield" ? `+${sys.armor.value}` : String(sys.armor.value)) : "",
    properties: (sys.properties ?? []).join(","),
    effectSummary: handAuthored ? ctx.handSummary : ctx.effects.join("; "),
    needsReview,
    price: `${price.value} ${price.denomination}`,
    ...(handAuthored ? { handAuthored: true, autoWouldBe: ctx.summary + (ctx.effects.length ? ` — ${ctx.effects.join("; ")}` : "") } : {})
  };
  return { data, result, parsed: p };
}

function foundry_clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

/** Short text for a hand-authored source item's existing mechanics. */
function summariseExisting(base, p) {
  const s = base.system ?? {};
  const label = s.type?.baseItem || s.type?.value || base.type;
  const bonus = Number(s.magicalBonus ?? s.armor?.magicalBonus ?? 0) || 0;
  const pre = (s.description?.value ?? "").split(TOOLTIP_MARK)[0];
  const feature = pre.match(/<strong>([^<]+)<\/strong>/)?.[1]?.replace(/\.$/, "");
  return [`${label}${bonus ? ` +${bonus}` : ""}`, feature ? `feature: ${feature}` : null, s.attunement === "required" ? "attunement" : null]
    .filter(Boolean).join(", ");
}

/* -------------------------------------------- */

function attackActivity(ranged) {
  return {
    _id: ID("Attack"), type: "attack", sort: 0, name: "",
    activation: { type: "action", value: 1, condition: "", override: false },
    attack: { ability: "", bonus: "", flat: false, critical: { threshold: null }, type: { value: ranged ? "ranged" : "melee", classification: "weapon" } },
    damage: { includeBase: true, parts: [], critical: { bonus: "" } }
  };
}

function healActivity(formula, { activation = "bonus", consume = true, recovery = null, name = "" } = {}) {
  const [number, denomination, bonus] = formula;
  return {
    _id: ID("Heal"), type: "heal", sort: 0, name,
    activation: { type: activation, value: 1, condition: "", override: false },
    consumption: { targets: consume ? [{ type: "itemUses", value: "1", target: "", scaling: {} }] : [], scaling: { allowed: false }, spellSlot: true },
    healing: { number, denomination, bonus: bonus ? String(bonus) : "", types: ["healing"], custom: { enabled: false }, scaling: { number: 1 } },
    range: { units: "touch", override: false },
    target: { affects: { type: "creature", count: "1", choice: false }, override: false, prompt: true },
    ...(recovery ? { uses: { spent: 0, max: "1", recovery: [{ period: recovery, type: "recoverAll" }] } } : {})
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

function commonSystem(p) {
  return {
    source: { rules: "2024", revision: 1, custom: "Loot Ledger (converted)" },
    quantity: 1, identified: true, attunement: "", properties: []
  };
}

/** Apply the stat-driven perk/save/ability bonus for a tier kind. */
function applyStatBonus(ctx, kind, amount = 1) {
  const a = topAbility(ctx.p.stats);
  if (!a) return false;
  const { generation } = ctx;
  if (kind === "perk") {
    const skill = SKILL_FOR_ABILITY[a];
    if (skill) {
      ctx.changes.push(aeChange(`system.skills.${skill}.bonuses.check`, "+1", generation));
      ctx.effects.push(`+1 ${SKILL_LABEL[skill]} checks`);
    } else {
      ctx.changes.push(aeChange(`system.abilities.${a}.bonuses.save`, "+1", generation));
      ctx.effects.push(`+1 ${ABILITY_LABEL[a]} saves`);
    }
  } else if (kind === "save") {
    ctx.changes.push(aeChange(`system.abilities.${a}.bonuses.save`, "+1", generation));
    ctx.effects.push(`+1 ${ABILITY_LABEL[a]} saves`);
  } else if (kind === "ability") {
    ctx.changes.push(aeChange(`system.abilities.${a}.value`, amount, generation));
    ctx.effects.push(`+${amount} ${ABILITY_LABEL[a]} (max 20)`);
  }
  return true;
}

function addAc(ctx, why) {
  if (ctx.extras.ac) return;
  ctx.extras.ac = true;
  ctx.changes.push(aeChange("system.attributes.ac.bonus", "+1", ctx.generation));
  ctx.effects.push(`+1 AC${why ? ` (${why})` : ""}`);
}

/** Resistances and Equip / Use / Chance-on-hit lines. */
function applyLines(ctx, { isWeapon = false } = {}) {
  const { p, tier, generation } = ctx;
  // Resistances: only the strongest one counts.
  const res = Object.entries(p.resist).sort((a, b) => b[1] - a[1])[0];
  if (res) {
    const type = SCHOOL_MAP[res[0]];
    if (tier >= RESISTANCE_RULE.resistTier) {
      ctx.changes.push(aeChange("system.traits.dr.value", type, generation));
      ctx.effects.push(`resistance to ${type} damage`);
    } else if (tier >= RESISTANCE_RULE.adviceTier) {
      ctx.effects.push(`advantage on saves against ${type} effects (not automated)`);
    }
  }
  // Extra elemental weapon damage printed on the weapon itself counts like an on-hit effect.
  if (isWeapon && p.extraDamage && SCHOOL_MAP[p.extraDamage.school]) {
    const type = p.extraDamage.school === "Nature" ? "lightning" : SCHOOL_MAP[p.extraDamage.school];
    if (tier >= ON_HIT_DAMAGE.minTier) addOnHit(ctx, type);
  }
  for (const fx of p.effects) {
    const row = EFFECT_PATTERNS.find(r => r.kinds.includes(fx.kind) && r.rx.test(fx.text)
      && (!r.requireChance || fx.kind === "hit" || /chance/i.test(fx.text)));
    if (!row) {
      ctx.review.push(`${fx.kind}: ${fx.text}`);
      continue;
    }
    const m = fx.text.match(row.rx);
    // A recognised damage line with more going on after it still needs a look.
    if (row.id === "onhit-damage" && fx.text.replace(/\(.*?\)/g, "").split(/\.\s+/).filter(x => x.trim()).length > 1) {
      ctx.review.push(`${fx.kind}: ${fx.text}`);
    }
    if (tier < (row.minTier ?? 99) && row.effect !== "flavour") continue; // flavour at this tier
    switch (row.effect) {
      case "onHitDamage": {
        if (!isWeapon) { ctx.review.push(`${fx.kind}: ${fx.text}`); break; }
        const school = m[3][0].toUpperCase() + m[3].slice(1).toLowerCase();
        const type = school === "Nature" && /lightning|storm|thunder/i.test(fx.text) ? "lightning" : SCHOOL_MAP[school];
        addOnHit(ctx, type);
        break;
      }
      case "gearHeal": {
        const f = byLevel(GEAR_HEALING, p.itemLevel).formula;
        ctx.extras.activity = healActivity(f, { activation: "action", consume: false, recovery: "lr", name: "Restore" });
        ctx.effects.push(`once per Long Rest: heal ${dice(f)} (action)`);
        break;
      }
      case "weaponAttack":
        if (ctx.extras.weaponAttack) break;
        ctx.extras.weaponAttack = true;
        ctx.changes.push(aeChange("system.bonuses.mwak.attack", "+1", generation), aeChange("system.bonuses.rwak.attack", "+1", generation));
        ctx.effects.push("+1 weapon attack rolls");
        break;
      case "spellAttack":
        if (ctx.extras.spellAttack) break;
        ctx.extras.spellAttack = true;
        ctx.changes.push(aeChange("system.bonuses.msak.attack", "+1", generation), aeChange("system.bonuses.rsak.attack", "+1", generation));
        ctx.effects.push("+1 spell attack rolls");
        break;
      case "acBonus":
        addAc(ctx, "defense");
        break;
      default: break;
    }
  }
}

function addOnHit(ctx, type) {
  if (ctx.extras.onHit) return;
  ctx.extras.onHit = true;
  const d = ON_HIT_DAMAGE.dice[Math.min(4, ctx.tier)];
  ctx.effects.push(`once per turn on a hit: +${d} ${type} damage (not automated)`);
}

/** Build the converted system data for a shape. Returns {type, system}. */
function buildSystem(shape, ctx) {
  const { p } = ctx;
  const gear = GEAR_TIERS[p.quality] ?? GEAR_TIERS.common;
  const acc = ACCESSORY_TIERS[p.quality] ?? ACCESSORY_TIERS.common;
  const sys = commonSystem(p);

  if (shape === "weapon") {
    const rule = matchRule(WEAPON_RULES, p) ?? { base: "club" };
    if (!matchRule(WEAPON_RULES, p)) ctx.review.push(`unknown weapon type ${p.wowType ?? "?"}`);
    const b = WEAPON_BASES[rule.base];
    ctx.extras.base = rule.base;
    const isRanged = b.type.endsWith("R");
    Object.assign(sys, {
      type: { value: b.type, baseItem: b.custom ? "" : rule.base },
      damage: {
        base: { number: b.dmg[0], denomination: b.dmg[1], bonus: "", types: [b.dmg[2]], custom: { enabled: false }, scaling: { number: 1 } },
        versatile: b.ver ? { number: b.ver[0], denomination: b.ver[1], bonus: "", types: [b.dmg[2]], custom: { enabled: false }, scaling: { number: 1 } } : {}
      },
      range: { value: b.range?.[0] ?? null, long: b.range?.[1] ?? null, reach: b.props.includes("rch") ? 10 : null, units: "ft" },
      properties: rule.focus ? [...b.props, "foc"] : [...b.props],
      mastery: b.mastery,
      weight: { value: b.weight, units: "lb" },
      activities: { [ID("Attack")]: attackActivity(isRanged) }
    });
    applyGearTier(ctx, gear, sys);
    if (ctx.bonus) sys.magicalBonus = ctx.bonus;
    applyLines(ctx, { isWeapon: true });
    ctx.summary = `${b.label}${ctx.bonus ? ` +${ctx.bonus}` : ""}`;
    return { type: "weapon", system: finish(ctx, sys) };
  }

  if (shape === "chest" || shape === "shield") {
    let key = null;
    if (shape === "shield") key = "shield";
    else if (p.wowType === "Cloth" || !p.wowType) key = CLOTH_CHEST === "padded" ? "padded" : null;
    else key = matchRule(CHEST_RULES, p)?.base ?? null;
    if (!key) return clothing(ctx, sys, "Clothing (robe, no AC)");
    const a = ARMOR_BASES[key];
    Object.assign(sys, {
      type: { value: a.type, baseItem: key },
      armor: { value: a.ac, dex: a.dex, magicalBonus: null },
      strength: a.strength ?? null,
      properties: a.stealth ? ["stealthDisadvantage"] : [],
      weight: { value: a.weight, units: "lb" }
    });
    applyGearTier(ctx, gear, sys);
    if (ctx.bonus) sys.armor.magicalBonus = ctx.bonus;
    applyLines(ctx);
    ctx.summary = `${a.label}${ctx.bonus ? ` +${ctx.bonus}` : ""}`;
    return { type: "equipment", system: finish(ctx, sys) };
  }

  if (shape === "wand") {
    Object.assign(sys, { type: { value: "wand", baseItem: "" }, properties: ["foc"], weight: { value: 1, units: "lb" } });
    applyAccessory(ctx, acc, sys);
    applyLines(ctx);
    ctx.summary = "Wand (arcane focus)";
    return { type: "equipment", system: finish(ctx, sys) };
  }

  if (shape === "gear") {
    const t = SLOT_EQUIPMENT[p.slot];
    if (t === "clothing") return clothing(ctx, sys, `Clothing (${p.slot.toLowerCase()}${p.wowType ? `, ${p.wowType.toLowerCase()}` : ""}, no AC)`);
    Object.assign(sys, { type: { value: t, baseItem: "" }, weight: { value: t === "ring" ? 0 : 1, units: "lb" } });
    if (p.slot === "Relic") sys.properties.push("foc");
    applyAccessory(ctx, acc, sys);
    applyLines(ctx);
    ctx.summary = { ring: "Ring", trinket: p.slot === "Neck" ? "Amulet" : p.slot === "Trinket" ? "Trinket" : "Held item" }[t] ?? "Wondrous item";
    return { type: "equipment", system: finish(ctx, sys) };
  }

  if (shape === "consumable") return consumable(ctx, sys);
  if (shape === "container") {
    ctx.summary = "Container";
    return { type: "container", system: null }; // keeps the source container data
  }
  // Loot: trade goods, junk, quest items.
  const lootType = p.quest ? "" : p.quality === "poor" ? "junk" : "trade";
  Object.assign(sys, { type: { value: lootType, subtype: "" }, weight: { value: 0, units: "lb" } });
  ctx.summary = p.quest ? "Quest item (no mechanics)" : p.quality === "poor" ? "Junk" : "Trade good";
  return { type: "loot", system: sys };
}

/** Clothing-type gear: no AC, accessory tier rules for the bonus. */
function clothing(ctx, sys, label) {
  const acc = ACCESSORY_TIERS[ctx.p.quality] ?? ACCESSORY_TIERS.common;
  Object.assign(sys, { type: { value: "clothing", baseItem: "" }, armor: { value: null }, weight: { value: 1, units: "lb" } });
  applyAccessory(ctx, acc, sys);
  applyLines(ctx);
  ctx.summary = label;
  return { type: "equipment", system: finish(ctx, sys) };
}

function applyGearTier(ctx, gear, sys) {
  ctx.bonus = gear.bonus;
  ctx.attune = gear.attune;
  ctx.magic = gear.magic;
  if (gear.perk && !applyStatBonus(ctx, "perk")) ctx.notes.push("no stats, so no minor perk");
}

function applyAccessory(ctx, acc, sys) {
  ctx.magic = !!acc.kind;
  ctx.attune = !!acc.attune;
  if (!acc.kind) return;
  // Purple+ accessories with an armour/defence profile take +1 AC instead of an ability bump.
  const defensive = ctx.p.effects.some(e => /Defense|^\+\d+ Armor/i.test(e.text));
  if (acc.kind === "ability" && defensive) addAc(ctx, "defense");
  else if (!applyStatBonus(ctx, acc.kind, acc.amount)) ctx.notes.push("no stats, so no tier bonus");
  if (acc.ac) addAc(ctx);
}

function finish(ctx, sys) {
  if (ctx.magic) sys.properties = [...new Set([...(sys.properties ?? []), "mgc"])];
  sys.attunement = ctx.attune ? "required" : "";
  if (ctx.extras.activity) sys.activities = { ...(sys.activities ?? {}), [ctx.extras.activity._id]: ctx.extras.activity };
  return sys;
}

function consumable(ctx, sys) {
  const { p } = ctx;
  const use = p.effects.find(e => e.kind === "use")?.text ?? "";
  let m;
  Object.assign(sys, { uses: { spent: 0, max: "1", autoDestroy: true, recovery: [] }, weight: { value: 0.5, units: "lb" } });
  if ((m = use.match(/^Restores (\d+) to (\d+) health/i))) {
    const f = byLevel(POTION_HEALING, p.itemLevel).formula;
    sys.type = { value: "potion", subtype: "" };
    sys.activities = { [ID("Heal")]: healActivity(f, { name: "Drink" }) };
    ctx.summary = `Healing potion: ${dice(f)}`;
    ctx.effects.push(`regain ${dice(f)} HP (Bonus Action)`);
  } else if ((m = use.match(/^Restores (\d+) to (\d+) mana/i))) {
    const lvl = byLevel(MANA_POTION_SLOT, p.itemLevel).level;
    sys.type = { value: "potion", subtype: "" };
    const text = `Regain one expended spell slot of level ${lvl} or lower.`;
    sys.activities = { [ID("Use")]: utilityActivity(text) };
    ctx.summary = `Mana potion: slot ≤ ${lvl}`;
    ctx.effects.push(text);
  } else if (/health over/i.test(use) && /eat|seated/i.test(use)) {
    const f = byLevel(FOOD_HEALING, p.itemLevel).formula;
    sys.type = { value: "food", subtype: "" };
    sys.activities = { [ID("Heal")]: healActivity(f, { activation: "special", name: "Eat (Short Rest)" }) };
    ctx.summary = `Food: +${dice(f)} HP on a Short Rest`;
    ctx.effects.push(`eaten during a Short Rest: regain an extra ${dice(f)} HP`);
  } else if (/mana over/i.test(use) && /drink|seated/i.test(use)) {
    sys.type = { value: "food", subtype: "" };
    ctx.summary = "Drink (flavour)";
  } else {
    sys.type = { value: ["potion", "food", "scroll", "poison", "ammo"].includes(p.consumableType) ? p.consumableType : "wondrous", subtype: "" };
    ctx.summary = `Consumable (${sys.type.value})`;
    if (use) ctx.review.push(`use: ${use}`);
  }
  // Other lines on a consumable (rare) are kept as flavour and flagged.
  for (const e of p.effects) if (e.kind !== "use") ctx.review.push(`${e.kind}: ${e.text}`);
  if ((QUALITY_BY_KEY[p.quality] && GEAR_TIERS[p.quality].magic)) sys.properties = ["mgc"];
  return { type: "consumable", system: sys };
}

/** The original rules block appended under the classic tooltip. */
function rulesBlock(ctx, handAuthored, auto) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (handAuthored) {
    return `<section class="loot-ledger-5e"><p><strong>5e:</strong> ${esc(ctx.handSummary)} (hand-written by the source module, kept as is).</p></section>`;
  }
  const att = ctx.attune ? "yes" : "no";
  const parts = [`<p><strong>5e:</strong> ${esc(ctx.summary)}. Requires attunement: ${att}.</p>`];
  if (ctx.effects.length) parts.push(`<ul>${ctx.effects.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`);
  if (ctx.review.length) parts.push(`<p class="loot-ledger-review"><strong>GM review:</strong> the following line has no 5e rule yet and is flavour only: ${ctx.review.map(r => `<em>${esc(r)}</em>`).join("; ")}.</p>`);
  return `<section class="loot-ledger-5e">${parts.join("")}</section>`;
}

/** Short review row for a conversion (used for sample exports). */
export function reviewRow(src, conv) {
  const p = conv.parsed;
  const stats = [
    ...Object.entries(p.stats).map(([k, v]) => `+${v} ${k.toUpperCase()}`),
    ...Object.entries(p.resist).map(([k, v]) => `+${v} ${k} res`),
    p.armor ? `${p.armor} armor` : null,
    p.damage ? `${p.damage.min}-${p.damage.max} dmg @${p.speed}` : null
  ].filter(Boolean).join(", ");
  const trim = s => (s.length > 70 ? `${s.slice(0, 67)}...` : s);
  return {
    name: src.name, quality: p.quality, itemLevel: p.itemLevel, wowType: p.wowType ?? src.type, wowSlot: p.slot ?? "",
    wowStats: stats, wowEffects: p.effects.map(e => trim(`${e.kind}: ${e.text}`)).join(" | "),
    result: conv.result
  };
}
