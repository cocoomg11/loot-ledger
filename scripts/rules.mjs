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
 *   9. Random suffix enchantments                          (rolled on drop)
 *  10. Official bases                                      (matching a converted item to an official base item)
 *  11. Stat variants and line budget                       (one variant per main stat, by slot; lines per tier)
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
  // Seven bands re-split so item levels line up with the official character-level bands 1-4, 5-10, 11-16 and 17-20:
  // item level 1-28 suits levels 1-4, 29-46 suits 5-10, 47-65 suits 11-16 and 66+ suits 17-20.
  { band: 1, min: 1,  max: 14,       levels: "L1–2",   charMin: 1,  charMax: 2 },
  { band: 2, min: 15, max: 28,       levels: "L3–4",   charMin: 3,  charMax: 4 },
  { band: 3, min: 29, max: 37,       levels: "L5–7",   charMin: 5,  charMax: 7 },
  { band: 4, min: 38, max: 46,       levels: "L8–10",  charMin: 8,  charMax: 10 },
  { band: 5, min: 47, max: 56,       levels: "L11–13", charMin: 11, charMax: 13 },
  { band: 6, min: 57, max: 65,       levels: "L14–16", charMin: 14, charMax: 16 },
  { band: 7, min: 66, max: Infinity, levels: "L17–20", charMin: 17, charMax: 20 }
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
  // Name rules come before speed rules: curved one-handed blades are scimitars whatever their speed.
  { wow: ["Sword", "Axe", "Dagger"], hands: "one", name: /machete|cutlass|scimitar/i, base: "scimitar" },
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
 * Ability SCORE increases are never given by the converter's own rules (only check / save bonuses); an official
 * base item that raises a score (section 10, OFFICIAL_BASES.scoreItems) keeps its own rules.
 */
export const GEAR_BONUS = {
  0: { plain: 0, withEffect: 0 }, 1: { plain: 1, withEffect: 0 }, 2: { plain: 1, withEffect: 1 },
  3: { plain: 2, withEffect: 2 }, 4: { plain: 3, withEffect: 3 }
};
/**
 * Chest armour (leather / mail / plate) follows the official armour curve (decided by the user): +1 Armor is
 * Rare, +2 Very Rare, +3 Legendary. So green chest armour gets NO +1: its one benefit is its stat passive or a
 * traceable effect line, and with neither it is just the base armour. Plain chest armour: blue +1, purple +2,
 * orange +3; chest armour with features of its own: blue +0, purple +1, orange +2 (withEffect). Shields use GEAR_BONUS (the official +1 / +2 / +3 shield is Uncommon / Rare / Very Rare).
 */
/**
 * Weapons (reading A, decided by the user): the official +1 / +2 / +3 weapon backbone at every tier from green up
 * (green +1, blue +1, purple +2, orange +3). The +1 always wins on weapons: a green weapon keeps its +1 AND gets its
 * one effect (GEAR_BONUS.withEffect no longer applies to weapons; shields still use GEAR_BONUS).
 */
export const WEAPON_BONUS = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 3 };
export const ARMOR_BONUS = {
  // Armour that has features of its own carries a smaller bonus than plain armour: Rare +0, Very Rare +1, Legendary +2.
  // Plain armour (no feature lines) is unchanged: Rare +1, Very Rare +2, Legendary +3.
  0: { plain: 0, withEffect: 0 }, 1: { plain: 0, withEffect: 0 }, 2: { plain: 1, withEffect: 0 },
  3: { plain: 2, withEffect: 1 }, 4: { plain: 3, withEffect: 2 }
};

/**
 * Since the stat-variant rework (section 11) the converter no longer reads GREEN_RULE: green non-weapons keep their
 * variant as their one benefit (LINE_BUDGET) and green weapons always keep their +1 (WEAPON_BONUS). The suffix list
 * is kept for the open question on identity-only items.
 *
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

/** Quality tier from which every item requires attunement (Legendary only); below it, attunement comes from
 * ATTUNE_RIDERS, a caster restriction, or an official base's own attunement. */
export const ATTUNE_TIER = 4;
/** Rider types that require attunement on their own, as their SRD counterparts do. */
export const ATTUNE_RIDERS = new Set(["resistance", "attackBonus", "spellBonus", "healBonus", "extraAttack", "burstDamage", "acBonus",
  "spellSurge", "slotRecovery", "regeneration", "woundClosure"]);

