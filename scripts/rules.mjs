/**
 * Loot Ledger: CALIBRATION RULES. Every tunable number the build and the 5e converter use lives here.
 *
 * Book-day tuning is editing VALUES in this file, not logic elsewhere. Nothing in here touches Foundry, so
 * `node --test` checks these tables (tests/rules.test.mjs pins the current values: when you change a value on
 * purpose, update the matching expectation there too, so every change is deliberate and visible in the diff).
 *
 * Conventions:
 *   - "tier" is the power tier derived from item quality (TIER): 0 Common/Poor, 1 Uncommon (green),
 *     2 Rare (blue), 3 Very Rare (purple), 4 Legendary (orange). Tables keyed { 0: …, 1: …, 2: …, 3: …, 4: … }
 *     are per-tier values.
 *   - Tables of { maxIlvl, … } rows pick the first row whose maxIlvl >= the item level.
 *   - Dice are strings ("2d6") or [number, faces, flat bonus] triples.
 *   - Weapon / armour statistics themselves (WEAPON_BASES, ARMOR_BASES) are SRD 5.2 reference data and stay in
 *     convert.mjs; what is tuned here is which base an item maps to and how big its bonuses are.
 *   - Bump CONVERTER_VERSION (convert.mjs) when you change a value, so Build re-converts items converted with the
 *     old rules (it is part of every item's source hash, see scripts/ledger.mjs).
 *
 * Sections:
 *   0. Level bands and table shape                         (build: which band an item lands in, creature tables)
 *   1. Quality -> rarity, drop weights, price rule         (build: every item, converted or not)
 *   2. Item shape tables                                   (which base weapon / armour an item becomes)
 *   3. Power tables                                        (+N curves, attunement, green rule)
 *   4. Stat passives and trinkets                          (provisional WoW-style passives)
 *   5. Line rules                                          (hit, defence, spell power, resistance, procs)
 *   6. Limited uses                                        (Flurry, Blast, other per-Long-Rest features)
 *   7. Consumables                                         (potions, food, gear healing)
 *   8. Review thresholds                                   (when an item is sent to GM review)
 */

/* -------------------------------------------- */
/*  0. Level bands and table shape              */
/* -------------------------------------------- */

/**
 * Item-level bands and the D&D character levels they roughly correspond to (1–20 game). Items without an item
 * level fall back to their required level. min / max: item level range; charMin / charMax: the character
 * levels bandForLevel() maps to the band; levels: the label shown on tables.
 */
export const LEVEL_BANDS = [
  { band: 1, min: 1,  max: 10,       levels: "L1–3",   charMin: 1,  charMax: 2 },
  { band: 2, min: 11, max: 20,       levels: "L3–5",   charMin: 3,  charMax: 4 },
  { band: 3, min: 21, max: 30,       levels: "L5–7",   charMin: 5,  charMax: 6 },
  { band: 4, min: 31, max: 40,       levels: "L7–9",   charMin: 7,  charMax: 8 },
  { band: 5, min: 41, max: 50,       levels: "L9–11",  charMin: 9,  charMax: 10 },
  { band: 6, min: 51, max: 60,       levels: "L11–14", charMin: 11, charMax: 14 },
  { band: 7, min: 61, max: Infinity, levels: "L15+",   charMin: 15, charMax: 20 }
];

/**
 * Creature tables: junk from the creature's own band +/- bandSpread; when fewer than minItems match there, junk
 * from every band is used instead.
 */
export const CREATURE_TABLE = { bandSpread: 1, minItems: 3 };

/* -------------------------------------------- */
/*  1. Quality -> rarity, drop weights, prices  */
/* -------------------------------------------- */

/** Item quality -> dnd5e rarity (every built item, converted or plain copy). */
export const RARITY_BY_QUALITY = {
  poor: "common", common: "common", uncommon: "uncommon", rare: "rare", epic: "veryRare", legendary: "legendary", artifact: "artifact"
};

/**
 * Mixed "Drop" table weights per quality (relative). 120 / 50 / 24 / 5 / 1 = 60% / 25% / 12% / 2.5% / 0.5%.
 * 0 = never in the mixed drop (legendary / artifact get their own table).
 */
