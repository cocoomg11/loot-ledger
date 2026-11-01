/**
 * Item quality: the eight quality keys behind the `--wc-q-*` colour tokens and the `.wc-item-slot` / `.wc-q-text` classes of the
 * shared stylesheet (docs/ui.md), and the mapping from a dnd5e rarity key. Pure: no Foundry calls, tested in Node.
 */
import { esc } from "./text.mjs";

/**
 * The qualities, lowest first: `key` (the `data-quality` value and the `wc-q-<key>` class), a plain `label`, and the dnd5e `rarity`
 * key it comes from (null: no dnd5e rarity maps here). `heirloom` (0.5.2) is last, after artifact: appending keeps every existing
 * key's index, so code that compares positions of the first seven reads the same; it has no rarity, so `quality()` only returns it
 * for the key itself. Treat it as a separate kind of item rather than a tier above artifact when ranking.
 * @type {ReadonlyArray<Readonly<{ key: string, label: string, rarity: string | null }>>}
 */
export const QUALITIES = Object.freeze([
  Object.freeze({ key: "poor", label: "Poor", rarity: "mundane" }),
  Object.freeze({ key: "common", label: "Common", rarity: "common" }),
  Object.freeze({ key: "uncommon", label: "Uncommon", rarity: "uncommon" }),
  Object.freeze({ key: "rare", label: "Rare", rarity: "rare" }),
  Object.freeze({ key: "epic", label: "Epic", rarity: "veryRare" }),
  Object.freeze({ key: "legendary", label: "Legendary", rarity: "legendary" }),
  Object.freeze({ key: "artifact", label: "Artifact", rarity: "artifact" }),
  Object.freeze({ key: "heirloom", label: "Heirloom", rarity: null })
]);

/** The quality keys, lowest first. */
export const QUALITY_KEYS = Object.freeze(QUALITIES.map(q => q.key));

/** Rarity spellings (lower case, letters only) → quality key. */
const FROM_RARITY = /** @type {Record<string, string>} */ ({
  "": "poor", mundane: "poor", none: "poor", poor: "poor", junk: "poor",
  common: "common", uncommon: "uncommon", rare: "rare",
  veryrare: "epic", epic: "epic", legendary: "legendary", artifact: "artifact", heirloom: "heirloom"
});

/**
 * The quality key for a dnd5e item rarity (`item.system.rarity`): "" / mundane → poor, common, uncommon, rare, veryRare → epic,
 * legendary, artifact. Case, spaces and punctuation are ignored ("Very Rare", "very_rare"); a quality key maps to itself
 * (so does "heirloom", which no rarity reaches). Never throws: an unknown value (a homebrew rarity) reads as "common".
 * @param {unknown} rarity
 * @returns {string}
 */
export function quality(rarity) {
  const k = typeof rarity === "string" ? rarity.toLowerCase().replace(/[^a-z]/g, "") : "";
  return Object.hasOwn(FROM_RARITY, k) ? FROM_RARITY[k] : "common";
}

/**
 * The plain label of a quality ("Epic"); accepts a quality key or a rarity.
 * @param {unknown} q
 * @returns {string}
 */
export function qualityLabel(q) {
  const key = quality(q);
  return QUALITIES.find(x => x.key === key)?.label ?? "Common";
}

/**
 * A `.wc-item-slot` square: empty (dashed) without `img`, else the icon with the quality border and glow. Every value is escaped.
 * @param {{ img?: string | null, quality?: unknown, rarity?: unknown, name?: string, count?: number, size?: "sm" | "lg", cls?: string }} [o]
 *   quality: a quality key; rarity: a dnd5e rarity (used when quality is not given); name: the title and the image's alt text
 *   (the quality word is added for screen readers); count: a stack count shown in the corner when above 1
 * @returns {string}
 */
export function itemSlot(o = {}) {
  const filled = !!o.img;
  const q = filled ? quality(o.quality ?? o.rarity) : "";
  const cls = ["wc-item-slot", filled ? "" : "wc-empty", o.size === "sm" || o.size === "lg" ? `wc-${o.size}` : "", o.cls ? esc(o.cls) : ""].filter(Boolean).join(" ");
  const title = o.name ? ` title="${esc(o.name)}"` : "";
  if (!filled) return `<span class="${cls}"${title}><span class="wc-sr">Empty slot</span></span>`;
  const count = Number.isFinite(o.count) && /** @type {number} */ (o.count) > 1 ? `<span class="wc-slot-count">${Math.floor(/** @type {number} */ (o.count))}</span>` : "";
  return `<span class="${cls}" data-quality="${q}"${title}><img src="${esc(o.img)}" alt="${esc(o.name ?? "")}" loading="lazy">`
    + `<span class="wc-sr">${esc(qualityLabel(q))}</span>${count}</span>`;
}
