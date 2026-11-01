/**
 * Item tooltip: pure model building and HTML rendering. No Foundry globals are read here; the caller passes the dnd5e
 * config, a localize function and the coin table, so this file can be unit-tested in Node (tests/tooltip-data.test.mjs).
 */

/** Tooltip rarity tiers, low → high. `quality` is the matching Loot Ledger quality key. */
export const TIERS = ["mundane", "common", "uncommon", "rare", "veryRare", "legendary", "artifact"];

/** Loot Ledger quality → tooltip tier. */
const QUALITY_TIER = { poor: "mundane", common: "common", uncommon: "uncommon", rare: "rare", epic: "veryRare", legendary: "legendary", artifact: "artifact" };

/** Item types the tooltip handles (physical dnd5e items). */
export const TOOLTIP_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

const BODY_ARMOR = new Set(["light", "medium", "heavy"]);

/** Escape text for HTML. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Read a label that may be a string or `{label}` and localize it. */
function lbl(entry, t) {
  if (entry == null) return "";
  const s = typeof entry === "string" ? entry : (entry.label ?? "");
  return s ? t(s) : "";
}

/** A Set, array or object-of-booleans as an array of keys. */
function keysOf(v) {
  if (!v) return [];
  if (v instanceof Set || Array.isArray(v)) return [...v];
  if (typeof v === "object") return Object.entries(v).filter(([, on]) => on).map(([k]) => k);
  return [];
}

/** Numeric value of a deterministic formula field, or 0. */
export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Rarity tier of an item: Loot Ledger quality flag first, then dnd5e rarity (v6 `rarities` set or v5 `rarity`). */
export function tierOf(item) {
  const q = item?.flags?.["loot-ledger"]?.quality;
  if (q && QUALITY_TIER[q]) return QUALITY_TIER[q];
  const sys = item?.system ?? {};
  const r = sys.rarity ?? keysOf(sys.rarities)[0] ?? "";
  return TIERS.includes(r) && r !== "mundane" ? r : "mundane";
}

/**
 * Plain text excerpt of an item description: drops the Loot Ledger sell line, unwraps enrichers, strips tags and entities,
 * collapses whitespace and cuts at a word boundary. Returns text, never HTML; the renderer escapes it.
 */