export const DROP_WEIGHT = { poor: 120, common: 50, uncommon: 24, rare: 5, epic: 1, legendary: 0, artifact: 0 };

/**
 * Price rule. dnd5e characters sell at half the listed price, so listed = sellMultiplier x classic vendor sell
 * price (2 => selling at half gives exactly the classic sell price). Standard 5e (10:1) coinage converts by value
 * (1 classic gold = 1 gp, 1 classic silver = 1 cp) and rounds to the nearest cp, never below tenToOneMinCp.
 */
export const PRICE_RULE = { sellMultiplier: 2, tenToOneMinCp: 1 };

/* -------------------------------------------- */
/*  2. Item shape tables                        */
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

/* -------------------------------------------- */
/*  3. Power tables                             */
/* -------------------------------------------- */


/** Quality -> power tier used by every table below (0 = no magic from quality). */
export const TIER = { poor: 0, common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, artifact: 4 };

/**
 * Plain enhancement bonus for weapons and shields (decided by the user; ARMOR_BONUS for chest armour):
 *   Common / Poor      none (baseline gear).
 *   Uncommon (green)   +1 OR one effect (see GREEN_RULE below for which one).
 *   Rare (blue)        +1 AND its effects (its effects use the Rare row of each table, bigger than green's).
 *   Epic (purple)      +2 and its effects.
 *   Legendary (orange) +3 and its effects.
 * "Effect" means a feature from one of the item's own Equip / Use / Chance-on-hit / resistance / bonus-damage
 * lines, or the main-stat passive (STAT_PASSIVE; on trinkets the check / save bonus) (see EFFECT_RIDERS).
 * Effects are never invented to fill a tier: an item with no convertible line just gets its plain bonus.
 * Ability SCORE increases are never given by the converter (only check / save bonuses); an official item used as
 * a reflavour (REFLAVOUR) that raises a score keeps its own rules.
 */
export const GEAR_BONUS = {
  0: { plain: 0, withEffect: 0 }, 1: { plain: 1, withEffect: 0 }, 2: { plain: 1, withEffect: 1 },
  3: { plain: 2, withEffect: 2 }, 4: { plain: 3, withEffect: 3 }
};
/**
 * Chest armour (leather / mail / plate) follows the official armour curve (decided by the user): +1 Armor is
 * Rare, +2 Very Rare, +3 Legendary. So green chest armour gets NO +1: its one benefit is its stat passive or a
 * traceable effect line, and with neither it is just the base armour. Blue +1, purple +2, orange +3, always
 * alongside their effects. Shields use GEAR_BONUS (the official +1 / +2 / +3 shield is Uncommon / Rare / Very Rare).
 */
export const ARMOR_BONUS = {
  0: { plain: 0, withEffect: 0 }, 1: { plain: 0, withEffect: 0 }, 2: { plain: 1, withEffect: 1 },
  3: { plain: 2, withEffect: 2 }, 4: { plain: 3, withEffect: 3 }
};

/**
 * Uncommon (green) items get ONE benefit (decided by the user: "+1 OR an effect"; the stat passive is an effect).
 *   Weapons and shields: a convertible effect line (proc, bonus damage, resistance, ...) replaces the +1.
 *     Otherwise the +1 enhancement is the default and the main-stat passive is listed as not converted, EXCEPT when
 *     the stat is clearly the better fit, which then replaces the +1:
 *       - a caster weapon (a Staff, or any weapon whose lines are about spells) whose main stat is Intellect or
 *         Spirit, or
 *       - the stat is the item's whole identity: its name carries the stat suffix (e.g. "of the Owl", "of Strength").
 *   Chest armour (no green +1, see ARMOR_BONUS) and accessories (rings, amulets, cloaks, trinkets, clothing slots,
 *     cloth robes, wands): the main-stat passive is the one effect; when the item also has a convertible effect
 *     line, that line wins and the stat is not converted (same as the trinket rule).
 * Rare and up are unchanged: bonus plus every effect, the stat passive included.
 */
