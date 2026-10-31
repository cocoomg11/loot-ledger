/**
 * Random suffix enchantments (first pass). Pure logic: no Foundry calls at import time or in any function here,
 * so everything is tested in Node (tests/suffix.test.mjs). The hooks that call it live in suffix-hooks.mjs.
 *
 * An item whose tooltip has the "<Random enchantment>" line is flagged `flags.loot-ledger.randomSuffix` by the
 * converter, together with its pick group (`suffixGroup`). When it lands on an actor or loot pile, the active
 * GM's client rolls one suffix (pickSuffix), and suffixUpdate() returns the item update: new name, effects, riders,
 * description section, price bump, and `flags.loot-ledger.suffix = {id, rolledAt, ...}` so it never rolls again.
 * Every number comes from rules.mjs section 9 (SUFFIX_RULE, SUFFIXES, SUFFIX_WEIGHTS) and the stat passive
 * sizes from STAT_PASSIVE. All wording is Loot Ledger's own; ability scores are never raised.
 */
import { SUFFIX_RULE, SUFFIXES, SUFFIX_WEIGHTS, STAT_PASSIVE, SCHOOL_MAP, TIER, ATTUNE_RIDERS } from "./rules.mjs";

const MODULE_ID = "loot-ledger";
export const SUFFIX_GROUPS = Object.keys(SUFFIX_WEIGHTS);
export const RANDOM_LINE = /(?:<|&lt;)Random enchantment(?:>|&gt;)/;
const AE_ADD = 2; // CONST.ACTIVE_EFFECT_MODES.ADD
const RANGED_TYPES = new Set(["Bow", "Gun", "Crossbow", "Thrown"]);

/** Does this source tooltip HTML carry the random enchantment line? */
export function hasRandomLine(html) {
  return RANDOM_LINE.test(html ?? "");
}

/**
 * Pick group from parsed source facts (convert.mjs parseSource + classify shape).
 * @returns {"cloth"|"leather"|"mail"|"plate"|"shield"|"melee"|"ranged"|"caster"|"jewelry"}
 */
export function suffixGroup(p, shape) {
  if (shape === "shield" || p.wowType === "Shield") return "shield";
  if (shape === "wand" || p.wowType === "Wand" || p.wowType === "Staff") return "caster";
  if (shape === "weapon") return p.hands === "ranged" || p.hands === "thrown" || RANGED_TYPES.has(p.wowType) ? "ranged" : "melee";
  if (p.slot === "Held In Off-hand" || p.slot === "Relic") return "caster";
  const armour = { Cloth: "cloth", Leather: "leather", Mail: "mail", Plate: "plate" }[p.wowType];
  return armour ?? "jewelry";
}

/** Suffix power 1-4 from the item's quality and level band (SUFFIX_RULE). */
export function suffixPower({ quality, band } = {}) {
  const R = SUFFIX_RULE;
  let n = Math.max(R.minPower, TIER[quality] ?? 0);
  if ((band ?? 1) >= R.highBandFrom) n += R.bandBoost;
  return Math.min(R.maxPower, n);
}

export function suffixById(id) {
  return SUFFIXES.find(s => s.id === id) ?? null;
}

/** [{suffix, weight}] of the suffixes that can roll on a group, weight > 0 only. */
export function suffixWeights(group) {
  const w = SUFFIX_WEIGHTS[group] ?? {};
  return SUFFIXES
    .filter(s => !s.only || s.only.includes(group))
    .map(s => ({ suffix: s, weight: w[s.id] ?? SUFFIX_RULE.baseWeight }))
    .filter(e => e.weight > 0);
}

/** Weighted pick. rng() returns [0, 1). */
export function pickSuffix(group, rng = Math.random) {
  const list = suffixWeights(group);
  const total = list.reduce((a, e) => a + e.weight, 0);
  let r = rng() * total;
  for (const e of list) {
    r -= e.weight;
    if (r < 0) return e.suffix;
  }
  return list.at(-1).suffix;
}

/** "Item" + "of the Bear" -> "Item of the Bear" (never doubled). */
export function suffixName(name, suffix) {
  const n = String(name ?? "").trim();
  return n.toLowerCase().endsWith(suffix.label.toLowerCase()) ? n : `${n} ${suffix.label}`;
}

