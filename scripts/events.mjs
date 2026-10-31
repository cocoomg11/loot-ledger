/**
 * Public hook: `loot-ledger.itemDropped` (experimental). Pure helpers here; the Foundry wiring is `announceDrop`
 * and `registerDropHook`. Other modules should listen to the hook instead of reaching into internals.
 *
 *   Hooks.on("loot-ledger.itemDropped", ({ item, source, actor, table, query }) => { ... });
 *
 * - `source: "roll"`  : `api.roll()` drew the item from a Loot Ledger table (`table`, `query` are set).
 * - `source: "actor"` : an item made by Loot Ledger landed on an actor or Item Piles pile (`actor` is set).
 * Fired with Hooks.callAll (return values are ignored). The "actor" event fires on the active GM's client only.
 */
import { MODULE_ID } from "./data.mjs";

export const DROPPED_HOOK = `${MODULE_ID}.itemDropped`;
export const DROP_SOURCES = ["roll", "actor"];

/** True when the item (document or plain data) was made by Loot Ledger (it carries our source flag). */
export function isLootLedgerItem(item) {
  const f = item?.flags?.[MODULE_ID];
  return !!(f && (f.sourceUuid || f.hash));
}

/** The single argument handed to `loot-ledger.itemDropped` listeners; null for an unknown source. */
export function dropPayload({ item, source, actor = null, table = null, query = null }) {
  if (!DROP_SOURCES.includes(source) || !item) return null;
  const payload = { item, source };
  if (actor) payload.actor = actor;
  if (table) payload.table = table;
  if (query) payload.query = { ...query };
  return payload;
}

/** Fire the hook (no-op without a payload). Listener errors are logged, never thrown into Loot Ledger. */
export function announceDrop(args) {
  const payload = dropPayload(args);
  if (!payload) return false;
  try { Hooks.callAll(DROPPED_HOOK, payload); } catch (err) { console.error(`${MODULE_ID} | ${DROPPED_HOOK} listener failed`, err); }
  return true;
}

/** createItem handler: bails on everything but a Loot Ledger item landing on an actor, on the active GM only. */
export function makeCreateItemHandler(isActiveGM) {
  return item => {
    if (!(item.parent instanceof Actor) || !isLootLedgerItem(item) || !isActiveGM()) return;
    announceDrop({ item, source: "actor", actor: item.parent });
  };
}

export function registerDropHook(isActiveGM) {
  Hooks.on("createItem", makeCreateItemHandler(isActiveGM));
}