/* -------------------------------------------- */
/*  4. Stat passives and trinkets               */
/* -------------------------------------------- */

/**
 * STAT_RULE: the main-stat threshold, max(minValue, item level / perItemLevel). The converter turns the main stat
 * into a stat VARIANT (section 11). STAT_PASSIVE below is the older "WoW-style passive" table; since the variant
 * rework only the random suffixes (section 9) read it.
 *
 * Primary stat lines (decided by the user: "WoW-style passive", option C). Only the item's highest primary stat
 * counts, and only when it is a real part of the item: at least max(minValue, item level / perItemLevel). It
 * gives ONE passive in the spirit of what that stat does in the classic game, sized by quality.
 * The other stat lines are listed as "Not converted". Never an ability SCORE increase.
 * All of these are provisional (rider flag `provisional: true`, rules text "WoW stat passive (provisional)"),
 * to be revised against the official book.
 *
 *               Uncommon (green)       Rare (blue)            Very Rare (purple)     Legendary (orange)
 *   Strength    carry x2               carry x2 + Adv. Athl.  carry x2 + Adv. Athl.  carry x2 + Adv. Athl.
 *   Agility     +2 Initiative          +2 Initiative          +3 Initiative          +4 Initiative
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
  dex: { name: "Quickness", initiative: { 1: 2, 2: 2, 3: 3, 4: 4 } },
  con: { name: "Vigor", hpPerLevel: { 1: 0.5, 2: 0.5, 3: 1, 4: 1 } },
  int: { name: "Arcane Acuity", dc: { 1: 1, 2: 1, 3: 2, 4: 2 }, uses: { 1: 1, 2: 2, 3: 1, 4: 2 } },
  wis: { name: "Renewal", perDie: { 1: "1", 2: "1", 3: "2", 4: "@prof" } }
};
export const STAT_PASSIVE_NOTE = "WoW stat passive (provisional)";

/** Trinket main stat: +1 / +2 / +2 / +2 to checks or saves with that ability (saves when defensive). Kept for the
 * converter until the variant step replaces it. */
export const TRINKET_RULE = { minTier: 1, bonus: { 1: 1, 2: 2, 3: 2, 4: 2 }, defensive: /Armor|Defense|dodge|parry|block/i };


/* -------------------------------------------- */
/*  5. Line rules                               */
/* -------------------------------------------- */

/** "Improves your chance to hit by N%" on a non-weapon item: +1 to weapon attack rolls (or spell attack rolls on
 * caster gear), only from Very Rare (purple) up and with attunement; below that it is not converted. */
export const HIT_RULE = { minTier: 3, bonus: 1 };

/**
 * "Equip: Increased Defense +N" or "Equip: +N Armor." on a TRINKET (slots): +1 AC, applied by the item's own Active
 * Effect (or its gap-fill effect when re-based), and it requires attunement. Elsewhere AC comes only from an
 * official base or the chest / shield curve, so the line is not converted (no AC gap-fill). The item's plain armour
 * value never counts (decided by the user).
 */
export const DEFENSE_RULE = { minTier: 1, ac: 1, slots: ["Trinket"] };

/**
 * "Increases damage (and healing) done by spells by up to N": a spellcasting bonus, like the SRD's +1 / +2 /
 * +3 spellcasting items, when N >= max(minValue, item level / perItemLevel). School-specific lines only
 * affect spell attack rolls of spells of that damage type. Healing-only lines add a small die to healing
 * spells. All of these require attunement by a spellcaster.
 */
export const SPELL_RULE = { minValue: 4, perItemLevel: 6, bonus: { 0: 1, 1: 1, 2: 1, 3: 2, 4: 3 }, healDie: { 0: "1d4", 1: "1d4", 2: "1d4", 3: "1d6", 4: "1d8" } };

/**
 * "+N <School> Resistance": full 5e Resistance only when the line is large for the item level
 * (N >= max(minValue, item level x perItemLevel)) and the item is at least minTier (Very Rare: a Resistance is
 * worth about one rarity step); other lines are listed as "Not converted".
 */