/** Listed price bumped by SUFFIX_RULE.priceMultiplier for the power (same denomination). */
export function suffixPrice(price, power) {
  if (!price || !Number(price.value)) return price ? { ...price } : price;
  const m = SUFFIX_RULE.priceMultiplier[power] ?? 1;
  return { ...price, value: Number((Number(price.value) * m).toFixed(4)) };
}

const wear = group => ["melee", "ranged", "caster", "shield"].includes(group) ? "holding" : "wearing";
const usesText = n => `You can use this property ${n === 1 ? "once" : `${n} times`}, regaining all uses when you finish a Long Rest.`;
const change = (key, value) => ({ key, mode: AE_ADD, value: String(value) });

/** One stat's small effect at a size (STAT_PASSIVE values). {name, text, rider, changes} */
export function statEffect(ability, size, hold) {
  const P = STAT_PASSIVE[ability];
  const rider = { type: "statPassive", ability, trigger: "equipped", source: "suffix", provisional: true };
  if (ability === "str") {
    const adv = size >= P.athleticsFrom;
    return {
      name: P.name, changes: adv ? [change("system.skills.ath.roll.mode", 1)] : [],
      rider: { ...rider, effect: "carryingCapacity", multiplier: P.carryMultiplier, ...(adv ? { advantage: "skill:ath" } : {}) },
      text: `${hold}, your carrying capacity is ${P.carryMultiplier === 2 ? "doubled" : `multiplied by ${P.carryMultiplier}`}${adv ? ", and you have Advantage on Strength (Athletics) checks" : ""}.`
    };
  }
  if (ability === "dex") {
    const n = P.initiative[size];
    return { name: P.name, changes: [change("system.attributes.init.bonus", `+ ${n}`)], rider: { ...rider, effect: "initiative", value: n },
      text: `${hold}, you have a +${n} bonus to Initiative rolls.` };
  }
  if (ability === "con") {
    const half = P.hpPerLevel[size] < 1;
    const formula = half ? "floor(@details.level / 2)" : "@details.level";
    return { name: P.name, changes: [change("system.attributes.hp.bonuses.overall", `+ ${formula}`)], rider: { ...rider, effect: "hpMax", formula },
      text: `${hold}, your Hit Point maximum increases by ${half ? "1 for every two levels you have (rounded down)" : "an amount equal to your level"}.` };
  }
  if (ability === "int") {
    const n = P.dc[size], uses = P.uses[size];
    return { name: P.name, changes: [], rider: { ...rider, effect: "spellDC", value: n, uses, recovery: "lr" },
      text: `${hold}, when you cast a spell that forces a saving throw, you can raise that spell's save DC by ${n} for that casting. ${usesText(uses)}` };
  }
  const per = P.perDie[size];
  return { name: P.name, changes: [], rider: { ...rider, effect: "hitDiceHealing", formula: per },
    text: `${hold}, whenever you spend Hit Point Dice during a Short Rest, you regain ${per === "@prof" ? "extra Hit Points equal to your Proficiency Bonus" : `an extra ${per} Hit Point${per === "1" ? "" : "s"}`} for each die you spend.` };
}

/**
 * The effects of a suffix at a power.
 * @returns {{features: {name, text}[], riders: object[], changes: object[]}}
 *   changes: Active Effect changes for flat bonuses dnd5e supports; everything else is text + riders.
 */
