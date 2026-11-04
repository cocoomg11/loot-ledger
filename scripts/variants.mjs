/**
 * Stat variants (pure; tested in Node). The item's main stat becomes exactly ONE variant, chosen by slot
 * (rules.mjs section 11, VARIANT_SLOTS), sized by tier (VARIANT_RULE). Flat bonuses only: never an ability score,
 * never weapon attack or damage. An Advantage swap replaces the flat bonus only when the item or its group opts in
 * (overrides.advantage, set on the review board), never by default.
 *
 * Also the line budget (LINE_BUDGET): what an item keeps beyond its +N backbone, and the gap-fill signature used by
 * collapse keys. All wording is Loot Ledger's own.
 */
import { VARIANT_RULE, VARIANT_SLOTS, STAT_RULE, LINE_BUDGET, FREE_RIDERS, LINE_WEIGHT } from "./rules.mjs";

export const STAT_ORDER = ["str", "dex", "con", "int", "wis"];
const LABEL = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom" };

/** Item facts the slot table reads: {slot, armor, shape, held, caster}. */
export function slotFacts(p, shape) {
  const held = ["weapon", "wand", "shield"].includes(shape) || ["Held In Off-hand", "Relic"].includes(p.slot);
  const caster = p.wowType === "Cloth" || ["Staff", "Wand"].includes(p.wowType) || ["Held In Off-hand", "Relic"].includes(p.slot);
  return { slot: p.slot ?? null, armor: p.wowType ?? null, shape, held, caster };
}

/** The first VARIANT_SLOTS row for `ability` that matches the facts: {variant, fallback}. */
export function slotRule(ability, facts, tier) {
  for (const r of VARIANT_SLOTS[ability] ?? []) {
    if (r.fallback) return { variant: r.variant, fallback: true };
    if (r.slots && !r.slots.includes(facts.slot)) continue;
    if (r.armor && !r.armor.includes(facts.armor)) continue;
    if (r.shape && !r.shape.includes(facts.shape)) continue;
    if (r.held && !facts.held) continue;
    if (r.caster && !facts.caster) continue;
    if (r.minTier && tier < r.minTier) continue;
    return { variant: r.variant, fallback: false };
  }
  return null;
}

/** Main-stat threshold for an item level (STAT_RULE). */
export const statThreshold = ilvl => Math.max(STAT_RULE.minValue, Math.ceil((ilvl ?? 1) / STAT_RULE.perItemLevel));

/**
 * The main stat: highest value; ties broken by (a) a slot rule for this slot (not a fallback row), (b) the armour
 * type's stats, (c) stat order. Returns {ability, value, line, sub (below the threshold)} or null.
 */
export function mainStat(p, facts, tier) {
  const keys = STAT_ORDER.filter(k => p.stats?.[k]);
  if (!keys.length) return null;
  const top = Math.max(...keys.map(k => p.stats[k]));
  const tied = keys.filter(k => p.stats[k] === top);
  const armorStats = VARIANT_RULE.armorStats[facts.armor] ?? [];
  const rank = k => [slotRule(k, facts, tier)?.fallback === false ? 0 : 1, armorStats.includes(k) ? 0 : 1, STAT_ORDER.indexOf(k)];
  tied.sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  const ability = tied[0];
  return { ability, value: top, line: p.statLines?.[ability] ?? `+${top} ${ability}`, sub: top < statThreshold(p.itemLevel) };
}

/** AE change keys (dnd5e: legacy keys, shimmed by 6.x) for flat variants and their Advantage form. */
const VARIANT_KEYS = {
  athletics: { flat: "system.skills.ath.bonuses.check", adv: "system.skills.ath.roll.mode" },
  moveSaves: { flat: "system.abilities.str.bonuses.save", adv: "system.abilities.str.save.roll.mode" },
  initiative: { flat: "system.attributes.init.bonus", adv: "system.attributes.init.roll.mode" },
  stealth: { flat: "system.skills.ste.bonuses.check", adv: "system.skills.ste.roll.mode" },
  acrobatics: { flat: "system.skills.acr.bonuses.check", adv: "system.skills.acr.roll.mode" },
  hpMax: { flat: "system.attributes.hp.bonuses.overall" },
  conSaves: { flat: "system.abilities.con.bonuses.save", adv: "system.abilities.con.save.roll.mode" },
  concentration: { flat: "system.attributes.concentration.bonuses.save", adv: "system.attributes.concentration.roll.mode" },
  spellDC: { flat: "system.bonuses.spell.dc" },
  arcana: { flat: "system.skills.arc.bonuses.check", adv: "system.skills.arc.roll.mode" },
  investigation: { flat: "system.skills.inv.bonuses.check", adv: "system.skills.inv.roll.mode" },
  wisSaves: { flat: "system.abilities.wis.bonuses.save", adv: "system.abilities.wis.save.roll.mode" },
  perception: { flat: "system.skills.prc.bonuses.check", adv: "system.skills.prc.roll.mode" }
  // grapple (the Unarmed Strike Grapple / Shove DC) and hitDice (Hit Point Dice healing) have no actor field: text only.
};
export const variantKeys = v => VARIANT_KEYS[v] ?? null;

