/**
 * Quality colours, pure logic (no Foundry calls; unit-tested in Node): which quality an item shows, and the classes that colour it.
 * One colour system: the colours are wanderers-core's `--wc-q-*` tokens (vendored stylesheet), the keys are core's `QUALITY_KEYS`.
 * This file is only the Loot Ledger normaliser on top: colour-name aliases, the extra `heirloom` tier, and "no quality" (null, no
 * colour) where core's `quality()` would answer poor or common. An explicit quality (flags["loot-ledger"].quality, written by Build
 * or set by hand) always wins; otherwise, when the fallback is on, the dnd5e rarity picks a colour.
 */
import { QUALITIES as CORE_QUALITIES, UI_CLASSES, quality as coreQuality } from "../vendor/wanderers-core/index.mjs";

/** Colour word shown next to each quality in the pickers. */
const COLOUR_WORD = {
  poor: "grey", common: "white", uncommon: "green", rare: "blue", epic: "purple", legendary: "orange", artifact: "gold", heirloom: "light blue"
};

/**
 * Qualities Loot Ledger adds on top of core's seven. Each has its own `--wc-q-<key>` token in styles/loot-ledger.css.
 * Core candidate: when a core release ships `--wc-q-heirloom`, drop this list entry's token from the module CSS.
 */
export const EXTRA_QUALITIES = ["heirloom"];

/** Every quality that has a colour, low -> high: core's seven (same keys Build stores, data.mjs QUALITIES) plus heirloom. */
export const COLOUR_QUALITIES = [
  ...CORE_QUALITIES.map(q => ({ key: q.key, label: `${q.label} (${COLOUR_WORD[q.key]})` })),
  ...EXTRA_QUALITIES.map(k => ({ key: k, label: `${k[0].toUpperCase()}${k.slice(1)} (${COLOUR_WORD[k]})` }))
];
const KEYS = new Set(COLOUR_QUALITIES.map(q => q.key));

/** Rarity spellings core understands (letters only, lower case), minus "mundane"/"none": those mean no quality here. */
const CORE_SPELLINGS = new Set(CORE_QUALITIES.flatMap(q => [q.key, String(q.rarity ?? "").toLowerCase()]).filter(s => s && s !== "mundane"));

/** Other names people (and other modules) use for the same qualities. */
const ALIASES = {
  grey: "poor", gray: "poor", junk: "poor", trash: "poor",
  white: "common", normal: "common",
  green: "uncommon",
  blue: "rare",
  purple: "epic",
  orange: "legendary",
  gold: "artifact", golden: "artifact",
  lightblue: "heirloom", account: "heirloom"
};

/**
 * A quality key from any accepted spelling, or null (empty / unknown / "none" / "auto" / "mundane"). Case, spaces and punctuation
 * are ignored ("Very Rare", "light-blue"). Core rarity spellings go through core's `quality()`; never throws.
 */
export function normalizeQuality(q) {
  if (q === null || q === undefined) return null;
  const s = String(q).trim().toLowerCase();
  if (KEYS.has(s)) return s;
  const letters = s.replace(/[^a-z]/g, "");
  if (!letters || letters === "none" || letters === "auto") return null;
  if (KEYS.has(letters)) return letters;
  if (Object.hasOwn(ALIASES, letters)) return ALIASES[letters];
  if (CORE_SPELLINGS.has(letters)) return coreQuality(letters);
  return null;
}

/** dnd5e rarity -> colour quality (core's mapping; very rare = epic). Mundane / no rarity has no colour. */
export const RARITY_QUALITY = Object.fromEntries(CORE_QUALITIES.filter(q => q.rarity && q.rarity !== "mundane").map(q => [q.rarity, q.key]));

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

/**
 * The classes for a quality, or "" for none: "ll-q ll-q-rare" plus core's root classes (`UI_CLASSES`), so the coloured element is
 * its own small core root and core's themed `--wc-q-*` tokens resolve on it, also inside Foundry's and other modules' windows.
 */
export function qualityClass(q) {
  const k = normalizeQuality(q);
  return k ? ["ll-q", `ll-q-${k}`, ...UI_CLASSES].join(" ") : "";
}

/** Loot Ledger's own classes qualityClass() can add (core's root classes are removed only from elements that carry `ll-q`). */
export const ALL_CLASSES = ["ll-q", ...COLOUR_QUALITIES.map(q => `ll-q-${q.key}`)];

/**
 * The theme a painted element must carry: the nearest themed ancestor's ("light" / "dark"), or null when that is the body or there
 * is none (core's `body.theme-*` rules then decide, and follow a live interface-theme change). Starts at the parent, so a theme class
 * set by an earlier paint is not read back.
 * @param {{parentElement?: {closest?: Function} | null}} el
 * @returns {"light"|"dark"|null}
 */
export function themeOf(el) {
  const themed = el?.parentElement?.closest?.(".theme-light, .theme-dark");
  if (!themed || themed.tagName === "BODY") return null;
  return themed.classList.contains("theme-light") ? "light" : "dark";
}

/**
 * Give a coloured element its window's theme class (core reads a window's own theme only from its root, and the element is its own
 * root). Removes a class an earlier call added (kept in `data-ll-theme`), never one the element had itself.
 * @param {{classList: {add: Function, remove: Function, contains: Function}, dataset: Record<string, string|undefined>, parentElement?: object|null}} el
 */
export function syncTheme(el) {
  if (!el?.classList) return;
  const prev = el.dataset.llTheme;
  if (prev) { el.classList.remove(`theme-${prev}`); delete el.dataset.llTheme; }
  if (!el.classList.contains("ll-q")) return;
  const t = themeOf(el);
  if (!t || el.classList.contains(`theme-${t}`)) return;
  el.classList.add(`theme-${t}`);
  el.dataset.llTheme = t;
}

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