export const RESIST_RULE = { minValue: 15, perItemLevel: 0.3, minTier: 3 };

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
  // burstFrom is the default of the blastThreshold setting.
  critBelow: 1, burstFrom: 2,
  critDice:  { 0: "1d6", 1: "1d6", 2: "2d6", 3: "3d6", 4: "4d6" },
  onHitDice: { 0: "1d4", 1: "1d4", 2: "1d6", 3: "2d6", 4: "3d6" },
  burstDice: { 0: "2d6", 1: "3d6", 2: "4d6", 3: "6d6", 4: "8d6" }
};
/** A weapon's own "+ X - Y <School> Damage" line (every hit in the classic game): once-per-turn extra dice. */
export const WEAPON_EXTRA_DICE = { 0: "1d4", 1: "1d4", 2: "1d6", 3: "1d8", 4: "1d10" };

/**
 * "+N% critical strike" (setting critDice): extra dice on a Critical Hit, not doubled. The spell version adds the
 * same dice to spell attacks that score a Critical Hit. No 19-20 range (unless the source's hand text says so).
 */
export const CRIT_RULE = { dice: { 1: "1d6", 2: "1d6", 3: "2d6", 4: "3d6" } };

/** "+N% dodge / parry" (setting parryReaction): a Reaction, +ac AC against one attack, once per Short Rest. */
export const PARRY_RULE = { ac: { 1: 2, 2: 2, 3: "@prof", 4: "@prof" }, uses: 1, recovery: "sr" };

/**
 * "Restores N mana per 5 sec." (setting manaRegen), by slot:
 *   slot recovery (slotRecoverySlots): once per Long Rest, during a Short Rest, regain one expended
 *     spell slot of level slotLevel or lower; attunement. Green / blue may route to an official base (VARIANT_BASES).
 *   concentration (every other slot): +N to Constitution saving throws to keep Concentration (passive).
 */
export const MANA_REGEN = {
  slotLevel: { 1: 1, 2: 3, 3: 4, 4: 5 }, concentration: { 1: 1, 2: 1, 3: 2, 4: 2 },
  slotRecoverySlots: ["Head", "Chest", "Neck", "Finger", "Trinket", "Held In Off-hand", "Relic"]
};

/**
 * "Restores N health per 5 sec.": green / blue route to an official base (VARIANT_BASES, need hpRegen; without it the
 * line goes to GM review); purple / orange follow the regeneration pattern: regain `dice` Hit Points every
 * `minutes` minutes while you have at least 1 Hit Point (attunement).
 */
export const HEALTH_REGEN = { patternFrom: 3, dice: "1d6", minutes: 10 };

/**
 * Resistance on jewellery and cloaks (identity test): from minTier, a resistance line that is the item's largest
 * number (ties allowed) on one of `slots` gives full Resistance to that school even below RESIST_RULE's size,
 * following the official resistance-ring pattern (no re-base). maxSchools: Resistances one item may give, by tier
 * (only Legendary items keep two, and only when both lines are full size). 3+ small resistances to different schools
 * on a ring or cloak (protection) go to the protection base (VARIANT_BASES); without that base the item goes to GM
 * review (AC never comes from our own riders outside the trinket line).
 */
export const RESIST_RING = { minTier: 2, slots: ["Finger", "Neck", "Back"], maxSchools: { 1: 1, 2: 1, 3: 1, 4: 2 },
  protection: { slots: ["Finger", "Back"], minSchools: 3 } };

/** "When struck" lines that damage the attacker: passive, the attacker takes these dice of the line's school. */
export const THORNS_DICE = { 1: "1d4", 2: "1d4", 3: "1d6", 4: "1d6" };

/**
 * Flavour / profession lines (setting flavourBonuses): a small situational bonus (+small, or +big when the line's
 * value is at least bigFrom) to checks with the matching skill or tool, in context. Free: not counted in the line
 * budget. `map`: profession -> what the bonus applies to.
 */