export const GREEN_RULE = {
  casterStats: new Set(["int", "wis"]),
  /** Classic stat suffixes -> the stats they grant. */
  identitySuffix: {
    Strength: ["str"], Agility: ["dex"], Stamina: ["con"], Intellect: ["int"], Spirit: ["wis"],
    "the Bear": ["str", "con"], "the Owl": ["int", "wis"], "the Monkey": ["dex", "con"], "the Eagle": ["con", "int"],
    "the Tiger": ["str", "dex"], "the Gorilla": ["str", "int"], "the Boar": ["str", "wis"], "the Falcon": ["dex", "int"],
    "the Wolf": ["dex", "wis"], "the Whale": ["con", "wis"]
  }
};

/** Quality tier from which every item requires attunement (Very Rare and Legendary). */
export const ATTUNE_TIER = 3;
/** Rider types that require attunement on their own, as their SRD counterparts do. */
export const ATTUNE_RIDERS = new Set(["resistance", "attackBonus", "spellBonus", "healBonus", "extraAttack", "burstDamage", "acBonus"]);

/* -------------------------------------------- */
/*  4. Stat passives and trinkets               */
/* -------------------------------------------- */

/**
 * Primary stat lines (decided by the user: "WoW-style passive", option C). Only the item's highest primary stat
 * counts, and only when it is a real part of the item: at least max(minValue, item level / perItemLevel). It
 * gives ONE passive in the spirit of what that stat does in the classic game, sized by quality. On a green item
 * the passive is the item's one benefit (GREEN_RULE); from blue up it comes on top of the enhancement bonus.
 * The other stat lines are listed as "Not converted". Never an ability SCORE increase.
 * All of these are provisional (rider flag `provisional: true`, rules text "WoW stat passive (provisional)"),
 * to be revised against the official book.
 *
 *               Uncommon (green)       Rare (blue)            Very Rare (purple)     Legendary (orange)
 *   Strength    carry x2               carry x2 + Adv. Athl.  carry x2 + Adv. Athl.  carry x2 + Adv. Athl.
 *   Agility     +1 Initiative          +1 Initiative          +2 Initiative          +3 Initiative
 *   Stamina     +1 max HP / 2 levels   +1 max HP / 2 levels   +1 max HP / level      +1 max HP / level
 *   Intellect   +1 spell save DC, 1/LR +1 DC, 2/LR            +2 DC, 1/LR            +2 DC, 2/LR
 *   Spirit      +1 HP per Hit Die      +1 HP per Hit Die      +2 HP per Hit Die      +PB HP per Hit Die
 *
 * Curve notes: Strength's "Advantage on checks to shove or grapple" became Advantage on Strength (Athletics)
 * checks, because in the 2024 rules Grapple and Shove are saving throws made by the target, not your check. The
 * proposed +1 damage on Strength weapon attacks at purple / orange is left out: it would stack with the weapon's
 * own +2 / +3 and no official item of that rarity adds flat weapon damage from a worn item. Stamina sits below
 * the Tough feat (+2 per level) and an Amulet of Health. Spirit sits below a Periapt of Wound Closure (doubles
 * Hit Point Dice healing) until Legendary. Agility sits next to a Weapon of Warning (Advantage on Initiative).
 * Intellect's DC raise uses the item's limited uses (Long Rest).
 */
export const STAT_RULE = { minTier: 1, minValue: 4, perItemLevel: 7 };
export const STAT_PASSIVE = {
  str: { name: "Might", carryMultiplier: 2, athleticsFrom: 2 },
  dex: { name: "Quickness", initiative: { 1: 1, 2: 1, 3: 2, 4: 3 } },
  con: { name: "Vigor", hpPerLevel: { 1: 0.5, 2: 0.5, 3: 1, 4: 1 } },
  int: { name: "Arcane Acuity", dc: { 1: 1, 2: 1, 3: 2, 4: 2 }, uses: { 1: 1, 2: 2, 3: 1, 4: 2 } },
  wis: { name: "Renewal", perDie: { 1: "1", 2: "1", 3: "2", 4: "@prof" } }
};
export const STAT_PASSIVE_NOTE = "WoW stat passive (provisional)";

