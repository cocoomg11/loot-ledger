/**
 * Collapse (pure; tested in Node). Converted items that follow the same rule are grouped so the GM reviews the rule
 * once: same shape, slot, armour / weapon type, quality, tier band, official base, +N and gap-fills (shared mode,
 * the only mode). Every member stays its own item (name, icon, price, item level, tooltip, quality); members carry
 * flags.loot-ledger.collapse = {key, group, canonical, canonicalId, size} and one deterministic canonical member
 * stands for the group on the review board. Book, hand-made and source-text items never collapse; a member with a
 * review-board override, a Tweak, or an explicit split stands alone.
 *
 * Nothing here reads Foundry: build.mjs passes the converted items' Loot Ledger flags and a little system data.
 */
import { LEVEL_BANDS, COLLAPSE_RULE } from "./rules.mjs";
import { gapFillSignature } from "./variants.mjs";
import { hashString } from "./ledger.mjs";

/** The four character-level tier bands (COLLAPSE_RULE.tierBands); loot tables keep LEVEL_BANDS' seven sub-bands. */
export const TIER_BANDS = COLLAPSE_RULE.tierBands;

/** Tier band (1–4) of a loot band (1–7), by the character levels the loot band maps to. */
export function tierBandOf(lootBand) {
  const lb = LEVEL_BANDS.find(b => b.band === Number(lootBand));
  if (!lb) return null;
  return TIER_BANDS.find(t => lb.charMin >= t.min && lb.charMin <= t.max)?.band ?? TIER_BANDS.at(-1).band;
}

/** True when the item never collapses: book or hand-made route, kept source text, or no conversion at all. */
export function neverCollapses(flags) {
  const c = flags?.converted;
  if (!c) return true;
  if (flags.handmade === true) return true;
  if (["book", "handmade"].includes(c.route)) return true;
  if (c.sourceText || c.handAuthoredKept) return true;
  return false;
}

/** True when the member must stand alone: a review-board override, a Tweak, or an explicit split. */
export function standsAlone(flags) {
  const o = flags?.overrides ?? {};
  if (Object.values(o).some(v => v !== null && v !== undefined && v !== false && v !== "")) return true;
  if (flags?.review?.status === "tweaked") return true;
  if (flags?.collapse?.split === true) return true;
  return false;
}

/**
 * The collapse key of one converted item, or null when it does not collapse.
 * @param {string} id        the item's id (used only for members that stand alone)
 * @param {object} flags     the item's flags["loot-ledger"]
 * @param {object} [system]  the converted item's system data (type and +N)
 */
export function collapseKey(id, flags, system = {}) {
  if (neverCollapses(flags)) return null;
  const c = flags.converted;
  const type = [system?.type?.value ?? "", system?.type?.baseItem ?? ""].filter(Boolean).join("/");
  const band = tierBandOf(flags.band) ?? "";
  const baseStatus = flags.base?.status;
  const accepted = baseStatus === "accept";
  let key;
  if (c.route === "baseline") {
    // White / grey gear: the same plain item for the same shape, slot (which carries the weapon's hands), type and band.
    key = ["baseline", c.shape ?? "", flags.slot ?? "", type, band].join("|");
  } else if (accepted) {
    const plus = Number(system?.magicalBonus ?? system?.armor?.magicalBonus ?? flags.base?.plus ?? 0) || 0;
    const base = flags.base.uuid ?? (flags.base.source === "template" ? `template:${flags.base.name ?? ""}` : "");
    key = [c.shape ?? "", flags.slot ?? "", type, flags.quality ?? "", band, base, `+${plus}`, gapFillSignature(flags.gapFills ?? [])].join("|");
  } else return null; // tooltip conversions follow their own lines: nothing to share
  if (standsAlone(flags)) key += `|solo:${id}`;
  return key;
}

/** Short, stable group id for a key. */
export const groupId = key => `g${hashString(key).slice(0, 10)}`;

/**
 * Group converted items by collapse key.
 * @param {{id:string, name:string, flags:object, system?:object}[]} items
 * @param {{mode?:string}} [o]  collapseMode: "shared" (default) or "off" (every item gets collapse: null)
 * @returns {{flags:Map<string, object|null>, groups:{key:string, group:string, canonicalId:string, members:string[]}[]}}
 *   flags: id -> the collapse flag the item should carry (null: none)
 */
export function collapseGroups(items, { mode = "shared" } = {}) {
  const out = new Map(), groups = [];
  if (mode !== "shared") { for (const it of items) out.set(it.id, null); return { flags: out, groups }; }
  const byKey = new Map();
  for (const it of items) {
    const key = collapseKey(it.id, it.flags, it.system);
    if (!key) { out.set(it.id, null); continue; }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(it);
  }
  for (const [key, members] of byKey) {
    // Canonical: a deterministic pick, the first member by name then id.
    members.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")) || String(a.id).localeCompare(String(b.id)));
    const group = groupId(key), canonicalId = members[0].id;
    for (const m of members) {
      out.set(m.id, { key, group, canonical: m.id === canonicalId, canonicalId, size: members.length, ...(m.flags?.collapse?.split ? { split: true } : {}) });
    }
    groups.push({ key, group, canonicalId, members: members.map(m => m.id) });
  }
  groups.sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key));
  return { flags: out, groups };
}

/** True when two collapse flags mean the same thing (so a stored item needs no update). */
export function sameCollapse(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.key === b.key && a.group === b.group && a.canonical === b.canonical && a.canonicalId === b.canonicalId && a.size === b.size && !!a.split === !!b.split;
}

/**
 * Which stored items need their collapse flag changed: [{id, collapse}] (collapse null = remove the flag).
 * @param {Map<string, object|null>} wanted   collapseGroups().flags
 * @param {Map<string, object>} stored        id -> stored flags["loot-ledger"]
 */
export function collapseUpdates(wanted, stored) {
  const updates = [];
  for (const [id, collapse] of wanted) {
    const have = stored.get(id)?.collapse ?? null;
    if (!sameCollapse(have, collapse)) updates.push({ id, collapse });
  }
  return updates;
}

/** Groups of two or more members, with the member names, for the Build Report and the board. */
export function groupSummary(groups, nameOf = id => id) {
  return groups.filter(g => g.members.length > 1).map(g => ({ group: g.group, size: g.members.length, canonical: nameOf(g.canonicalId), members: g.members.map(nameOf) }));
}