export const FLAVOUR_RULE = {
  small: 1, big: 2, bigFrom: 5,
  map: {
    Mining: "checks to find, judge or dig out ore and stone", Herbalism: "checks with an Herbalism Kit and to find herbs",
    Skinning: "Wisdom (Survival) checks to skin and harvest a creature", Fishing: "Wisdom (Survival) checks to fish",
    Lockpicking: "checks with Thieves' Tools to pick a lock", Engineering: "checks with Tinker's Tools",
    Enchanting: "Intelligence (Arcana) checks to identify or study magic items", Alchemy: "checks with Alchemist's Supplies",
    Blacksmithing: "checks with Smith's Tools", Leatherworking: "checks with Leatherworker's Tools",
    Tailoring: "checks with Weaver's Tools", Cooking: "checks with Cook's Utensils", "First Aid": "Wisdom (Medicine) checks"
  }
};

/** "Use: Increases damage and healing done by spells ... for N sec.": a limited-use surge (DAILY_USES per Long Rest,
 * attunement): for `minutes` minute(s), +SPELL_RULE.bonus to spell attack rolls and save DCs, and once per turn
 * WEAPON_EXTRA_DICE extra damage on one spell's damage roll. */
export const SPELL_SURGE = { minutes: 1 };

/* -------------------------------------------- */
/*  6. Limited uses (Flurry, Blast, ...)        */
/* -------------------------------------------- */

/**
 * Limited-use features (Flurry, Blast and any other per-rest feature) recharge daily, as official items do:
 * all expended uses return when the wielder finishes a Long Rest (dnd5e system.uses, recovery period "lr").
 * Uses per Long Rest by quality:  common 1 | uncommon (green) 1 | rare (blue) 2 | epic (purple) 3 | legendary (orange) 3.
 * "Once per turn" limits are separate and unchanged.
 */
export const DAILY_USES = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 3 };
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
  // Slot level restored by item level: up to level 1, up to level 3, up to level 5.
  { maxIlvl: 25, level: 1 }, { maxIlvl: 45, level: 3 }, { maxIlvl: Infinity, level: 5 }
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

/* -------------------------------------------- */
/*  9. Random suffix enchantments (first pass)  */
/* -------------------------------------------- */

/**
 * Items whose tooltip carries the "<Random enchantment>" line get `flags.loot-ledger.randomSuffix` at build time.
 * When such a CONVERTED item lands on an actor or loot pile, the active GM rolls one suffix from SUFFIXES
 * (weighted by SUFFIX_WEIGHTS for the item's group), renames it "<Item> of the X", adds the suffix's effects and
 * bumps the price. First-pass guidance from the user, to revisit on book day: variety first, power kept modest
 * (official 5e items of the same rarity are the reference), never an ability SCORE increase.
 *
 * Power 1-4: the item's quality tier (TIER, Common/Poor count as 1), +bandBoost when the item's level band is
 * highBandFrom or higher, capped at maxPower.
 *   minPower / maxPower   power range.
 *   highBandFrom          level band from which the power gets +bandBoost (band 5 = character levels 11-13).
 *   comboDrop             two-stat suffixes: each stat passive is sized at power - comboDrop (at least 1), so a
 *                         two-stat suffix is two smaller effects rather than two full ones.
 *   resistFrom            resistance suffixes: full Resistance from this power; below it, Advantage on saving
 *                         throws against effects that deal that damage type.
 *   priceMultiplier       listed price x this, by power.
 *   baseWeight            pick weight of an eligible suffix that its group does not list in SUFFIX_WEIGHTS.
 */
export const SUFFIX_RULE = {
  minPower: 1, maxPower: 4, highBandFrom: 5, bandBoost: 1, comboDrop: 1, resistFrom: 3,
  priceMultiplier: { 1: 1.2, 2: 1.25, 3: 1.35, 4: 1.5 },
  baseWeight: 1
};

/**
 * The suffix table. kind:
 *   "stat"    stats: the STAT_PASSIVE abilities it grants (one = full size, two = two smaller effects, see comboDrop).
 *   "resist"  school: the classic damage school (SCHOOL_MAP gives the 5e damage type).
 *   "healing" die: extra healing die on healing spells, by power.
 *   "power"   critDie below onHitFrom (extra damage on a Critical Hit), onHitDie from onHitFrom (once per turn).
 *   "defense" below acFrom: Reaction +reactionAc against one attack, uses per Long Rest; from acFrom: +ac AC.
 *   "blocking" Reaction: reduce the damage of one hit by the die, uses per Long Rest (shields only).
 *   "marksmanship" ranged attacks ignore Half Cover; from threeQuarterFrom also Three-Quarters Cover (ranged only).
 * only: item groups the suffix can roll on (default: every group). Suffix names are generic fantasy wording.
 */