/**
 * Trinket slot only (decided by the user). The trinket's main stat (highest primary stat, no size threshold)
 * gives +1 / +2 / +2 / +2 (Uncommon / Rare / Epic / Legendary) to ability checks OR saving throws with the
 * matching ability. Capped at +2 from the official-item survey: no official 2024 item gives more than +2 to checks
 * or saves (the largest is +2 to all saves at Very Rare), and none gives a flat bonus tied to a single ability:
 *   saving throws when the trinket reads as defensive: its main stat is Stamina, or it has a resistance line,
 *   or an Equip line about armour, defence, dodge, parry or block;
 *   ability checks otherwise (offensive or utility trinkets).
 * Trinkets with convertible effect lines use the normal effect rules; at Uncommon the effect replaces the
 * stat bonus (+1 OR an effect), from Rare up they get both. No stat and no convertible line -> GM review.
 */
export const TRINKET_RULE = { minTier: 1, bonus: { 1: 1, 2: 2, 3: 2, 4: 2 }, defensive: /Armor|Defense|dodge|parry|block/i };

/* -------------------------------------------- */
/*  5. Line rules                               */
/* -------------------------------------------- */

/** "Improves your chance to hit by N%" on a non-weapon item (Uncommon or better): +1 to weapon attack rolls,
 * or +1 to spell attack rolls on caster gear. */
export const HIT_RULE = { minTier: 1, bonus: 1 };

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
 *   ratio >= burstFrom               -> a big blast with BLAST_USES uses, regained on a Long Rest.
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

/* -------------------------------------------- */
/*  6. Limited uses (Flurry, Blast, ...)        */
/* -------------------------------------------- */

/**
 * Limited-use features (Flurry, Blast and any other per-rest feature) recharge daily, as official items do:
 * all expended uses return when the wielder finishes a Long Rest (dnd5e system.uses, recovery period "lr").
 * Uses per Long Rest by quality:  common 1 | uncommon (green) 2 | rare (blue) 3 | epic (purple) 4 | legendary (orange) 6.
 * "Once per turn" limits are separate and unchanged.
 */
export const DAILY_USES = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 6 };
/** Big chance-on-hit blasts (PROC_RULE burst) are capped lower (decided by the user): 1 / 1 / 2 / 3 per Long Rest
 * (green / blue / purple / orange), so even a Legendary blast is at most 3 a day. Flurry keeps DAILY_USES. */
export const BLAST_USES = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 3 };

/** "Extra attack" procs: extra attacks per use (capped by tier); uses per Long Rest from DAILY_USES. */
export const EXTRA_ATTACK_RULE = { max: { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2 }, uses: DAILY_USES };

/* -------------------------------------------- */
/*  7. Consumables                              */
/* -------------------------------------------- */

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
/**
 * Healing potions reflavoured as an official Potion of Healing tier by item level (name only; the data is read
 * from the user's own compendium or the SRD at build time).
 */
export const POTION_REFLAVOUR = [
  { maxIlvl: 25, name: "Potion of Healing" }, { maxIlvl: 35, name: "Potion of Greater Healing" },
  { maxIlvl: 45, name: "Potion of Superior Healing" }, { maxIlvl: Infinity, name: "Potion of Supreme Healing" }
];
/** "Use: Restores N health" on gear: once per Long Rest, dice by item level. */
export const GEAR_HEALING = [
  { maxIlvl: 25, formula: [2, 4, 2] }, { maxIlvl: 45, formula: [4, 4, 4] }, { maxIlvl: Infinity, formula: [8, 4, 8] }
];

/* -------------------------------------------- */
/*  8. Review thresholds                        */
/* -------------------------------------------- */

/** Items of this tier or higher (Very Rare and up) that end up with no feature beyond their base item and no
 * enhancement bonus are flagged for GM review rather than given something invented. */
export const EMPTY_REVIEW_TIER = 3;