export function excerpt(html, max = 220) {
  let s = String(html ?? "");
  s = s.replace(/<p[^>]*class="[^"]*loot-ledger-sell[^"]*"[^>]*>[\s\S]*?<\/p>/gi, " ");
  s = s.replace(/<(script|style|template)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@\w+\[([^\]]*)\]/g, (_, ref) => ref.split(/[.|]/).pop());
  s = s.replace(/\[\[\/?\w*\s*([^\]]*)\]\](?:\{([^}]*)\})?/g, (_, inner, label) => label ?? inner);
  s = s.replace(/<\/(p|div|li|h\d|tr)>|<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&\w+;/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

/**
 * Item price in the smallest coin, using the dnd5e currency conversions (relative to gp: gp 1, sp 10 or 100, cp 100 or 10000).
 * @returns {{copper:number, step:number}} step = coins per next denomination (10 or 100)
 */
export function priceCopper(price, currencies, ratio = "100") {
  const fallbackStep = ratio === "10" ? 10 : 100;
  const conv = k => num(currencies?.[k]?.conversion);
  const cp = conv("cp") || fallbackStep * fallbackStep;
  const sp = conv("sp") || fallbackStep;
  const step = Math.round(cp / sp) || fallbackStep;
  const value = num(price?.value);
  const denom = price?.denomination || "gp";
  const d = conv(denom) || (denom === "sp" ? sp : denom === "cp" ? cp : 1);
  return { copper: value > 0 ? Math.round((value * cp) / d) : 0, step };
}

/** "1g 2s 3c" for a copper amount with the given coin step (100 by Loot Ledger's default, 10 for standard 5e). */
export function formatGsc(copper, step = 100) {
  const c = Math.max(0, Math.round(copper));
  if (!c) return "";
  const g = Math.floor(c / (step * step)), s = Math.floor((c % (step * step)) / step), r = c % step;
  return [g && `${g}g`, s && `${s}s`, r && `${r}c`].filter(Boolean).join(" ");
}

/** Whether magical bonuses apply (dnd5e requires the Magical property). */
function magical(sys) {
  return keysOf(sys.properties).includes("mgc");
}

/** Magical bonus of a weapon or armor/shield, 0 when none or not magical. */
export function magicalBonusOf(item) {
  const sys = item?.system ?? {};
  if (!magical(sys)) return 0;
  return item.type === "weapon" ? num(sys.magicalBonus) : num(sys.armor?.magicalBonus);
}

/** Base damage part of a weapon as {formula, average, types}. */
export function damageOf(item, dnd5e = {}, t = s => s) {
  const sys = item?.system ?? {};
  const base = sys.damage?.base;
  if (item?.type !== "weapon" || !base) return null;
  const bonus = magicalBonusOf(item);
  const types = keysOf(base.types).map(k => lbl(dnd5e.damageTypes?.[k], t) || k);
  if (base.custom?.enabled && base.custom.formula) {
    return { formula: base.custom.formula + (bonus ? ` + ${bonus}` : ""), average: null, types };
  }
  const n = num(base.number), d = num(base.denomination), flat = num(base.bonus) + bonus;
  if (!n || !d) return flat ? { formula: String(flat), average: flat, types } : null;
  const formula = `${n}d${d}${flat ? ` ${flat > 0 ? "+" : "−"} ${Math.abs(flat)}` : ""}`;
  return { formula, average: (n * (d + 1)) / 2 + flat, types };
}

/** AC an item grants (body armor: base AC; shield: its bonus), magical bonus included once. */
export function acOf(item) {
  const sys = item?.system ?? {};
  if (item?.type !== "equipment") return null;
  const type = sys.type?.value;
  if (!BODY_ARMOR.has(type) && type !== "shield") return null;
  const value = num(sys.armor?.value);
  // Prepared documents already add the magical bonus to armor.value (dnd5e EquipmentData.prepareDerivedData); plain source data does not.
  return item.documentName ? value : value + magicalBonusOf(item);
}

/**
 * Equipment slot key used for comparison, or null when the item does not occupy a comparable slot.
 * Body armor → "armor", shields → "shield", weapons → "weapon-melee" / "weapon-ranged", rings → "ring";
 * other equipment uses Loot Ledger's `slot` flag when both items carry it.
 */
export function slotOf(item) {
  const sys = item?.system ?? {};
  const type = sys.type?.value ?? "";
  if (item?.type === "weapon") return /R$/.test(type) ? "weapon-ranged" : "weapon-melee";
  if (item?.type !== "equipment") return null;
  if (BODY_ARMOR.has(type)) return "armor";
  if (type === "shield") return "shield";
  if (type === "ring") return "ring";
  const flag = item.flags?.["loot-ledger"]?.slot;
  return flag ? `ll:${String(flag).toLowerCase()}` : null;
}

/** The equipped item of `items` that fills the same slot as `item` (not `item` itself), or null. */
export function equippedInSlot(item, items) {
  const slot = slotOf(item);
  if (!slot) return null;
  for (const other of items ?? []) {
    if (!other || other === item || (other.id && other.id === item.id && other.parent && other.parent === item.parent)) continue;
    if (!other.system?.equipped) continue;
    if (slotOf(other) === slot) return other;
  }
  return null;
}

/** Comparison rows (hovered vs equipped): only stats that both items have or that differ from zero. */
export function compare(item, equipped) {
  if (!item || !equipped) return [];
  const rows = [];
  const push = (key, a, b) => {
    if (a == null && b == null) return;
    const delta = (a ?? 0) - (b ?? 0);
    rows.push({ key, value: a ?? 0, other: b ?? 0, delta: Math.round(delta * 10) / 10 });
  };
  const acA = acOf(item), acB = acOf(equipped);
  if (acA != null || acB != null) push("ac", acA, acB);
  const bA = magicalBonusOf(item), bB = magicalBonusOf(equipped);
  if (bA || bB) push("bonus", bA, bB);
  const dA = damageOf(item)?.average, dB = damageOf(equipped)?.average;
  if (dA != null || dB != null) push("damage", dA, dB);
  return rows;
}

/** Type line (left) and slot/subtype text (right). */
function typeLine(item, dnd5e, t) {
  const sys = item.system ?? {};
  const v = sys.type?.value, sub = sys.type?.subtype;
  const typeLabel = t(`TYPES.Item.${item.type}`);
  const llSlot = item.flags?.["loot-ledger"]?.slot ?? "";
  switch (item.type) {
    case "weapon": return { left: lbl(dnd5e.weaponTypes?.[v], t) || typeLabel, right: llSlot };
    case "equipment": {
      if (BODY_ARMOR.has(v)) return { left: `${t("LOOTLEDGER.Tooltip.Armor")} (${lbl(dnd5e.armorTypes?.[v], t)})`, right: llSlot };
      return { left: lbl(dnd5e.equipmentTypes?.[v], t) || typeLabel, right: llSlot };
    }
    case "consumable": {
      const c = dnd5e.consumableTypes?.[v];
      return { left: lbl(c, t) || typeLabel, right: sub ? lbl(c?.subtypes?.[sub], t) : "" };
    }
    case "tool": return { left: lbl(dnd5e.toolTypes?.[v], t) || typeLabel, right: "" };
    case "loot": return { left: lbl(dnd5e.lootTypes?.[v], t) || typeLabel, right: "" };
    default: return { left: typeLabel, right: "" };
  }
}

/**
 * Build the tooltip model for one item.
 * @param {object} item  dnd5e Item (document or plain data with type, name, system, flags)
 * @param {object} ctx
 * @param {object}   ctx.dnd5e      CONFIG.DND5E (or a subset)
 * @param {(key:string)=>string} ctx.t  localize
 * @param {string}   [ctx.ratio]    Loot Ledger coin ratio setting ("100" | "10"), used when currencies lack conversions
 * @param {boolean}  [ctx.isGM]     GMs see unidentified items' real details
 * @param {object}   [ctx.equipped] equipped item in the same slot, for the compare section
 */
export function buildModel(item, { dnd5e = {}, t = s => s, ratio = "100", isGM = false, equipped = null } = {}) {
  const sys = item.system ?? {};
  const hidden = sys.identified === false && !isGM;
  const tier = hidden ? "mundane" : tierOf(item);
  const model = {
    name: hidden ? (sys.unidentified?.name || item.name) : item.name,
    img: item.img ?? "",
    tier,
    rarity: tier === "mundane" ? "" : lbl(dnd5e.itemRarity?.[tier], t),
    type: typeLine(item, dnd5e, t),
    stats: [],
    properties: [],
    lines: [],
    description: "",
    price: "",
    sell: "",
    weight: "",
    compare: []
  };

  if (!hidden) {
    const dmg = damageOf(item, dnd5e, t);
    if (dmg) model.stats.push({ key: "damage", text: `${dmg.formula}${dmg.types.length ? ` ${dmg.types.join(" / ")}` : ""}` });
    if (item.type === "weapon") {
      const vers = sys.damage?.versatile;
      if (keysOf(sys.properties).includes("ver") && num(vers?.number) && num(vers?.denomination)) {
        model.stats.push({ key: "versatile", text: `${t("LOOTLEDGER.Tooltip.Versatile")} ${num(vers.number)}d${num(vers.denomination)}` });
      }
      const r = sys.range ?? {};
      if (num(r.value)) model.stats.push({ key: "range", text: `${t("LOOTLEDGER.Tooltip.Range")} ${num(r.value)}${num(r.long) ? `/${num(r.long)}` : ""} ${r.units ?? ""}`.trim() });
      if (sys.mastery) model.properties.push(`${t("LOOTLEDGER.Tooltip.Mastery")}: ${lbl(dnd5e.weaponMasteries?.[sys.mastery], t) || sys.mastery}`);
    }
    const ac = acOf(item);
    if (ac != null) {
      const shield = sys.type?.value === "shield";
      let text = shield ? `+${ac} ${t("LOOTLEDGER.Tooltip.AC")}` : `${ac} ${t("LOOTLEDGER.Tooltip.AC")}`;
      const dex = sys.armor?.dex;
      if (!shield && sys.type?.value !== "heavy" && dex != null && dex !== "") text += ` (${t("LOOTLEDGER.Tooltip.MaxDex")} ${num(dex)})`;
      model.stats.push({ key: "ac", text });
      if (num(sys.strength)) model.lines.push(`${t("LOOTLEDGER.Tooltip.Strength")} ${num(sys.strength)}`);
    }
    const bonus = magicalBonusOf(item);
    if (bonus) model.lines.push({ key: "bonus", text: `+${bonus} ${t("LOOTLEDGER.Tooltip.MagicalBonus")}` });

    const props = dnd5e.itemProperties ?? {};
    for (const k of keysOf(sys.properties)) {
      if (k === "mgc") continue;
      const label = lbl(props[k], t);
      if (label) model.properties.push(label);
    }
    if (keysOf(sys.properties).includes("mgc")) model.properties.unshift(lbl(props.mgc, t) || t("LOOTLEDGER.Tooltip.Magical"));

    if (sys.attunement) {
      const att = lbl(dnd5e.attunementTypes?.[sys.attunement], t) || t("LOOTLEDGER.Tooltip.Attunement");
      model.lines.push({ key: "attune", text: sys.attuned ? `${att} (${t("LOOTLEDGER.Tooltip.Attuned")})` : att });
    }

    const uses = sys.uses ?? {};
    const max = num(uses.max);
    if (max > 0) {
      const value = uses.value != null ? num(uses.value) : Math.max(0, max - num(uses.spent));
      const period = keysOf(uses.recovery?.map?.(r => r?.period)).filter(Boolean)[0];
      const per = period ? lbl(dnd5e.limitedUsePeriods?.[period], t) : "";
      model.lines.push({ key: "uses", text: `${t("LOOTLEDGER.Tooltip.Charges")}: ${value}/${max}${per ? ` (${per})` : ""}` });
    }
  }

  model.lines = model.lines.map(l => (typeof l === "string" ? { key: "line", text: l } : l));
  model.description = excerpt(hidden ? sys.unidentified?.description : sys.description?.value);

  const { copper, step } = priceCopper(sys.price, dnd5e.currencies, item.flags?.["loot-ledger"]?.coinRatio ?? ratio);
  model.price = formatGsc(copper, step);
  const sell = item.flags?.["loot-ledger"];
  if (sell?.vendorSell && !sell.noSell) model.sell = String(sell.vendorSell);

  const w = sys.weight;
  const wv = typeof w === "object" ? num(w?.value) : num(w);
  if (wv > 0) {
    const units = typeof w === "object" ? w.units : "";
    const abbr = units ? (dnd5e.weightUnits?.[units]?.abbreviation ? t(dnd5e.weightUnits[units].abbreviation) : units) : "";
    model.weight = `${Math.round(wv * 100) / 100}${abbr ? ` ${abbr}` : ""}`;
  }
  const qty = num(sys.quantity);
  if (qty > 1) model.quantity = qty;

  if (equipped && !hidden) model.compare = compare(item, equipped).map(r => ({ ...r, otherName: equipped.name }));
  return model;
}

/** Render a model to HTML (all text escaped). */
export function renderModel(m, t = s => s) {
  const row = (cls, html) => `<div class="ll-tt-${cls}">${html}</div>`;
  const parts = [];
  parts.push(`<div class="ll-tt-name ll-tier-${esc(m.tier)}">${esc(m.name)}${m.quantity ? ` <span class="ll-tt-qty">×${esc(m.quantity)}</span>` : ""}</div>`);
  if (m.rarity) parts.push(row("rarity", `<span class="ll-tier-${esc(m.tier)}">${esc(m.rarity)}</span>`));
  if (m.type.left || m.type.right) parts.push(row("type", `<span>${esc(m.type.left)}</span><span>${esc(m.type.right)}</span>`));
  for (const s of m.stats) parts.push(row(`stat ll-tt-${esc(s.key)}`, esc(s.text)));
  if (m.properties.length) parts.push(row("props", esc(m.properties.join(", "))));
  for (const l of m.lines) parts.push(row(`line ll-tt-${esc(l.key)}`, esc(l.text)));
  if (m.description) parts.push(row("desc", esc(m.description)));
  const foot = [];
  if (m.price) foot.push(`<span>${esc(t("LOOTLEDGER.Tooltip.Price"))}: ${esc(m.price)}</span>`);
  if (m.sell) foot.push(`<span>${esc(t("LOOTLEDGER.Tooltip.Sells"))}: ${esc(m.sell)}</span>`);
  if (m.weight) foot.push(`<span>${esc(t("LOOTLEDGER.Tooltip.Weight"))}: ${esc(m.weight)}</span>`);
  if (foot.length) parts.push(row("foot", foot.join("")));
  if (m.compare.length) {
    const label = { ac: "LOOTLEDGER.Tooltip.AC", bonus: "LOOTLEDGER.Tooltip.MagicalBonus", damage: "LOOTLEDGER.Tooltip.AvgDamage" };
    const rows = m.compare.map(c => {
      const dir = c.delta > 0 ? "up" : c.delta < 0 ? "down" : "same";
      const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "=";
      const delta = c.delta ? ` ${c.delta > 0 ? "+" : "−"}${Math.abs(c.delta)}` : "";
      return `<li class="ll-cmp-${dir}"><span>${esc(t(label[c.key]))}</span><span>${arrow}${esc(delta)}</span></li>`;
    }).join("");
    parts.push(`<div class="ll-tt-compare"><div class="ll-tt-cmp-head">${esc(t("LOOTLEDGER.Tooltip.CompareWith"))} ${esc(m.compare[0].otherName)}</div><ul>${rows}</ul></div>`);
  }
  return parts.join("");
}