export const SUFFIXES = [
  { id: "bear",     label: "of the Bear",     kind: "stat", stats: ["str", "con"] },
  { id: "tiger",    label: "of the Tiger",    kind: "stat", stats: ["str", "dex"] },
  { id: "gorilla",  label: "of the Gorilla",  kind: "stat", stats: ["str", "int"] },
  { id: "boar",     label: "of the Boar",     kind: "stat", stats: ["str", "wis"] },
  { id: "monkey",   label: "of the Monkey",   kind: "stat", stats: ["dex", "con"] },
  { id: "falcon",   label: "of the Falcon",   kind: "stat", stats: ["dex", "int"] },
  { id: "wolf",     label: "of the Wolf",     kind: "stat", stats: ["dex", "wis"] },
  { id: "eagle",    label: "of the Eagle",    kind: "stat", stats: ["con", "int"] },
  { id: "whale",    label: "of the Whale",    kind: "stat", stats: ["con", "wis"] },
  { id: "owl",      label: "of the Owl",      kind: "stat", stats: ["int", "wis"] },
  { id: "strength", label: "of Strength",     kind: "stat", stats: ["str"] },
  { id: "agility",  label: "of Agility",      kind: "stat", stats: ["dex"] },
  { id: "stamina",  label: "of Stamina",      kind: "stat", stats: ["con"] },
  { id: "intellect", label: "of Intellect",   kind: "stat", stats: ["int"] },
  { id: "spirit",   label: "of Spirit",       kind: "stat", stats: ["wis"] },
  { id: "fireres",   label: "of Fire Resistance",   kind: "resist", school: "Fire" },
  { id: "frostres",  label: "of Frost Resistance",  kind: "resist", school: "Frost" },
  { id: "natureres", label: "of Nature Resistance", kind: "resist", school: "Nature" },
  { id: "shadowres", label: "of Shadow Resistance", kind: "resist", school: "Shadow" },
  { id: "arcaneres", label: "of Arcane Resistance", kind: "resist", school: "Arcane" },
  { id: "healing",  label: "of Healing",      kind: "healing", die: { 1: "1d4", 2: "1d4", 3: "1d6", 4: "1d8" } },
  { id: "power",    label: "of Power",        kind: "power", critDie: "1d6", onHitFrom: 3, onHitDie: { 3: "1d4", 4: "1d6" } },
  { id: "defense",  label: "of Defense",      kind: "defense", reactionAc: 2, uses: { 1: 1, 2: 2 }, acFrom: 3, ac: 1 },
  { id: "blocking", label: "of Blocking",     kind: "blocking", only: ["shield"], die: { 1: "1d6", 2: "1d8", 3: "2d6", 4: "2d8" }, uses: { 1: 1, 2: 2, 3: 2, 4: 3 } },
  { id: "marksmanship", label: "of Marksmanship", kind: "marksmanship", only: ["ranged"], threeQuarterFrom: 3 }
];

/**
 * Pick weights per item group (unlisted eligible suffixes use SUFFIX_RULE.baseWeight; 0 = never on that group).
 * Groups: cloth, leather, mail, plate (worn armour by armour class), shield, melee, ranged, caster (staves, wands,
 * held off-hand items, relics) and jewelry (rings, necks, trinkets, cloaks, shirts and anything else).
 */
