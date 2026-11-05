/**
 * Official-base matcher (pure; tested in Node with made-up fixtures). Picks, for one converted item, an official
 * base item from the user's installed compendiums, or the +N template, or nothing (the tooltip conversion stays).
 *
 * Pipeline: needs (what the item's lines ask for) -> candidates (same slot / weapon or armour family, rarity not
 * above the item, nothing excluded) -> base signals (tags from the base's Active Effect keys and a small keyword
 * tagger run in memory at build time; no text is kept) -> score and confidence (rules.mjs OFFICIAL_BASES) ->
 * +N template -> decide (accept / suggest / none). Decided rules (VARIANT_BASES) and ability-score bases are
 * checked first. The specific-base strength guard keeps a base whose extra damage is far stronger than the
 * item's own line out of the running.
 *
 * Nothing here reads Foundry: build.mjs passes plain index entries (`indexBases`), convert.mjs passes the parsed
 * item and its riders (`matchBase`).
 */
import { VARIANT_TAGS } from "./variants.mjs";
import { OFFICIAL_BASES, VARIANT_BASES, SCHOOL_MAP, PROC_RULE, RESIST_RULE, STAT_RULE, SPELL_RULE, POTION_REFLAVOUR } from "./rules.mjs";

/** Bump when matching logic changes (stored on every matched item as base.matcherVersion; part of the hash). */
export const MATCHER_VERSION = 2;

/** Fields read from each compendium index (one getIndex call per pack per build). */
export const INDEX_FIELDS = [
  "system.rarity", "system.rarities", "system.type", "system.attunement", "system.properties", "system.source",
  "system.description.value", "effects", "_stats.modifiedTime"
];

const RARITY_TIER = { common: 0, uncommon: 1, rare: 2, veryRare: 3, legendary: 4, artifact: 5 };
const ABILITIES = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };
const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
/** Tags that describe a base but are not benefits (never excess). */
const NEUTRAL = new Set(["plus"]);

/* -------------------------------------------- */
/*  Base signals                                */
/* -------------------------------------------- */

/**
 * Rarity tier of an index entry (dnd5e 5 `system.rarity` string or dnd5e 6 `system.rarities` set/array). A magic
 * item (property `mgc`) with no rarity (multi-tier entries such as "+1, +2, or +3" items) returns null: its rarity
 * cannot be checked against the item's, so it is never a candidate. Mundane items with no rarity are common (0).
 */
export function entryRarity(e) {
  const s = e.system ?? {};
  const r = s.rarities && [...s.rarities].length ? [...s.rarities][0] : s.rarity;
  if (RARITY_TIER[r] !== undefined) return RARITY_TIER[r];
  return [...(s.properties ?? [])].includes("mgc") ? null : 0;
}

/** Slot of an official item, from its dnd5e type and a few generic name words (equipment only). */
export function entrySlot(e) {
  const t = e.system?.type?.value ?? "";
  if (e.type === "weapon") return "weapon";
  if (["light", "medium", "heavy"].includes(t)) return "armor";
  if (t === "shield") return "shield";
  if (t === "ring") return "Finger";
  if (t === "wand") return "wand";
  const n = String(e.name ?? "").toLowerCase();
  const rx = [
    [/\b(cloak|cape|mantle)\b/, "Back"], [/\b(boots|slippers)\b/, "Feet"], [/\b(gloves|gauntlets)\b/, "Hands"],
    [/\b(belt|girdle)\b/, "Waist"], [/\bbracers\b/, "Wrist"], [/\b(helm|hat|cap|circlet|headband|crown)\b/, "Head"],
    [/\b(amulet|periapt|necklace|medallion|brooch|scarab)\b/, "Neck"], [/\b(robe|vestments)\b/, "Chest"]
  ];
  for (const [r, slot] of rx) if (r.test(n)) return slot;
  if (e.type === "equipment" && ["trinket", "wondrous", ""].includes(t)) return "Trinket";
  return null;
}

/**
 * Tags for one official item, from its Active Effect change keys and a keyword pass over its rules text (in
 * memory only; the text is not returned). Returns {tags:Set, damage:[{type, avg, freq}], scores:{ability: value}}.
 */