/** Matcher tags a variant is covered by (base-match riderTags). */
export const VARIANT_TAGS = {
  grapple: "grapple", athletics: "skill:ath", moveSaves: "stat:str", initiative: "init", stealth: "stealth",
  acrobatics: "skill:acr", hpMax: "hpMax", conSaves: "stat:con", concentration: "concentration", spellDC: "spell",
  arcana: "skill:arc", investigation: "skill:inv", hitDice: "hpRegen", wisSaves: "stat:wis", perception: "skill:prc"
};

const NAME = {
  grapple: "Iron Grip", athletics: "Sure Footing", moveSaves: "Rooted", initiative: "Quickness", stealth: "Quiet Step",
  acrobatics: "Nimble", hpMax: "Vigor", conSaves: "Hardy", concentration: "Steady Mind", spellDC: "Arcane Weight",
  arcana: "Lore", investigation: "Keen Mind", hitDice: "Renewal", wisSaves: "Clear Mind", perception: "Watchful"
};
const WHAT = {
  athletics: "Strength (Athletics) checks", moveSaves: "Strength saving throws, including saving throws against being pushed, pulled or knocked Prone",
  initiative: "Initiative rolls", stealth: "Dexterity (Stealth) checks", acrobatics: "Dexterity (Acrobatics) checks",
  conSaves: "Constitution saving throws", concentration: "Constitution saving throws you make to maintain Concentration",
  arcana: "Intelligence (Arcana) checks", investigation: "Intelligence (Investigation) checks", wisSaves: "Wisdom saving throws",
  perception: "Wisdom (Perception) checks"
};

/**
 * One variant's feature. `hold` is the "While wearing this cloak" phrase; `advantage` the opt-in swap.
 * Returns {name, text, rider}; rider.type "variant" (rider.attune: true only for the spell-DC variant).
 */
export function variantFeature(variant, ability, tier, { hold = "While wearing this item", advantage = false } = {}) {
  const R = VARIANT_RULE;
  const n = variant === "initiative" ? R.initiative[tier] : R.bonus[tier];
  const adv = advantage && tier >= R.advantageFrom && !!VARIANT_KEYS[variant]?.adv;
  const rider = { type: "variant", variant, ability, value: n, trigger: "equipped", ...(adv ? { advantage: true } : {}) };
  let text;
  if (variant === "hpMax") {
    const half = R.hpPerLevel[tier] < 1;
    rider.formula = half ? "floor(@details.level / 2)" : "@details.level"; delete rider.value;
    text = `${hold}, your Hit Point maximum increases by ${half ? "1 for every two levels you have (rounded down)" : "an amount equal to your level"}.`;
  } else if (variant === "hitDice") {
    const per = R.hitDice[tier];
    rider.formula = per; delete rider.value;
    text = `${hold}, whenever you spend Hit Point Dice to regain Hit Points, you regain ${per === "@prof" ? "extra Hit Points equal to your Proficiency Bonus" : `an extra ${per} Hit Point${per === "1" ? "" : "s"}`} for each die you spend.`;
  } else if (variant === "grapple") {
    text = `${hold}, the saving throw DC of your Grapple and Shove (Unarmed Strike options) increases by ${n}.`;
  } else if (variant === "spellDC") {
    rider.attune = true;
    text = `${hold}, your spell save DC increases by ${n}. This doesn't stack with other items that raise your spell save DC; use the highest.`;
  } else if (adv) {
    text = `${hold}, you have Advantage on ${WHAT[variant]}.`;
  } else {
    text = `${hold}, you have a +${n} bonus to ${WHAT[variant]}.`;
  }
  return { name: NAME[variant], text, rider, label: LABEL[ability] };
}

/**
 * Line budget. `benefits`: [{key, weight, variant?, free?}] in source order. Returns the keys to drop (weakest
 * first, later line first on ties). Non-weapons keep the variant first; weapons keep lines first (the variant is
 * dropped before any line).
 */
export function overBudget(benefits, tier, { weapon = false } = {}) {
  const budget = LINE_BUDGET[tier] ?? 0;
  const counted = benefits.filter(b => !b.free);
  let over = counted.length - budget;
  if (over <= 0) return [];
  const drop = [];
  const variant = counted.find(b => b.variant);
  if (weapon && variant) { drop.push(variant.key); over--; }
  const lines = counted.filter(b => !b.variant).map((b, i) => ({ ...b, i }))
    .sort((a, b) => a.weight - b.weight || b.i - a.i);
  for (const b of lines) { if (over <= 0) break; drop.push(b.key); over--; }
  if (over > 0 && variant && !drop.includes(variant.key)) drop.push(variant.key);
  return drop;
}

/** Weight of a rider type in the budget (LINE_WEIGHT; unknown = 1). Free riders never count. */
export const lineWeight = type => LINE_WEIGHT[type] ?? 1;
export const isFree = type => FREE_RIDERS.has(type);

/**
 * Gap-fill signature for collapse keys (phase 3): the sorted, comma-joined `kind[:detail]` of every gap-fill, so two
 * items with the same base and the same gap-fills share a key.
 */
export function gapFillSignature(gapFills = []) {
  return gapFills.map(g => [g.kind, g.detail].filter(x => x !== null && x !== undefined && x !== "").join(":")).sort().join(",");
}