export const SUFFIX_WEIGHTS = {
  cloth:   { owl: 4, intellect: 3, spirit: 3, eagle: 2, falcon: 2, whale: 2, healing: 3, arcaneres: 1.5, shadowres: 1.5,
             bear: 0.25, tiger: 0.25, strength: 0.25, boar: 0.5, gorilla: 0.5, power: 0.25, defense: 0.25 },
  leather: { monkey: 4, agility: 3, falcon: 2, wolf: 2, tiger: 2, power: 2, natureres: 1.5, owl: 0.5, intellect: 0.5 },
  mail:    { eagle: 3, falcon: 2, monkey: 2, wolf: 2, tiger: 2, agility: 2, stamina: 2, healing: 1.5, frostres: 1.5, natureres: 1.5 },
  plate:   { bear: 4, strength: 3, stamina: 3, defense: 3, tiger: 2, boar: 2, gorilla: 1.5, fireres: 1.5, shadowres: 1.5,
             owl: 0.25, intellect: 0.25, falcon: 0.5 },
  shield:  { blocking: 4, defense: 3, bear: 3, stamina: 3, strength: 2, whale: 2, fireres: 1.5, frostres: 1.5, shadowres: 1.5, intellect: 0.5, owl: 0.5 },
  melee:   { tiger: 3, bear: 3, strength: 3, power: 3, monkey: 2, agility: 2, boar: 1.5, owl: 0.25, intellect: 0.25, spirit: 0.5, healing: 0.25 },
  ranged:  { marksmanship: 4, agility: 3, monkey: 3, falcon: 2, wolf: 2, power: 2, strength: 0.25, bear: 0.5, owl: 0.25, healing: 0.25 },
  caster:  { owl: 4, intellect: 3, spirit: 3, healing: 3, eagle: 2, falcon: 1.5, whale: 1.5,
             strength: 0.25, bear: 0.25, tiger: 0.25, monkey: 0.5, agility: 0.5, power: 0.25 },
  jewelry: {}
};

/* -------------------------------------------- */
/*  10. Official bases                          */
/* -------------------------------------------- */

/**
 * Official-base matcher (scripts/base-match.mjs). A converted item can be re-based on an official item from the
 * user's installed compendiums: it keeps its own name, icon, tooltip, price and quality, and takes the base's
 * system data and effects. Mechanics are read from the compendium at build time; Loot Ledger stores no official
 * text, only the names in the tables below and short tags derived in memory during a build.
 *
 *   defaultSources   compendiums searched when the baseSources setting is empty, in priority order (the book pack,
 *                    when set, always comes first). The 2014 SRD (srd2014) is only used when listed by hand.
 *   confidence       accept: re-base the item; suggest: record the base for review, keep the tooltip conversion.
 *   score            score = covered - gap x needs not covered - excess x base features not needed
 *                    - rarityStep x rarity steps below the item - sourcePriority x the source's position.
 *   penalty          confidence = covered / (covered + gaps + excessShare x excess), x unfilledNeeded per needed
 *                    line the base leaves open, x farBelow when the base is farBelowSteps or more rarities lower.
 *   template         the +N weapon / armour / shield template (no compendium item needed): fixed confidence, lower
 *                    when manyGapsFrom or more lines are left for gap-fills.
 *   tableConfidence  confidence of a hit in VARIANT_BASES (a decided rule, not a guess).
 *   weights          how much each kind of line counts (main stat, secondary stat, resistance, small resistance,
 *                    effect line, minor line, the +N backbone).
 *   scoreRule        ability-score bases only for a main stat of at least max(minValue, item level / perItemLevel),
 *                    and only on items stepsUp rarities above the base's own rarity.
 *   beltScore        belts that set Strength: the score the item's tier uses (purple 23, orange 25; see VARIANT_BASES).
 *   guard            specific-base strength guard: a base whose extra damage rides far more often (rank) or is far
 *                    bigger (average dice ratio) than the item's own line is never picked; the +N template is used.
 *   exclude          official items never used as a base (theme-breaking: wishes, flight, summoning, decks ...).
 *                    Cursed, sentient and artifact items are excluded by tag.
 */
export const OFFICIAL_BASES = {
  defaultSources: ["dnd-dungeon-masters-guide.equipment", "dnd-players-handbook.equipment", "dnd5e.equipment24", "dnd-arcana-unleashed.items"],
  srd2014: "dnd5e.items",
  confidence: { accept: 0.6, suggest: 0.4 },
  score: { gap: 0.6, excess: 0.25, rarityStep: 0.12, sourcePriority: 0.02 },
  penalty: { excessShare: 0.5, unfilledNeeded: 0.8, farBelow: 0.8, farBelowSteps: 2 },
  template: { confidence: 0.75, manyGaps: 0.6, manyGapsFrom: 2 },
  tableConfidence: 0.8,
  weights: { mainStat: 2, secondaryStat: 0.5, resist: 1.5, smallResist: 0.5, effect: 1.5, minor: 1, plus: 1 },
  scoreRule: { minValue: 8, perItemLevel: 5, stepsUp: 1 },
  beltScore: { 3: 23, 4: 25 },
  guard: { rank: { crit: 1, perTurn: 2, limited: 2, always: 3 }, maxRankGap: 1, maxDiceRatio: 2 },
  exclude: ["Ring of Three Wishes", "Deck of Many Things", "Carpet of Flying", "Broom of Flying", "Winged Boots",
    "Figurine of Wondrous Power", "Bag of Tricks", "Sphere of Annihilation", "Cubic Gate", "Well of Many Worlds"]
};

