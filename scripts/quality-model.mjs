/**
 * Quality colours, pure logic (no Foundry calls; unit-tested in Node): which quality an item shows, and the classes that colour it.
 * One colour system: the colours are wanderers-core's `--wc-q-*` tokens (vendored stylesheet), the keys are core's `QUALITY_KEYS`.
 * This file is only the Loot Ledger normaliser on top: colour-name aliases and "no quality" (null, no
 * colour) for an unknown value where core's `quality()` would answer common. An explicit quality (flags["loot-ledger"].quality,
 * written by Build or set by hand) always wins; otherwise, when the fallback is on, the dnd5e rarity picks a colour, and a physical
 * item below common (no rarity, "", "mundane", "none") is poor (grey).
 */
import { QUALITIES as CORE_QUALITIES, UI_CLASSES, quality as coreQuality } from "../vendor/wanderers-core/index.mjs";

/** Colour word shown next to each quality in the pickers. */
const COLOUR_WORD = {
  poor: "grey", common: "white", uncommon: "green", rare: "blue", epic: "purple", legendary: "orange", artifact: "gold", heirloom: "light blue"
};

/** Every quality that has a colour, low -> high: core's `QUALITIES` (same keys Build stores, data.mjs QUALITIES; heirloom last since core 0.5.2), labelled with their colour word. */
export const COLOUR_QUALITIES = CORE_QUALITIES.map(q => ({ key: q.key, label: `${q.label} (${COLOUR_WORD[q.key]})` }));
const KEYS = new Set(COLOUR_QUALITIES.map(q => q.key));

/** Rarity spellings core understands (letters only, lower case); "mundane" reads as poor. */
const CORE_SPELLINGS = new Set(CORE_QUALITIES.flatMap(q => [q.key, String(q.rarity ?? "").toLowerCase()]).filter(Boolean));

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
 * A quality key from any accepted spelling ("mundane" → poor), or null: empty / "none" / "auto" (the picker's and `qualityUpdate`'s
 * "no quality set": the rarity fallback decides) and unknown values. Case, spaces and punctuation are ignored ("Very Rare",
 * "light-blue"). Core rarity spellings go through core's `quality()`; never throws.
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

/** dnd5e rarity -> colour quality (core's mapping; very rare = epic). Below common (no rarity, "", mundane, none) is `BELOW_COMMON`. */
export const RARITY_QUALITY = Object.fromEntries(CORE_QUALITIES.filter(q => q.rarity && q.rarity !== "mundane").map(q => [q.rarity, q.key]));

/** The quality of a physical item below common: grey, like core's `quality("")`. */
export const BELOW_COMMON = "poor";
/** Rarity values that mean "below common" (lower case): none set, dnd5e's "mundane", and the "none" some data uses. */
const BELOW_COMMON_RARITIES = new Set(["", "mundane", "none"]);
/**
 * dnd5e item types that carry a rarity (the physical ones). Spells, features, classes and the like have no rarity and stay
 * uncoloured. Data without a `type` (plain test data, an odd index entry) counts as physical.
 */
export const PHYSICAL_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"]);

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
 * @returns {string|null} quality key, or null (no colour: fallback off with no flag, a non-physical item without rarity, an
 *   unknown rarity)
 */
export function resolveQuality(item, { rarityFallback = true, moduleId = "loot-ledger" } = {}) {
  if (!item) return null;
  const explicit = normalizeQuality(item.flags?.[moduleId]?.quality);
  if (explicit) return explicit;
  if (!rarityFallback) return null;
  const r = rarityOf(item.system) ?? "";
  if (Object.hasOwn(RARITY_QUALITY, r)) return RARITY_QUALITY[r];
  // Below common: grey for physical items only. An unknown (homebrew) rarity stays uncoloured: it may rank above common, and
  // grey would call it junk.
  if (BELOW_COMMON_RARITIES.has(r.toLowerCase()) && (item.type === undefined || PHYSICAL_TYPES.has(item.type))) return BELOW_COMMON;
  return null;
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
