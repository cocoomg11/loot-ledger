/**
 * Remove module data (GM only). Loot Ledger writes: three world compendiums (items, converted items, tables),
 * the Build Report journal entry, its world settings, and flags["loot-ledger"] on items (review decisions,
 * quality, hashes, suffixes). Nothing else. The plan is pure; `removeModuleData` does the deleting.
 *
 * Item flags are kept unless `itemFlags: true`, because a hand-set quality is the GM's own data.
 * Needs a live world; only `cleanupPlan` is tested in Node.
 */
import { MODULE_ID } from "./data.mjs";

/** Every world setting key Loot Ledger registers (a test checks this list against the register calls). */
export const SETTING_KEYS = ["coinRatio", "convertOnBuild", "reviewBoard", "qualityColours", "qualityRarityFallback", "qualityPicker", "randomSuffixes", "suffixMode"];
export const PACK_NAMES = ["loot-ledger-items", "loot-ledger-converted-items", "loot-ledger-tables"];

/**
 * @param {object} found  { packs: string[] (world pack names that exist), journals: number, worldItems: number, actorItems: number }
 * @param {object} [options]  { itemFlags=false }
 * @returns {object} what would be removed, as counts and names
 */
export function cleanupPlan(found = {}, { itemFlags = false } = {}) {
  const packs = PACK_NAMES.filter(n => (found.packs ?? []).includes(n));
  return {
    packs,
    journals: Math.max(0, found.journals | 0),
    settings: [...SETTING_KEYS],
    itemFlags: !!itemFlags,
    worldItems: itemFlags ? Math.max(0, found.worldItems | 0) : 0,
    actorItems: itemFlags ? Math.max(0, found.actorItems | 0) : 0
  };
}

const hasFlags = item => !!item.flags?.[MODULE_ID] && Object.keys(item.flags[MODULE_ID]).length > 0;

/**
 * api.removeData({ dryRun, confirm, itemFlags }). Default is a dry run; pass `dryRun: false` to delete.
 * @returns {Promise<object|null>} the plan (null when the GM cancels the confirm dialog)
 */
export async function removeModuleData({ dryRun = true, confirm = true, itemFlags = false } = {}) {
  if (!game.user.isGM) throw new Error("Loot Ledger: only a GM can remove module data.");
  const worldItems = game.items.filter(hasFlags);
  const actorItems = [...game.actors].flatMap(a => a.items.filter(hasFlags));
  const plan = cleanupPlan({
    packs: PACK_NAMES.filter(n => game.packs.has(`world.${n}`)),
    journals: game.journal.filter(j => j.getFlag(MODULE_ID, "buildReport")).length,
    worldItems: worldItems.length, actorItems: actorItems.length
  }, { itemFlags });
  if (dryRun) return plan;
  if (confirm) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Loot Ledger: remove module data" },
      content: `<p>This permanently deletes ${plan.packs.length} compendium(s), ${plan.journals} Build Report journal(s) and the Loot Ledger settings${itemFlags ? `, and clears Loot Ledger flags from ${plan.worldItems + plan.actorItems} item(s)` : ""}. It cannot be undone. Export a backup first.</p>`
    });
    if (!ok) return null;
  }
  for (const n of plan.packs) await game.packs.get(`world.${n}`)?.deleteCompendium();
  for (const j of game.journal.filter(j => j.getFlag(MODULE_ID, "buildReport"))) await j.delete();
  if (itemFlags) for (const it of [...worldItems, ...actorItems]) await it.update({ [`flags.-=${MODULE_ID}`]: null });
  for (const key of SETTING_KEYS) {
    try { await game.settings.get(MODULE_ID, key, { document: true })?.delete?.(); } catch (err) { console.warn(`${MODULE_ID} | could not remove setting ${key}`, err); }
  }
  return plan;
}