/**
 * Variant -> official base (decided rules, checked in order; first hit wins). Keyed by the official item's NAME:
 * the matcher looks the name up in the indexed compendiums and reads rarity and mechanics from there; nothing else
 * about the item is stored here. A rule only applies when the base's rarity is at most the item's (score bases:
 * stepsUp below it), so e.g. a green fire wand never becomes a Rare wand.
 *   kind "variant"     the item's stat variant (phase 2 of the conversion rework) or an explicit line asks for it.
 *   kind "need"        a line of this need kind (slot recovery, health regeneration); maxTier / minTier by quality.
 *                      pattern: true = not a re-base; the line follows that item's shape as a gap-fill.
 *   kind "protection"  minSchools or more small resistances to different schools, on the listed slot.
 *   kind "wand"        a wand whose only line is its damage line, by damage school.
 *   kind "armorName"   chest armour by name: armorBase (SRD armour key) with the normal +N (no compendium item).
 *   kind "score"       ability-score base for a big main stat (setting scoreItems); belt: chosen by beltScore.
 *   kind "potion"      healing potions by item level (POTION_REFLAVOUR names).
 */
export const VARIANT_BASES = [
  { name: "Cloak of Elvenkind", kind: "variant", variant: "stealth", slot: "Back" },
  { name: "Boots of Elvenkind", kind: "variant", variant: "stealth", slot: "Feet" },
  { name: "Pearl of Power", kind: "need", need: "slotRecovery", maxTier: 2 },
  { name: "Periapt of Wound Closure", kind: "need", need: "hpRegen", maxTier: 2 },
  { name: "Ring of Regeneration", kind: "need", need: "hpRegen", minTier: 3, pattern: true },
  { name: "Ring of Protection", kind: "protection", slot: "Finger", minSchools: 3 },
  { name: "Cloak of Protection", kind: "protection", slot: "Back", minSchools: 3 },
  { name: "Wand of Magic Missiles", kind: "wand", school: "Arcane" },
  { name: "Wand of Fireballs", kind: "wand", school: "Fire" },
  { name: "Wand of Lightning Bolts", kind: "wand", school: "Nature" },
  { name: "Breastplate", kind: "armorName", slot: "Chest", nameRx: /breastplate/i, armorBase: "breastplate" },
  { name: "Gauntlets of Ogre Power", kind: "score", ability: "str", slot: "Hands" },
  { name: "Headband of Intellect", kind: "score", ability: "int", slot: "Head" },
  { name: "Amulet of Health", kind: "score", ability: "con", slot: "Neck" },
  { name: "Belt of Giant Strength", kind: "score", ability: "str", slot: "Waist", belt: true }
];

/* -------------------------------------------- */
/*  11. Stat variants and line budget           */
/* -------------------------------------------- */

/**
 * Stat variants (scripts/variants.mjs). The item's main stat (highest primary stat at or above STAT_RULE's threshold)
 * becomes exactly ONE variant, chosen by slot (VARIANT_SLOTS, first matching row wins; deterministic). Flat bonuses
 * only, never an ability score, never weapon attack or damage. Sizes by tier (green / blue / purple / orange):
 *   bonus       checks, saves, skills, the Grapple / Shove DC, spell save DC, Concentration saves: +1 / +1 / +2 / +2
 *   initiative  +1 / +2 / +2 / +3
 *   hpPerLevel  max HP +1 per two levels (green / blue), +1 per level (purple / orange)
 *   hitDice     extra HP per Hit Point Die spent: +1 / +1 / +2 / +Proficiency Bonus
 * advantageFrom: an Advantage swap (Advantage on the roll instead of the flat bonus) is possible from this tier, but
 * only when the item or its group opts in on the review board (flags.loot-ledger.overrides.advantage); never by
 * default. Main-stat ties: stats with a slot rule here first (not a fallback row), then the armour type's stats
 * (armorStats), then stat order (str, dex, con, int, wis).
 */