export function suffixEffects(suffix, power, { group = "jewelry" } = {}) {
  const R = SUFFIX_RULE;
  const hold = `While ${wear(group)} this item`;
  const out = { features: [], riders: [], changes: [] };
  const add = (name, text, rider, changes = []) => {
    out.features.push({ name, text });
    out.riders.push({ source: "suffix", suffix: suffix.id, power, ...rider });
    out.changes.push(...changes);
  };
  if (suffix.kind === "stat") {
    const size = suffix.stats.length > 1 ? Math.max(1, power - R.comboDrop) : power;
    for (const a of suffix.stats) {
      const e = statEffect(a, size, hold);
      add(e.name, e.text, e.rider, e.changes);
    }
    return out;
  }
  if (suffix.kind === "resist") {
    const type = SCHOOL_MAP[suffix.school];
    const key = type.toLowerCase();
    if (power >= R.resistFrom) add(`${type} Ward`, `${hold}, you have Resistance to ${type} damage.`,
      { type: "resistance", damageType: key, trigger: "equipped" }, [change("system.traits.dr.value", key)]);
    else add(`${type} Ward`, `${hold}, you have Advantage on saving throws against effects that deal ${type} damage.`,
      { type: "saveAdvantage", damageType: key, trigger: "equipped" });
    return out;
  }
  if (suffix.kind === "healing") {
    const die = suffix.die[power];
    add("Mending", `${hold}, when you cast a spell that restores Hit Points, one target of that spell regains an extra ${die} Hit Points. This works once per turn.`,
      { type: "healBonus", die, trigger: "spell" });
    return out;
  }
  if (suffix.kind === "power") {
    if (power >= suffix.onHitFrom) {
      const die = suffix.onHitDie[power];
      add("Force of Will", `${hold}, once per turn when you hit a creature with an attack roll, you can deal an extra ${die} damage of the attack's type.`,
        { type: "extraDamage", dice: die, trigger: "hit", oncePerTurn: true });
    } else add("Force of Will", `${hold}, when you score a Critical Hit with an attack roll, the target takes an extra ${suffix.critDie} damage of the attack's type.`,
      { type: "extraDamage", dice: suffix.critDie, trigger: "crit" });
    return out;
  }
  if (suffix.kind === "defense") {
    if (power >= suffix.acFrom) add("Guarded", `${hold}, you have a +${suffix.ac} bonus to Armor Class.`,
      { type: "acBonus", value: suffix.ac, trigger: "equipped" }, [change("system.attributes.ac.bonus", `+ ${suffix.ac}`)]);
    else {
      const uses = suffix.uses[power];
      add("Guarded", `${hold}, when a creature you can see hits you with an attack roll, you can take a Reaction to gain a +${suffix.reactionAc} bonus to Armor Class against that attack, possibly turning the hit into a miss. ${usesText(uses)}`,
        { type: "reactionAc", value: suffix.reactionAc, uses, recovery: "lr" });
    }
    return out;
  }
  if (suffix.kind === "blocking") {
    const die = suffix.die[power], uses = suffix.uses[power];
    add("Deflect", `${hold}, when an attack roll hits you, you can take a Reaction to reduce the damage you take from that attack by ${die}. ${usesText(uses)}`,
      { type: "damageReduction", dice: die, uses, recovery: "lr" });
    return out;
  }
  if (suffix.kind === "marksmanship") {
    const full = power >= suffix.threeQuarterFrom;
    add("True Aim", `${hold}, your ranged attack rolls with this weapon ignore Half Cover${full ? " and Three-Quarters Cover" : ""}.`,
      { type: "ignoreCover", cover: full ? "threeQuarters" : "half", trigger: "attack" });
    return out;
  }
  return out;
}

/** HTML section added to the item description. */
export function suffixSection(suffix, power, effects) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<section class="loot-ledger-suffix"><p><strong>Random suffix: ${esc(suffix.label)}</strong> (power ${power}).</p>` +
    effects.features.map(f => `<p><strong>${esc(f.name)}.</strong> ${esc(f.text)}</p>`).join("") +
    `<p><em>Rolled by Loot Ledger from the item's random enchantment line (first-pass suffix rules).</em></p></section>`;
}

/** Has this item already been given a suffix? */
export function isRolled(data) {
  return !!data?.flags?.[MODULE_ID]?.suffix?.id;
}

/** Can this item roll a suffix at all? */
export function canRoll(data) {
  return !!data?.flags?.[MODULE_ID]?.randomSuffix;
}

/**
 * The update for one item (plain data). Returns null when the item has no random line, or it already rolled and
 * `reroll` is false. A reroll starts from the stored base name / price / description, so it never stacks.
 * @param {object} data       item data (toObject()), with flags.loot-ledger
 * @param {object} [options]
 * @param {string} [options.suffixId]  pick this suffix instead of rolling
 * @param {boolean} [options.reroll=false]
 * @param {Function} [options.rng=Math.random]
 * @param {number} [options.now=Date.now()]
 * @returns {null|{update: object, effects: object[], removeEffects: string[], suffix: object, power: number}}
 */