export function baseSignals(e) {
  const tags = new Set(), damage = [], scores = {};
  const slot = entrySlot(e);
  for (const fx of e.effects ?? []) {
    // Foundry 14 keeps an effect's changes under system.changes; older data has them at the top level.
    for (const c of effectChanges(fx)) {
      const k = String(c.key ?? ""); let m;
      if (k === "system.attributes.ac.bonus") tags.add(slot === "armor" || slot === "shield" ? "plus" : "ac");
      else if (k === "system.bonuses.abilities.save") tags.add("saves");
      else if (k === "system.bonuses.abilities.check") tags.add("checks");
      else if ((m = k.match(/^system\.abilities\.(\w+)\.bonuses\.(save|check)$/))) tags.add(`stat:${m[1]}`);
      else if ((m = k.match(/^system\.abilities\.(\w+)\.value$/))) { tags.add(`score:${m[1]}`); scores[m[1]] = Number(c.value) || null; }
      else if (k === "system.traits.dr.value") String(c.value).split(/[,\s]+/).filter(Boolean).forEach(v => tags.add(`resist:${v.toLowerCase()}`));
      else if (/^system\.bonuses\.(spell\.dc|rsak|msak)/.test(k)) tags.add("spell");
      else if (/^system\.bonuses\.(mwak|rwak)\.attack/.test(k)) tags.add("attack");
      else if (k.startsWith("system.attributes.init")) tags.add("init");
      else if (k.startsWith("system.attributes.hp.bonuses")) tags.add("hpMax");
      else if ((m = k.match(/^system\.skills\.(\w+)\./))) tags.add(m[1] === "ste" ? "stealth" : `skill:${m[1]}`);
    }
  }
  const text = String(e.system?.description?.value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (text) {
    let m;
    for (m of text.matchAll(/resistance to (\w+) damage/g)) if (DAMAGE_TYPES.includes(m[1])) tags.add(`resist:${m[1]}`);
    if (/bonus to (your )?armor class/.test(text)) tags.add(slot === "armor" || slot === "shield" ? "plus" : "ac");
    if (/bonus to attack (rolls )?and damage rolls/.test(text) && slot === "weapon") tags.add("plus");
    if (/bonus to (all )?saving throws/.test(text)) tags.add("saves");
    for (m of text.matchAll(/(strength|dexterity|constitution|intelligence|wisdom|charisma)(?: score)? (?:is|becomes|changes to|of) (\d+)/g)) {
      tags.add(`score:${ABILITIES[m[1]]}`); scores[ABILITIES[m[1]]] = Number(m[2]);
    }
    if (/spell slot/.test(text) && /\b(regain|recover)/.test(text)) tags.add("slotRecovery");
    if (/hit point dice/.test(text) || (/\bregain\b[^.]*hit points/.test(text) && /\b(minutes|hour)\b/.test(text))) tags.add("hpRegen");
    if (/\bstealth\b/.test(text)) tags.add("stealth");
    if (/spell attack rolls/.test(text)) tags.add("spell");
    if (/\bcurse/.test(text)) tags.add("cursed");
    if (/\bsentient\b/.test(text)) tags.add("sentient");
    for (m of text.matchAll(/(\d+)d(\d+) (\w+) damage/g)) {
      if (!DAMAGE_TYPES.includes(m[3])) continue;
      const at = text.slice(Math.max(0, m.index - 160), m.index + 160);
      const freq = /critical hit/.test(at) ? "crit" : /once (per|on each of your) turns?/.test(at) ? "perTurn"
        : /(charge|long rest|dawn|can't .* again until)/.test(at) ? "limited" : "always";
      damage.push({ type: m[3], avg: (+m[1] * (+m[2] + 1)) / 2, freq });
      tags.add(`damage:${m[3]}`);
    }
  }
  if (entryRarity(e) >= RARITY_TIER.artifact) tags.add("artifact");
  return { tags, damage, scores };
}

/** An Active Effect's changes (top-level `changes`, or `system.changes` on Foundry 14). */
export function effectChanges(fx) {
  const c = fx?.changes ?? fx?.system?.changes;
  return Array.isArray(c) ? c : [];
}

/* -------------------------------------------- */
/*  Index                                       */
/* -------------------------------------------- */

/**
 * Build the in-memory base index from pack index entries.
 * @param {{pack:string, entries:object[]}[]} sources  in priority order (first pack wins on duplicate names)
 * @param {object} [o]  {exclude: string[]}
 * @returns {{entries:object[], byName:Map, fingerprint:string}}
 */
export function indexBases(sources, { exclude = OFFICIAL_BASES.exclude } = {}) {
  const skip = new Set(exclude.map(n => n.toLowerCase()));
  const byName = new Map(), entries = [], fp = [];
  sources.forEach(({ pack, entries: list }, priority) => {
    const sorted = [...(list ?? [])].sort((a, b) => (b.system?.source?.rules === "2024") - (a.system?.source?.rules === "2024"));
    for (const e of sorted) {
      fp.push(`${pack}:${e._id}:${e._stats?.modifiedTime ?? ""}`);
      if (e.type && !["weapon", "equipment"].includes(e.type) && e.type !== "consumable") continue;
      const key = String(e.name ?? "").toLowerCase();
      if (!key || skip.has(key) || byName.has(key)) continue;
      const sig = baseSignals(e);
      if (sig.tags.has("cursed") || sig.tags.has("sentient") || sig.tags.has("artifact")) continue;
      // A pack index lists effects without their changes: such entries are enriched from the full document when
      // they reach an item's shortlist (enrichEntry).
      const effects = e.effects ?? [];
      const entry = {
        uuid: e.uuid ?? `Compendium.${pack}.Item.${e._id}`, id: e._id, name: e.name, pack, priority, type: e.type,
        rarity: entryRarity(e), slot: entrySlot(e), family: e.system?.type?.baseItem || null,
        attune: e.system?.attunement === "required", modified: e._stats?.modifiedTime ?? null, ...sig,
        enriched: !effects.length || effects.every(fx => effectChanges(fx).length > 0)
      };
      byName.set(key, entry);
      entries.push(entry);
    }
  });
  return { entries, byName, fingerprint: fp.sort().join("|") };
}

/**
 * Add the signals of an entry's full document (its Active Effect changes, which the pack index lacks) to the entry,
 * in place. Tags are only added (the index's own text tags stay); an entry whose document turns out cursed,
 * sentient or an artifact is excluded. Returns true when the entry's tags changed.
 * @param {object} entry an indexBases() entry
 * @param {object|null} doc  the full Item document or its data (null: could not be loaded; nothing changes)
 */
export function enrichEntry(entry, doc) {
  if (entry.enriched) return false;
  entry.enriched = true;
  if (!doc) return false;
  const data = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const sig = baseSignals(data);
  const before = entry.tags.size;
  for (const t of sig.tags) entry.tags.add(t);
  for (const d of sig.damage) if (!entry.damage.some(x => x.type === d.type && x.freq === d.freq)) entry.damage.push(d);
  Object.assign(entry.scores, Object.fromEntries(Object.entries(sig.scores).filter(([k]) => entry.scores[k] == null)));
  if (sig.tags.has("cursed") || sig.tags.has("sentient") || sig.tags.has("artifact")) entry.excluded = true;
  return entry.tags.size !== before || !!entry.excluded;
}

/**
 * The candidates worth loading in full for one item: not yet enriched, ranked by their index score (coverage not
 * required, since the missing effect changes may be what covers the item), top OFFICIAL_BASES.shortlist, plus the
 * decided-rule entry when it has one. Returns index entries.
 */
export function shortlist(item, index, needs = itemNeeds(item), tableEntry = null) {
  const list = candidates(item, index).filter(e => !e.enriched)
    .map(e => ({ e, s: scoreBase(needs, e, item).score }))
    .sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
    .slice(0, OFFICIAL_BASES.shortlist).map(x => x.e);
  if (tableEntry && !tableEntry.enriched && !list.includes(tableEntry)) list.push(tableEntry);
  return list;
}

/** Exact-name lookup (trimmed, case-insensitive) in a book pack's plain index entries. */
export function bookEntry(entries, name) {
  const n = String(name ?? "").trim().toLowerCase();
  return n ? (entries ?? []).find(e => String(e.name ?? "").trim().toLowerCase() === n) ?? null : null;
}

/* -------------------------------------------- */
/*  Needs                                       */
/* -------------------------------------------- */

const W = () => OFFICIAL_BASES.weights;

/**
 * Damage in a proc line: "N (to M) School damage", or untyped "N (to M) damage" (dealt as the weapon's own damage
 * type). Shared with convert.mjs.
 */
export const PROC_DAMAGE = /(\d+)(?: to (\d+))? (?:(Fire|Frost|Nature|Shadow|Arcane|Holy) )?damage/i;
const STAT_TAGS = { str: ["stat:str", "score:str", "skill:ath"], dex: ["stat:dex", "score:dex", "init", "stealth", "skill:acr"],
  con: ["stat:con", "score:con", "hpMax"], int: ["stat:int", "score:int", "spell", "skill:arc", "skill:inv"], wis: ["stat:wis", "score:wis", "skill:prc", "hpRegen"] };

/** Classify one Equip / Use / Chance-on-hit line into a need kind (or null: an unknown line, a gap nothing fills). */
export function lineNeed(fx) {
  const t = fx.text;
  if (/(mana|health) (per|every) 5 sec/i.test(t)) return /mana/i.test(t) ? "slotRecovery" : "hpRegen";
  if (/Increased Defense \+\d+|^\+\d+ Armor\.?$/i.test(t) || /chance to (dodge|parry|block)/i.test(t)) return "ac";
  if (/spells and effects by up to/i.test(t)) return "spell";
  if (/chance to hit/i.test(t)) return /spell/i.test(t) ? "spell" : "attack";
  if (/stealth/i.test(t)) return "stealth";
  if (/critical strike/i.test(t)) return "crit";
  if (/\b(Mining|Fishing|Herbalism|Skinning|Lockpicking|Engineering|Enchanting|Alchemy)\b/i.test(t)) return "minor";
  return null;
}

/**
 * What the item's lines ask for. Each need: {key, tags (any one covers it), weight, needed, line, ...}.
 * @param {object} item {p, shape, tier, bonus, riders}
 */
export function itemNeeds(item) {
  const { p, shape, bonus = 0 } = item;
  const w = W(), out = [];
  if (bonus > 0 && ["weapon", "chest", "shield"].includes(shape)) out.push({ key: "plus", tags: ["plus"], weight: w.plus, needed: true, line: `+${bonus}` });
  const stats = Object.entries(p.stats ?? {}).sort((a, b) => b[1] - a[1]);
  const min = Math.max(STAT_RULE.minValue, Math.ceil((p.itemLevel ?? 1) / STAT_RULE.perItemLevel));
  stats.forEach(([ab, v], i) => {
    if (i === 0 && v >= min) out.push({ key: `stat:${ab}`, tags: STAT_TAGS[ab] ?? [`stat:${ab}`], weight: w.mainStat, needed: true, line: p.statLines?.[ab], ability: ab, value: v });
    else out.push({ key: `stat:${ab}`, tags: STAT_TAGS[ab] ?? [], weight: w.secondaryStat, needed: false, line: p.statLines?.[ab], ability: ab, value: v });
  });
  const rmin = Math.max(RESIST_RULE.minValue, Math.ceil((p.itemLevel ?? 1) * RESIST_RULE.perItemLevel));
  for (const [school, v] of Object.entries(p.resist ?? {})) {
    if (school === "All") { out.push({ key: "resist:all", tags: ["saves"], weight: w.smallResist, needed: false, line: `+${v} All Resistances` }); continue; }
    const type = SCHOOL_MAP[school]?.toLowerCase();
    const full = v >= rmin;
    out.push({ key: `resist:${type}`, tags: [`resist:${type}`], weight: full ? w.resist : w.smallResist, needed: full, line: `+${v} ${school} Resistance`, school, value: v, small: !full });
  }
  if (p.extraDamage && SCHOOL_MAP[p.extraDamage.school]) {
    const type = SCHOOL_MAP[p.extraDamage.school].toLowerCase();
    out.push({ key: `damage:${type}`, tags: [`damage:${type}`], weight: w.effect, needed: true, line: p.extraDamage.line, freq: "perTurn", avg: (p.extraDamage.min + p.extraDamage.max) / 2 });
  }
  for (const fx of p.effects ?? []) {
    const dmg = fx.text.match(PROC_DAMAGE);
    if (dmg && (fx.kind === "hit" || /\bchance\b/i.test(fx.text))) {
      const school = dmg[3] ? dmg[3][0].toUpperCase() + dmg[3].slice(1).toLowerCase() : null;
      const type = school ? SCHOOL_MAP[school].toLowerCase() : (item.weaponDamageType ?? "weapon");
      const lo = +dmg[1], hi = dmg[2] ? +dmg[2] : lo;
      const ratio = ((lo + hi) / 2) / Math.max(1, p.damage ? (p.damage.min + p.damage.max) / 2 : 1);
      const freq = ratio < PROC_RULE.critBelow ? "crit" : ratio < PROC_RULE.burstFrom ? "perTurn" : "limited";
      out.push({ key: `damage:${type}`, tags: [`damage:${type}`], weight: w.effect, needed: true, line: fx.line, freq, ratio });
      continue;
    }
    const kind = lineNeed(fx);
    if (kind === "minor" || kind === "crit") { out.push({ key: kind, tags: [kind], weight: w.minor, needed: false, line: fx.line }); continue; }
    if (kind === "spell") {
      const n = Number(fx.text.match(/by up to (\d+)/i)?.[1] ?? 0);
      const smin = Math.max(SPELL_RULE.minValue, Math.ceil((p.itemLevel ?? 1) / SPELL_RULE.perItemLevel));
      if (/spells and effects/i.test(fx.text) && n < smin) { out.push({ key: "spell", tags: ["spell"], weight: w.minor, needed: false, line: fx.line }); continue; }
    }
    out.push({ key: kind ?? `line:${out.length}`, tags: kind ? [kind] : [], weight: w.effect, needed: true, line: fx.line });
  }
  return out;
}

/* -------------------------------------------- */
/*  Candidates, scoring, guard                  */
/* -------------------------------------------- */

/** Slot words of a converted item, comparable with entrySlot(). */
export function itemSlot(item) {
  const { p, shape } = item;
  if (shape === "weapon") return "weapon";
  if (shape === "shield") return "shield";
  if (shape === "wand") return "wand";
  if (shape === "chest") return item.extras?.armor ? "armor" : "Chest";
  if (["Trinket", "Held In Off-hand", "Relic"].includes(p.slot)) return "Trinket";
  return p.slot ?? null;
}

/** Official items that could stand in for this item: same slot (and weapon / armour family), rarity <= the item's. */
export function candidates(item, index) {
  const slot = itemSlot(item);
  if (!slot || !index?.entries) return [];
  // Template-only weapon types (staves): only the +N template, never a specific official item.
  if (slot === "weapon" && OFFICIAL_BASES.templateOnly.includes(item.p?.wowType)) return [];
  const family = item.extras?.base ?? item.armorKey ?? null;
  return index.entries.filter(e => {
    if (e.excluded || e.rarity === null || e.slot !== slot || e.rarity > item.tier) return false;
    if (outOfRule(e, item)) return false;
    if (["weapon", "armor"].includes(slot) && (!e.family || e.family !== family)) return false;
    if (e.rarity === 0 && item.tier > 0 && !e.tags.size) return false; // a plain mundane item is the baseline, not a base
    return true;
  });
}

/**
 * A decided-rule base (VARIANT_BASES "need" rule, by name) outside its rule's quality range is never a free
 * candidate either (e.g. the green / blue slot-recovery base for a purple item, which keeps its own larger rule).
 */
function outOfRule(e, item) {
  const n = String(e.name ?? "").toLowerCase();
  return VARIANT_BASES.some(r => r.kind === "need" && r.name.toLowerCase() === n && (item.tier < (r.minTier ?? 1) || item.tier > (r.maxTier ?? 4)));
}

/** Specific-base strength guard: false when the base's extra damage is far stronger than the item's own line. */
export function strengthGuard(needs, base) {
  const g = OFFICIAL_BASES.guard;
  for (const d of base.damage ?? []) {
    const need = needs.find(n => n.key === `damage:${d.type}`);
    if (!need) return false;
    if ((g.rank[d.freq] ?? 0) - (g.rank[need.freq] ?? 0) > g.maxRankGap) return false;
    if (need.avg && d.avg / need.avg > g.maxDiceRatio && d.freq === "always") return false;
  }
  return true;
}

/** Score and confidence of one base against the needs (rules.mjs OFFICIAL_BASES.score / penalty). */
export function scoreBase(needs, base, item) {
  const { score: S, penalty: P } = OFFICIAL_BASES;
  let covered = 0, gaps = 0, unfilled = 0;
  const coveredKeys = [], gapKeys = [];
  for (const n of needs) {
    if (n.tags.some(t => base.tags.has(t))) { covered += n.weight; coveredKeys.push(n.key); }
    else { gaps += n.weight; gapKeys.push(n.key); if (n.needed) unfilled++; }
  }
  const wanted = new Set(needs.flatMap(n => n.tags));
  const excess = [...base.tags].filter(t => !NEUTRAL.has(t) && !wanted.has(t)).length;
  const below = Math.max(0, item.tier - base.rarity);
  const score = covered - S.gap * gaps - S.excess * excess - S.rarityStep * below - S.sourcePriority * (base.priority ?? 0);
  let confidence = covered / Math.max(1e-9, covered + gaps + P.excessShare * excess);
  confidence *= P.unfilledNeeded ** unfilled;
  if (below >= P.farBelowSteps) confidence *= P.farBelow;
  return { score: round(score), confidence: round(confidence), covered: coveredKeys, gaps: gapKeys, excess };
}

/** The +N weapon / armour / shield template (our own SRD base plus the enhancement bonus; no compendium item). */
export function plusTemplate(item, needs) {
  if (!(item.bonus > 0) || !["weapon", "chest", "shield"].includes(item.shape)) return null;
  const T = OFFICIAL_BASES.template;
  const gaps = needs.filter(n => n.key !== "plus" && n.needed).length;
  const noun = item.shape === "weapon" ? "Weapon" : item.shape === "shield" ? "Shield" : "Armor";
  return {
    uuid: null, name: `${noun} +${item.bonus}`, pack: null, source: "template", plus: item.bonus,
    confidence: gaps >= T.manyGapsFrom ? T.manyGaps : T.confidence, score: OFFICIAL_BASES.weights.plus,
    covered: ["plus"], gaps: needs.filter(n => n.key !== "plus").map(n => n.key), excess: 0
  };
}

/* -------------------------------------------- */
/*  Decided rules (VARIANT_BASES)               */
/* -------------------------------------------- */

/** Main stat big enough for an ability-score base (rules.mjs OFFICIAL_BASES.scoreRule). */
export function bigMainStat(p) {
  const R = OFFICIAL_BASES.scoreRule;
  const [ab, v] = Object.entries(p.stats ?? {}).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!ab) return null;
  return v >= Math.max(R.minValue, Math.ceil((p.itemLevel ?? 1) / R.perItemLevel)) ? ab : null;
}

/**
 * The first VARIANT_BASES rule that applies to the item, resolved against the index; or null.
 * Returns {rule, entry} (entry null for armorName / pattern rules, which need no compendium item).
 */
export function tableBase(item, index, { scoreItems = true, variant = null } = {}) {
  const { p, shape, tier } = item;
  const lookup = name => index?.byName?.get(name.toLowerCase()) ?? null;
  const needs = new Set((p.effects ?? []).map(lineNeed).filter(Boolean));
  const fits = (rule, e, maxRarity = tier) => e && !e.excluded && e.rarity !== null && e.rarity <= maxRarity ? { rule, entry: e } : null;
  for (const rule of VARIANT_BASES) {
    if (rule.slot && rule.slot !== p.slot) continue;
    if (rule.kind === "variant") {
      if (variant === rule.variant || needs.has(rule.variant)) { const hit = fits(rule, lookup(rule.name)); if (hit) return hit; }
    } else if (rule.kind === "need") {
      if (!needs.has(rule.need) || tier < (rule.minTier ?? 1) || tier > (rule.maxTier ?? 4)) continue;
      // Mana lines route to a slot-recovery base only when they became slot recovery (not the Concentration variant).
      if (rule.need === "slotRecovery" && item.riders && !item.riders.some(r => r.type === "slotRecovery")) continue;
      if (rule.pattern) return { rule, entry: null };
      const hit = fits(rule, lookup(rule.name)); if (hit) return hit;
    } else if (rule.kind === "protection") {
      const small = Object.entries(p.resist ?? {}).filter(([s]) => s !== "All");
      if (small.length >= rule.minSchools && tier >= 1) { const hit = fits(rule, lookup(rule.name)); if (hit) return hit; }
    } else if (rule.kind === "wand") {
      if (shape !== "wand" || p.damage?.school !== rule.school || (p.effects ?? []).length) continue;
      const hit = fits(rule, lookup(rule.name)); if (hit) return hit;
    } else if (rule.kind === "armorName") {
      if (shape === "chest" && rule.nameRx.test(p.name)) return { rule, entry: null };
    } else if (rule.kind === "score") {
      if (!scoreItems || bigMainStat(p) !== rule.ability) continue;
      if (rule.belt) {
        const want = OFFICIAL_BASES.beltScore[tier];
        if (!want) continue;
        const belt = (index?.entries ?? []).find(e => !e.excluded && e.name.toLowerCase().startsWith(rule.name.toLowerCase()) && e.scores?.[rule.ability] === want);
        if (belt) return { rule, entry: belt };
        continue;
      }
      const hit = fits(rule, lookup(rule.name), tier - OFFICIAL_BASES.scoreRule.stepsUp); if (hit) return hit;
    }
  }
  return null;
}

/** Official healing potion by item level (POTION_REFLAVOUR names), when the index has it. */
export function potionBase(item, index) {
  const { p } = item;
  if (item.shape !== "consumable" || !(p.effects ?? []).some(e => e.kind === "use" && /^Restores \d+ to \d+ health/i.test(e.text))) return null;
  const row = POTION_REFLAVOUR.find(r => (p.itemLevel ?? 1) <= r.maxIlvl) ?? POTION_REFLAVOUR.at(-1);
  return index?.byName?.get(row.name.toLowerCase()) ?? null;
}

/* -------------------------------------------- */
/*  Decide                                      */
/* -------------------------------------------- */

/** accept / suggest / none for a confidence (thresholds from the baseConfidence setting or rules.mjs). */
export function decide(confidence, thresholds = OFFICIAL_BASES.confidence) {
  if (confidence >= thresholds.accept) return "accept";
  if (confidence >= thresholds.suggest) return "suggest";
  return "none";
}

/** Parse the baseConfidence setting ("0.6" or "0.6, 0.4"); falls back to rules.mjs. */
export function parseConfidence(str) {
  const d = OFFICIAL_BASES.confidence;
  const [a, s] = String(str ?? "").split(/[,/;\s]+/).filter(Boolean).map(Number);
  const accept = Number.isFinite(a) && a > 0 && a <= 1 ? a : d.accept;
  const suggest = Number.isFinite(s) && s >= 0 && s <= accept ? s : Math.min(d.suggest, accept);
  return { accept, suggest };
}

/** Parse a list setting (comma / newline separated). */
export function parseList(str) {
  return String(str ?? "").split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
}

/** True when a source item is hand-made (flag on the item, or its name / uuid / id on the handmadeExclude list). */
export function isHandmade(doc, list = []) {
  if (doc?.flags?.["loot-ledger"]?.handmade === true) return true;
  if (!list.length) return false;
  const keys = new Set(list.map(s => s.toLowerCase()));
  return [doc?.name, doc?.uuid, doc?._id, doc?.id].some(k => k && keys.has(String(k).toLowerCase()));
}

const asBase = (e, extra) => ({ uuid: e.uuid, name: e.name, pack: e.pack, source: "compendium", attune: !!e.attune, plus: 0, slot: e.slot ?? null, ...extra });

/**
 * Match one item.
 * @param {object} item  {p, shape, tier, bonus, riders, extras, armorKey, variant?}
 * @param {object} index indexBases() result (or null: only the +N template can match)
 * @param {object} [o]   {thresholds, scoreItems, noTable (skip VARIANT_BASES)}
 * @returns {{status:"accept"|"suggest"|"none", base:object|null, candidates:object[], needs:object[], pattern?:string, armorBase?:string}}
 */
export function matchBase(item, index, { thresholds = OFFICIAL_BASES.confidence, scoreItems = true, noTable = false } = {}) {
  const needs = itemNeeds(item);
  if (item.tier < 1) return { status: "none", base: null, candidates: [], needs, baseline: true };
  const potion = potionBase(item, index);
  if (potion) return { status: "accept", base: asBase(potion, { confidence: 1, covered: ["heal"], excess: 0 }), candidates: [], needs };
  const table = noTable ? null : tableBase(item, index, { scoreItems, variant: item.variant ?? null });
  if (table?.rule.kind === "armorName") return { ...matchBase({ ...item, armorKey: table.rule.armorBase }, index, { thresholds, scoreItems: false, noTable: true }), armorBase: table.rule.armorBase };
  if (table?.rule.pattern) return { status: "none", base: null, candidates: [], needs, pattern: table.rule.name };
  if (table?.entry) {
    const s = scoreBase(needs, table.entry, item);
    const confidence = Math.max(s.confidence, OFFICIAL_BASES.tableConfidence);
    return { status: decide(confidence, thresholds), base: asBase(table.entry, { confidence, covered: s.covered, excess: s.excess, rule: table.rule.kind }), candidates: [], needs,
      shortlist: table.entry.enriched ? [] : [table.entry] };
  }
  const scored = candidates(item, index).filter(e => strengthGuard(needs, e))
    .map(e => ({ entry: e, ...scoreBase(needs, e, item) }))
    .filter(c => c.covered.length);
  const tpl = plusTemplate(item, needs);
  const all = [...scored.map(c => asBase(c.entry, { confidence: c.confidence, score: c.score, covered: c.covered, gaps: c.gaps, excess: c.excess })), ...(tpl ? [tpl] : [])]
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.name.localeCompare(b.name));
  const best = all[0] ?? null;
  const status = best ? decide(best.confidence, thresholds) : "none";
  return { status, base: status === "none" ? null : best, candidates: all.slice(0, 3), needs, shortlist: index ? shortlist(item, index, needs) : [] };
}