export const VARIANT_RULE = {
  bonus: { 1: 1, 2: 1, 3: 2, 4: 2 }, initiative: { 1: 1, 2: 2, 3: 2, 4: 3 },
  hpPerLevel: { 1: 0.5, 2: 0.5, 3: 1, 4: 1 }, hitDice: { 1: "1", 2: "1", 3: "2", 4: "@prof" },
  advantageFrom: 3,
  armorStats: { Plate: ["str", "con"], Mail: ["str", "con"], Leather: ["dex"], Cloth: ["int", "wis"] }
};

/**
 * Slot -> variant, per main stat. Row keys (all must match): slots (classic slot), armor (classic armour type),
 * shape (converter shape), held (weapons, wands, shields, off-hand and relic items), caster (cloth armour or a held
 * item), minTier. A row with fallback: true is the stat's default (no slot rule).
 * Variants: grapple (Grapple / Shove DC), athletics, moveSaves (saving throws to avoid being moved or knocked
 * Prone), initiative, stealth, acrobatics, hpMax, conSaves, concentration, spellDC, arcana, investigation,
 * hitDice (Hit Point Dice healing), wisSaves, perception.
 */
export const VARIANT_SLOTS = {
  str: [
    { slots: ["Hands", "Wrist"], variant: "grapple" },
    { slots: ["Feet", "Legs"], variant: "athletics" },
    { armor: ["Plate"], variant: "moveSaves" }, { shape: ["shield"], variant: "moveSaves" }, { slots: ["Waist"], variant: "moveSaves" },
    { fallback: true, variant: "athletics" }
  ],
  dex: [
    { slots: ["Feet", "Legs"], variant: "acrobatics" },
    { slots: ["Back"], variant: "stealth" }, { slots: ["Chest"], armor: ["Leather"], variant: "stealth" },
    { fallback: true, variant: "initiative" }
  ],
  con: [
    { slots: ["Chest", "Legs", "Waist"], variant: "hpMax" },
    { slots: ["Head", "Neck", "Finger", "Back"], variant: "conSaves" },
    { caster: true, variant: "concentration" },
    { fallback: true, variant: "conSaves" }
  ],
  int: [
    { slots: ["Finger", "Neck", "Trinket"], minTier: 3, variant: "spellDC" },
    { slots: ["Head"], variant: "arcana" },
    { slots: ["Finger", "Neck", "Hands"], variant: "investigation" },
    { caster: true, variant: "spellDC" },
    { fallback: true, variant: "investigation" }
  ],
  wis: [
    { held: true, variant: "wisSaves" },
    { slots: ["Finger", "Neck", "Trinket"], minTier: 3, variant: "spellDC" },
    { slots: ["Head", "Neck"], variant: "wisSaves" },
    { slots: ["Chest", "Legs"], variant: "hitDice" },
    { slots: ["Finger", "Back"], variant: "perception" },
    { armor: ["Cloth"], variant: "hitDice" },
    { fallback: true, variant: "perception" }
  ]
};

/**
 * Line budget: benefits an item keeps beyond its +N backbone, counting the stat variant as one and two Resistances
 * as two (green 1, blue 2, purple / orange 3). Non-weapons keep the variant first (on green it is the item's one
 * benefit); weapons keep their lines first and the variant only fills a free slot (reading A: the +N is the
 * backbone, never counted). Lines beyond the budget are dropped weakest first (LINE_WEIGHT, ties: the later line is
 * dropped first) and listed as "Not converted".
 * Free (never counted): flavour / profession bonuses, wand cantrips, passive "when struck" / "protects" riders.
 */
export const LINE_BUDGET = { 1: 1, 2: 2, 3: 3, 4: 3 };
export const FREE_RIDERS = new Set(["flavour", "cantrip", "thorns", "ward"]);
export const LINE_WEIGHT = {
  resistance: 6, burstDamage: 5, extraAttack: 5, spellBonus: 5, spellSurge: 5, slotRecovery: 4, regeneration: 4,
  extraDamage: 3, attackBonus: 3, acBonus: 3, heal: 3, healBonus: 3, parry: 2, critDice: 2, concentration: 2
};
