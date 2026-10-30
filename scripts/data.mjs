/**
 * Static data and pure helpers: quality, level bands, item parsing, prices.
 * Nothing in this file touches Foundry documents, so it can be unit-tested in isolation.
 */

export const MODULE_ID = "loot-ledger";
export const SOURCE_MODULE = "wow-classic-items";
export const SOURCE_PACK = "wow-classic-items.items";

import { RARITY_BY_QUALITY, DROP_WEIGHT, PRICE_RULE } from "./rules.mjs";

/** Item quality, ordered low → high. `color` is the tooltip title colour used by the source data. */
/** Rarity and mixed-drop weight come from rules.mjs (RARITY_BY_QUALITY, DROP_WEIGHT). */
export const QUALITIES = [
  { key: "poor",      label: "Poor",      color: "#9d9d9d" },
  { key: "common",    label: "Common",    color: "#ffffff" },
  { key: "uncommon",  label: "Uncommon",  color: "#1eff00" },
  { key: "rare",      label: "Rare",      color: "#0070dd" },
  { key: "epic",      label: "Epic",      color: "#a335ee" },
  { key: "legendary", label: "Legendary", color: "#ff8000" },
  { key: "artifact",  label: "Artifact",  color: "#e6cc80" }
].map(q => ({ ...q, rarity: RARITY_BY_QUALITY[q.key], weight: DROP_WEIGHT[q.key] }));
export const QUALITY_BY_KEY = Object.fromEntries(QUALITIES.map(q => [q.key, q]));
/** Qualities that get per-band quality tables and feed the mixed "Drop" tables. */
export const DROP_QUALITIES = ["poor", "common", "uncommon", "rare", "epic"];

/**
 * Item-level bands and the D&D character levels they roughly correspond to (1–20 game).
 * Items without an item level fall back to their required level.
 */
export const BANDS = [
  { band: 1, min: 1,  max: 10,       levels: "L1–3",   charMin: 1,  charMax: 2 },
  { band: 2, min: 11, max: 20,       levels: "L3–5",   charMin: 3,  charMax: 4 },
  { band: 3, min: 21, max: 30,       levels: "L5–7",   charMin: 5,  charMax: 6 },
  { band: 4, min: 31, max: 40,       levels: "L7–9",   charMin: 7,  charMax: 8 },
  { band: 5, min: 41, max: 50,       levels: "L9–11",  charMin: 9,  charMax: 10 },
  { band: 6, min: 51, max: 60,       levels: "L11–14", charMin: 11, charMax: 14 },
  { band: 7, min: 61, max: Infinity, levels: "L15+",   charMin: 15, charMax: 20 }
];

/** Map a D&D character level (1–20) to a band number. */
export function bandForLevel(level) {
  const l = Math.max(1, Math.floor(Number(level) || 1));
  return (BANDS.find(b => l >= b.charMin && l <= b.charMax) ?? BANDS.at(-1)).band;
}

/** Map an item level to a band number. */
export function bandForItemLevel(ilvl) {
  const l = Math.max(1, Math.floor(Number(ilvl) || 1));
  return (BANDS.find(b => l >= b.min && l <= b.max) ?? BANDS.at(-1)).band;
}

export function bandLabel(band) {
  const b = BANDS.find(x => x.band === band);
  return `Band ${band} (${b?.levels ?? "?"})`;
}

/** Item-type categories used for the "by type" tables. Order = table sort order. */
export const CATEGORIES = [
  { key: "weapon",      label: "Weapons" },
  { key: "armor-head",  label: "Armour · Head & Shoulders" },
  { key: "armor-body",  label: "Armour · Chest & Legs" },
  { key: "armor-limbs", label: "Armour · Hands, Wrists, Waist & Feet" },
  { key: "armor-back",  label: "Armour · Cloaks" },
  { key: "shield",      label: "Shields" },
  { key: "jewelry",     label: "Jewellery & Trinkets" },
  { key: "consumable",  label: "Consumables" },
  { key: "goods",       label: "Trade Goods & Bags" },
  { key: "junk",        label: "Junk" }
];