/**
 * Which riders the base does not cover: these become the item's gap-fills (one extra Active Effect).
 * @returns {object[]} riders left over
 */
export function uncoveredRiders(riders, base) {
  if (!base) return riders;
  if (base.source === "template") return riders;
  const tags = base.tags ?? new Set(base.covered ?? []);
  // A wand base already is the wand's attack: the fallback cantrip is never added on top of it.
  return riders.filter(r => !(r.type === "cantrip" && base.slot === "wand") && !riderTags(r).some(t => tags.has(t)));
}

/** Tags a rider would be covered by. */
export function riderTags(r) {
  switch (r.type) {
    case "resistance": return [`resist:${r.damageType}`];
    case "acBonus": return ["ac"];
    case "saveBonus": case "checkBonus": return [`stat:${r.ability}`];
    case "spellBonus": case "healBonus": return ["spell"];
    case "attackBonus": return ["attack"];
    case "statPassive": return STAT_TAGS[r.ability] ?? [];
    case "variant": return [VARIANT_TAGS[r.variant] ?? r.variant];
    case "regeneration": return ["hpRegen"];
    case "critDice": return ["crit"];
    case "flavour": return ["minor"];
    case "extraDamage": case "burstDamage": return [`damage:${r.damageType}`];
    default: return [r.type];
  }
}

/**
 * Hook after base selection. The stat variant and the line rules run in the converter before matching (the variant
 * is passed in as item.variant, so tableBase can route it); here a match is only annotated: a protection item with no
 * protection base found goes to GM review. Collapse keys (phase 3) use variants.gapFillSignature().
 */
export function variantStep(match, item = {}, ctx = null) {
  if (ctx?.extras?.protection && !(match?.base?.rule === "protection" && match.status === "accept")) {
    ctx.review.push({ line: "Resistances", why: "several small resistances on a ring or cloak use the protection base; none was found in your compendiums" });
    ctx.flagged?.push({ kind: "protection", why: "protection base not found" });
  }
  // A green / blue health-regen line was sent to review by the converter; a found wound-closure base answers it.
  if (ctx?.review?.length && match?.status === "accept" && match.base?.rule === "need" && match.base.covered?.includes("hpRegen")) {
    ctx.review = ctx.review.filter(r => !/^health regeneration at this rarity/.test(r.why));
    ctx.flagged = (ctx.flagged ?? []).filter(f => f.kind !== "healthRegen");
  }
  return match;
}

function round(n) { return Math.round(n * 1000) / 1000; }
