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
import { KEYS } from "./effects.mjs";

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
    return { variant: r.variant, fallback: false, gated: !!r.minTier };
  }
  return null;
}

/** Main-stat threshold for an item level (STAT_RULE). */
export const statThreshold = ilvl => Math.max(STAT_RULE.minValue, Math.ceil((ilvl ?? 1) / STAT_RULE.perItemLevel));

/**
 * The main stat: highest value; ties broken by
 *   (a) a quality-gated slot rule (a row with minTier, e.g. purple / orange jewellery with a caster stat -> spell DC),
 *   (b) the armour type's stats, in the armour's own order (VARIANT_RULE.armorStats: plate / mail Sta then Str,
 *       leather Agi, cloth Int then Spi),
 *   (c) any other slot rule for this slot (not a fallback row),
 *   (d) stat order.
 * A slot rule always beats plain stat order. Returns {ability, value, line, sub (below the threshold)} or null.
 */
export function mainStat(p, facts, tier) {
  const keys = STAT_ORDER.filter(k => p.stats?.[k]);
  if (!keys.length) return null;
  const top = Math.max(...keys.map(k => p.stats[k]));
  const tied = keys.filter(k => p.stats[k] === top);
  const armorStats = VARIANT_RULE.armorStats[facts.armor] ?? [];
  const rank = k => {
    const row = slotRule(k, facts, tier);
    const gated = row && !row.fallback && row.gated;
    const armour = armorStats.indexOf(k);
    return [gated ? 0 : 1, armour >= 0 ? armour : armorStats.length, row?.fallback === false ? 0 : 1, STAT_ORDER.indexOf(k)];
  };
  tied.sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3]; });
  const ability = tied[0];
  return { ability, value: top, line: p.statLines?.[ability] ?? `+${top} ${ability}`, sub: top < statThreshold(p.itemLevel) };
}

/**
 * AE change keys for flat variants and their Advantage form: dnd5e 6.x `roll` fields (effects.mjs KEYS; the old
 * `bonuses.check` / `bonuses.save` keys are shims removed in dnd5e 7.0 and are never written).
 */
const VARIANT_KEYS = {
  athletics: { flat: KEYS.skill("ath"), adv: KEYS.skillMode("ath") },
  moveSaves: { flat: KEYS.abilitySave("str"), adv: KEYS.abilitySaveMode("str") },
  initiative: { flat: KEYS.init, adv: KEYS.initMode },
  stealth: { flat: KEYS.skill("ste"), adv: KEYS.skillMode("ste") },
  acrobatics: { flat: KEYS.skill("acr"), adv: KEYS.skillMode("acr") },
  hpMax: { flat: KEYS.hpMax },
  conSaves: { flat: KEYS.abilitySave("con"), adv: KEYS.abilitySaveMode("con") },
  concentration: { flat: KEYS.concentration, adv: KEYS.concentrationMode },
  spellDC: { flat: KEYS.spellDC },
  arcana: { flat: KEYS.skill("arc"), adv: KEYS.skillMode("arc") },
  investigation: { flat: KEYS.skill("inv"), adv: KEYS.skillMode("inv") },
  wisSaves: { flat: KEYS.abilitySave("wis"), adv: KEYS.abilitySaveMode("wis") },
  perception: { flat: KEYS.skill("prc"), adv: KEYS.skillMode("prc") }
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

/**
 * Weight of a rider (or rider type) in the budget (LINE_WEIGHT; unknown = 1). Free riders never count. A bleed weighs as
 * the damage it replaced: a blast-band bleed as a blast, a critical / on-hit bleed as extra damage.
 */
export const lineWeight = r => {
  const type = typeof r === "string" ? r : r?.type;
  if (type === "bleed" && typeof r === "object") return LINE_WEIGHT[r.band === "blast" ? "burstDamage" : "extraDamage"] ?? 1;
  return LINE_WEIGHT[type] ?? 1;
};
export const isFree = type => FREE_RIDERS.has(type);

/**
 * Gap-fill signature for collapse keys (phase 3): the sorted, comma-joined `kind[:detail]` of every gap-fill, so two
 * items with the same base and the same gap-fills share a key.
 */
export function gapFillSignature(gapFills = []) {
  return gapFills.map(g => [g.kind, g.detail].filter(x => x !== null && x !== undefined && x !== "").join(":")).sort().join(",");
}