const SLOTS = new Set([
  "Head", "Neck", "Shoulder", "Back", "Chest", "Shirt", "Tabard", "Wrist", "Hands", "Waist", "Legs",
  "Feet", "Finger", "Trinket", "Main Hand", "Off Hand", "One-Hand", "Two-Hand", "Held In Off-hand",
  "Ranged", "Thrown", "Relic", "Projectile", "Ammo"
]);
const SLOT_GROUP = {
  Head: "armor-head", Shoulder: "armor-head",
  Chest: "armor-body", Legs: "armor-body", Shirt: "armor-body", Tabard: "armor-body",
  Hands: "armor-limbs", Wrist: "armor-limbs", Waist: "armor-limbs", Feet: "armor-limbs",
  Back: "armor-back",
  Neck: "jewelry", Finger: "jewelry", Trinket: "jewelry", "Held In Off-hand": "jewelry", Relic: "jewelry"
};
const WEAPON_SLOTS = new Set(["Main Hand", "Off Hand", "One-Hand", "Two-Hand", "Ranged", "Thrown", "Projectile", "Ammo"]);

/** Placeholder / internal entries that should never appear on loot tables. */
const EXCLUDE_NAME = /^(OLD|Test |TEST |Deprecated|Monster - |\[PH\])|\(PT\)|Stationery|Wrapping Paper/;

/** Split the source tooltip HTML into plain text lines. */
export function tooltipLines(html) {
  if (!html) return [];
  return html
    .split(/<\/(?:div|span|p|li)>|<br\s*\/?>/i)
    .map(s => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim())
    .filter(Boolean);
}