export function suffixUpdate(data, { suffixId = null, reroll = false, rng = Math.random, now = Date.now() } = {}) {
  const f = data?.flags?.[MODULE_ID] ?? {};
  if (!f.randomSuffix) return null;
  if (f.suffix?.id && !reroll) return null;
  const group = SUFFIX_GROUPS.includes(f.suffixGroup) ? f.suffixGroup : "jewelry";
  let suffix;
  if (suffixId) {
    suffix = suffixById(suffixId);
    if (!suffix) throw new Error(`Loot Ledger: unknown suffix "${suffixId}".`);
  } else suffix = pickSuffix(group, rng);
  const power = suffixPower({ quality: f.quality, band: f.band });
  const effects = suffixEffects(suffix, power, { group });
  const base = f.suffix?.base ?? {
    name: data.name, price: data.system?.price ?? null, description: data.system?.description?.value ?? ""
  };
  const riders = [...(f.riders ?? []).filter(r => r.source !== "suffix"), ...effects.riders];
  const update = {
    name: suffixName(base.name, suffix),
    "system.description.value": base.description + suffixSection(suffix, power, effects),
    [`flags.${MODULE_ID}.riders`]: riders,
    [`flags.${MODULE_ID}.suffix`]: { id: suffix.id, label: suffix.label, power, group, rolledAt: now, base }
  };
  if (base.price) update["system.price"] = suffixPrice(base.price, power);
  // Resistance and AC suffixes attune, as the converter's own riders of those types do (ATTUNE_RIDERS).
  const attune = effects.riders.some(r => ATTUNE_RIDERS.has(r.type));
  if (!("attunement" in base)) base.attunement = data.system?.attunement ?? "";
  update["system.attunement"] = attune ? "required" : base.attunement;
  const aes = effects.changes.length ? [{
    name: `${suffix.label.replace(/^of (the )?/, "")} (suffix)`.replace(/^\w/, c => c.toUpperCase()),
    img: data.img ?? "icons/svg/aura.svg", transfer: true, disabled: false, changes: effects.changes,
    flags: { [MODULE_ID]: { suffix: suffix.id } }
  }] : [];
  const removeEffects = (data.effects ?? []).filter(e => e.flags?.[MODULE_ID]?.suffix).map(e => e._id);
  return { update, effects: aes, removeEffects, suffix, power, features: effects.features };
}

/** One row per suffix with its effect at the lowest and highest power, for the Build Report and api.suffixes(). */
export function suffixTable() {
  return SUFFIXES.map(s => {
    const lo = suffixEffects(s, SUFFIX_RULE.minPower), hi = suffixEffects(s, SUFFIX_RULE.maxPower);
    const groups = SUFFIX_GROUPS.filter(g => suffixWeights(g).some(e => e.suffix.id === s.id));
    return {
      id: s.id, label: s.label, kind: s.kind, groups,
      low: lo.features.map(f => `${f.name}: ${f.text}`).join(" "),
      high: hi.features.map(f => `${f.name}: ${f.text}`).join(" ")
    };
  });
}

/** Build Report page "Random suffixes". */
export function suffixPageHtml({ sourceCount = 0, enabled = true, mode = "roll" } = {}) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = suffixTable();
  return `<p><strong>${sourceCount}</strong> source item${sourceCount === 1 ? "" : "s"} carry the random enchantment line. ` +
    (enabled ? `Converted copies roll a suffix when they land on an actor or loot pile (${mode === "gm" ? "GM picks: use the API or the Reroll action" : "rolled automatically by the active GM"}).`
      : "Random suffix enchantments are switched off; nothing is rolled.") + `</p>` +
    `<p>Power is the item's quality tier (Common counts as 1), +${SUFFIX_RULE.bandBoost} from level band ${SUFFIX_RULE.highBandFrom}, at most ${SUFFIX_RULE.maxPower}. ` +
    `Price x${Object.values(SUFFIX_RULE.priceMultiplier).join(" / x")} by power. First-pass numbers; tune them in rules.mjs section 9.</p>` +
    `<table><thead><tr><th>Suffix</th><th>Rolls on</th><th>Power ${SUFFIX_RULE.minPower}</th><th>Power ${SUFFIX_RULE.maxPower}</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.groups.join(", "))}</td><td>${esc(r.low)}</td><td>${esc(r.high)}</td></tr>`).join("") +
    `</tbody></table>`;
}
