/**
 * Quality colours, pure logic (no Foundry calls; unit-tested in Node): which quality an item shows, and the CSS
 * class for it. An explicit quality (flags["loot-ledger"].quality, written by Build or set by hand) always wins;
 * otherwise, when the fallback is on, the dnd5e rarity picks a colour.
 */

/** Every quality that has a colour, low -> high. Keys match the ones Build stores (data.mjs QUALITIES) plus heirloom. */
export const COLOUR_QUALITIES = [
  { key: "poor",      label: "Poor (grey)" },
  { key: "common",    label: "Common (white)" },
  { key: "uncommon",  label: "Uncommon (green)" },
  { key: "rare",      label: "Rare (blue)" },
  { key: "epic",      label: "Epic (purple)" },
  { key: "legendary", label: "Legendary (orange)" },
  { key: "artifact",  label: "Artifact (gold)" },
  { key: "heirloom",  label: "Heirloom (light blue)" }
];
const KEYS = new Set(COLOUR_QUALITIES.map(q => q.key));

/** Other names people (and other modules) use for the same qualities. */
const ALIASES = {
  grey: "poor", gray: "poor", junk: "poor", trash: "poor",
  white: "common", normal: "common",
  green: "uncommon",
  blue: "rare",
  purple: "epic", veryrare: "epic", "very rare": "epic", "very-rare": "epic",
  orange: "legendary",
  gold: "artifact", golden: "artifact",
  "light blue": "heirloom", lightblue: "heirloom", account: "heirloom"
};

/** A quality key from any accepted spelling, or null (empty / unknown / "none"). */
export function normalizeQuality(q) {
  if (q === null || q === undefined) return null;
  const s = String(q).trim().toLowerCase();
  if (!s || s === "none" || s === "auto") return null;
  if (KEYS.has(s)) return s;
  return ALIASES[s] ?? null;
}

/** dnd5e rarity -> colour quality (very rare = purple, artifact keeps its own colour). */
export const RARITY_QUALITY = {
  common: "common", uncommon: "uncommon", rare: "rare", veryRare: "epic", legendary: "legendary", artifact: "artifact"
};

/** The dnd5e rarity of plain item data: `system.rarity` (dnd5e 5, or the derived getter) or the first of `system.rarities` (dnd5e 6). */
export function rarityOf(system) {
  if (!system) return null;
  if (typeof system.rarity === "string" && system.rarity) return system.rarity;
  const r = system.rarities;
  const first = r instanceof Set ? [...r][0] : Array.isArray(r) ? r[0] : null;
  return typeof first === "string" && first ? first : null;
}

/**
 * The quality an item shows.
 * @param {object} item  item data or document ({flags, system}) or a compendium index entry
 * @param {object} [o]
 * @param {boolean} [o.rarityFallback=true]  use the dnd5e rarity when no quality is set
 * @param {string}  [o.moduleId="loot-ledger"]
 * @returns {string|null} quality key, or null (no colour)
 */
export function resolveQuality(item, { rarityFallback = true, moduleId = "loot-ledger" } = {}) {
  if (!item) return null;
  const explicit = normalizeQuality(item.flags?.[moduleId]?.quality);
  if (explicit) return explicit;
  if (!rarityFallback) return null;
  return RARITY_QUALITY[rarityOf(item.system)] ?? null;
}

/** The CSS classes for a quality ("ll-q ll-q-rare"), or "" for none. */
export function qualityClass(q) {
  const k = normalizeQuality(q);
  return k ? `ll-q ll-q-${k}` : "";
}

/** Every class qualityClass() can add, for removing stale ones before re-applying. */
export const ALL_CLASSES = ["ll-q", ...COLOUR_QUALITIES.map(q => `ll-q-${q.key}`)];

/**
 * The flag update for setting a quality by hand: {"flags.loot-ledger.quality": key} or, to clear it,
 * {"flags.loot-ledger.-=quality": null}. Throws on an unknown quality name.
 */
export function qualityUpdate(q, moduleId = "loot-ledger") {
  if (q === null || q === undefined || q === "" || String(q).toLowerCase() === "none" || String(q).toLowerCase() === "auto") {
    return { [`flags.${moduleId}.-=quality`]: null };
  }
  const k = normalizeQuality(q);
  if (!k) throw new Error(`Loot Ledger: unknown quality "${q}" (use ${COLOUR_QUALITIES.map(x => x.key).join(", ")}, or null to clear)`);
  return { [`flags.${moduleId}.quality`]: k };
}