/** Read the item quality from the tooltip title colour, falling back to the source rarity. */
export function qualityOf(src) {
  const html = src.system?.description?.value ?? "";
  const m = html.match(/color:\s*(#[0-9a-f]{6});\s*font-size:\s*1\.08em/i);
  if (m) {
    const q = QUALITIES.find(x => x.color === m[1].toLowerCase());
    if (q) return q.key;
  }
  const r = src.flags?.[SOURCE_MODULE]?.rarity || src.system?.rarity;
  return { uncommon: "uncommon", rare: "rare", veryRare: "epic", legendary: "legendary", artifact: "artifact" }[r] ?? "common";
}

/** Total vendor sell price in copper (100 c = 1 s, 100 s = 1 g), or 0. */
export function vendorCopperOf(src) {
  const vp = src.flags?.[SOURCE_MODULE]?.vendorPrice;
  if (!vp) return 0;
  const total = Number(vp.totalCopper ?? ((vp.gold ?? 0) * 10000 + (vp.silver ?? 0) * 100 + (vp.copper ?? 0)));
  return Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
}

/** "1g 2s 3c" style text for a copper amount. */
export function formatCoins(copper) {
  const c = Math.max(0, Math.round(copper));
  if (!c) return "0c";
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), r = c % 100;
  return [g && `${g}g`, s && `${s}s`, r && `${r}c`].filter(Boolean).join(" ");
}

/**
 * dnd5e price for an item so that selling it at half price yields the vendor sell price.
 *
 * The value is stored in the largest denomination it reaches, with decimals, so mixed amounts read
 * naturally instead of as one large copper number: 1g 46s 72c listed (2 x 73s 36c sell) is stored as
 * 1.4672 gp, 46s 72c as 46.72 sp, 72c as 72 cp. dnd5e accepts decimal prices; the item sheet and chat
 * show the exact value, the actor inventory column rounds to 3 decimals. Multiplying the value by the
 * denomination's conversion gives back the exact copper amount (round to the nearest integer to absorb
 * floating-point noise).
 * @param {number} copper   vendor sell price in classic copper
 * @param {"100"|"10"} ratio coin ratio setting
 * @returns {{value:number, denomination:string}}
 */
export function priceFor(copper, ratio = "100") {
  if (!copper) return { value: 0, denomination: "gp" };
  // c = listed price in the smallest coin; step = coins per next denomination (100:1 or 10:1).
  // Multiplier and minimum come from rules.mjs (PRICE_RULE).
  const k = PRICE_RULE.sellMultiplier;
  const [c, step] = ratio === "10"
    // Convert by value: 1 classic gold = 1 gp, so 1 classic silver = 1 cp. Round to the nearest cp (min tenToOneMinCp).
    ? [k * Math.max(PRICE_RULE.tenToOneMinCp, Math.round(copper / 100)), 10]
    : [k * copper, 100];
  const digits = String(step).length - 1; // decimals per denomination step
  if (c >= step * step) return { value: Number((c / (step * step)).toFixed(digits * 2)), denomination: "gp" };
  if (c >= step) return { value: Number((c / step).toFixed(digits)), denomination: "sp" };
  return { value: c, denomination: "cp" };
}

/**
 * Derive everything the module needs from one source item (plain object or document).
 */
export function analyse(src) {
  const html = src.system?.description?.value ?? "";
  const lines = tooltipLines(html);
  let itemLevel = null, requiredLevel = null, slot = null;
  for (const l of lines) {
    let m;
    if (itemLevel === null && (m = l.match(/^Item Level (\d+)/))) itemLevel = Number(m[1]);
    else if (requiredLevel === null && (m = l.match(/^Requires Level (\d+)/))) requiredLevel = Number(m[1]);
    else if (slot === null && SLOTS.has(l)) slot = l;
  }
  const quality = qualityOf(src);
  const vendorSellCopper = vendorCopperOf(src);
  const type = src.type;
  const sysType = src.system?.type?.value ?? "";
  const subType = src.system?.type?.baseItem ?? "";

  let category;
  const equippable = type === "weapon" || type === "equipment";
  if (quality === "poor" && !(equippable && slot)) category = "junk";
  else if (sysType === "shield" || subType === "shield") category = "shield";
  else if (slot && SLOT_GROUP[slot]) category = SLOT_GROUP[slot];
  else if (type === "weapon" || sysType === "wand" || (slot && WEAPON_SLOTS.has(slot))) category = "weapon";
  else if (type === "consumable") category = "consumable";
  else if (type === "loot" || type === "container") category = "goods";
  else if (equippable && ["ring", "trinket", "wondrous", "rod"].includes(sysType)) category = "jewelry";
  else category = "goods";

  const level = itemLevel ?? requiredLevel ?? 1;
  const noSell = vendorSellCopper <= 0;
  // Unsellable non-gear (quest items, internal placeholders) is copied but never rolled.
  const rollable = !EXCLUDE_NAME.test(src.name ?? "") && !(noSell && !equippable);
  return {
    quality, itemLevel, requiredLevel, slot, category, vendorSellCopper, noSell,
    band: bandForItemLevel(level), rollable
  };
}

/**
 * Creature-type junk keyword lists (matched at word starts, case-insensitive, against grey junk items).
 * `gear: true` also adds the band's grey (poor) weapons and armour, for creatures that carry equipment.
 */
export const CREATURES = [
  { key: "beast", label: "Beast", keywords: ["fang", "claw", "talon", "pelt", "hide", "fur", "hair", "tooth", "teeth", "tusk", "horn", "scale", "feather", "beak", "bill", "paw", "tail", "flank", "mane", "wing", "eye", "heart", "gland", "bladder", "carcass", "whisker", "palp", "limb", "web", "shell", "venom", "spine", "meat", "egg", "skin", "sinew", "antler", "hoof", "snout", "stinger", "mandible", "chitin", "carapace", "ear"] },
  { key: "humanoid", label: "Humanoid", gear: true, keywords: ["watch", "bauble", "doll", "diary", "page", "letter", "boot", "glove", "belt", "candle", "barrel", "mug", "flask", "bottle", "cup", "pipe", "dice", "comb", "spoon", "fork", "coin", "locket", "button", "buckle", "trinket", "map", "book", "note", "toy", "collar", "rag", "tooth", "gold", "silver", "copper", "pouch"] },
  { key: "undead", label: "Undead", keywords: ["bone", "skull", "rib", "femur", "jawbone", "dust", "ash", "ectoplasm", "shroud", "rot", "decay", "grave", "coffin", "tomb", "flesh", "maggot", "ichor", "embalm", "skeletal", "ghost", "spectral", "lifeless", "ancient"] },
  { key: "elemental", label: "Elemental", keywords: ["elemental", "ember", "ash", "stone", "pebble", "rock", "crystal", "shard", "earth", "water", "flame", "fire", "frost", "ice", "cinder", "sand", "slime", "ooze", "essence", "mote", "core", "chip", "salt", "charged", "smooth", "molten", "storm"] },
  { key: "dragonkin", label: "Dragonkin", keywords: ["dragon", "drake", "whelp", "molting", "wyrm", "brood"] },
  { key: "demon", label: "Demon", keywords: ["demon", "fel", "imp", "infernal", "satyr", "horn", "hoof", "sulfur", "brimstone", "shadow", "void", "familiar"] },
  { key: "giant", label: "Giant", keywords: ["giant", "ogre", "boulder", "stone", "rock", "toe", "knuckle", "club", "huge", "massive", "large", "thick"] },
  { key: "mechanical", label: "Mechanical", keywords: ["gear", "cog", "bolt", "spring", "sprocket", "scrap", "metal", "iron", "gizmo", "gadget", "widget", "mechanical", "rust", "wire", "watch", "bracket", "flywheel", "barrel", "copper"] }
];

export function creatureRegex(creature) {
  const c = typeof creature === "string" ? CREATURES.find(x => x.key === creature) : creature;
  return new RegExp(`\\b(${c.keywords.join("|")})`, "i");
}
