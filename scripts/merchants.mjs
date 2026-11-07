/**
 * Merchant tables (Foundry half): the mapping settings, Apply (Item Piles `tablesForPopulate` + merchant prices), the safe
 * Restock, the Merchants window, the summary card, health lines and Remove merchant data. Every write is a GM click (or a GM
 * API call); nothing here runs on a hook. Item Piles is optional: without it the window says so and the API refuses.
 *
 * Item Piles 3.3.4 calls used (checked in its source, tag 3.3.4, src/API/api.js): `isItemPileMerchant(actor)`,
 * `getActorFlagData(actor)`, `getActorItems(actor)`, `updateItemPile(actor, data)` (merges into `flags.item-piles.data`; arrays
 * are replaced), `refreshMerchantInventory(actor, { removeExistingActorItems: false })`. Never `removeExistingActorItems: true`
 * (3.3.4 doubles quantities, drops rolls and deletes keepOnMerchant items; seen live).
 */
import { MODULE_ID } from "./data.mjs";
import * as MM from "./merchants-model.mjs";
import { esc, UI_CLASSES, healthCollector } from "../vendor/wanderers-core/index.mjs";

export const SETTING_ON = "merchantTables";
export const SETTING_MAP = "merchantMap";
export const SETTING_DEFAULTS = "merchantDefaults";
const IP = "item-piles";

/** Register the three settings (world). The mapping and the defaults are hidden records. */
export function registerMerchantSettings() {
  game.settings.register(MODULE_ID, SETTING_ON, {
    name: "Merchant tables",
    hint: "Adds the Merchants window (GM): point Item Piles merchants at shop roll tables by vendor type and level band, and restock them with a button. Off = no window, no menu, the API's merchants entry is missing.",
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true
  });
  game.settings.register(MODULE_ID, SETTING_MAP, { scope: "world", config: false, type: Object, default: MM.emptyMap() });
  game.settings.register(MODULE_ID, SETTING_DEFAULTS, { scope: "world", config: false, type: Object, default: MM.defaultDefaults() });
}

export const merchantsOn = () => { try { return !!game.settings.get(MODULE_ID, SETTING_ON); } catch { return false; } };
export const ip = () => (game.modules.get(IP)?.active ? game.itempiles?.API ?? null : null);
export const readMap = () => MM.normalizeMap(game.settings.get(MODULE_ID, SETTING_MAP));
export const readDefaults = () => MM.normalizeDefaults(game.settings.get(MODULE_ID, SETTING_DEFAULTS));
const saveMap = map => game.settings.set(MODULE_ID, SETTING_MAP, MM.normalizeMap(map));

/** World actors Item Piles calls merchants. */
export function merchantActors(api = ip()) {
  if (!api) return [];
  return game.actors.filter(a => { try { return api.isItemPileMerchant(a); } catch { return false; } });
}

/** World roll tables, as the model reads them. */
function worldTables() {
  return game.tables.contents.map(t => ({
    uuid: t.uuid, name: t.name,
    results: t.results.contents.map(r => ({ id: r.id, name: r.name ?? r.text ?? "" }))
  }));
}

const nameOf = uuid => { try { return fromUuidSync(uuid)?.name ?? null; } catch { return null; } };

function existingTables(api, actor) {
  try { return api.getActorFlagData(actor)?.tablesForPopulate ?? []; } catch { return []; }
}

/** The plan for every mapped merchant (or `ids`). Read only. */
export function plan({ ids = null, band = null } = {}) {
  const api = ip();
  if (!api) return { itemPiles: false, rows: [], missing: [], dupes: [], ready: 0 };
  const merchants = merchantActors(api).map(a => ({ id: a.id, name: a.name, existing: existingTables(api, a) }));
  return { itemPiles: true, ...MM.planAll({ merchants, map: readMap(), defaults: readDefaults(), tables: worldTables(), nameOf, band, ids }) };
}

const toIds = ids => (ids === undefined || ids === null ? null : (Array.isArray(ids) ? ids : [ids]).map(String));

/**
 * Write `tablesForPopulate` and the merchant prices for mapped merchants.
 * @param {string[] | string | null} [ids] actor ids (default: every mapped merchant)
 * @param {{ dryRun?: boolean, band?: number | null, card?: boolean }} [opts] band = for wandering merchants, this time
 */
export async function apply(ids = null, { dryRun = false, band = null, card = true } = {}) {
  const api = ip();
  if (!api) { ui.notifications.warn("Loot Ledger: Item Piles is not active."); return null; }
  const p = plan({ ids: toIds(ids), band: Number.isInteger(Number(band)) && band !== null && band !== "" ? Number(band) : null });
  for (const r of p.rows) {
    if (dryRun || !r.ok) continue;
    const actor = game.actors.get(r.id);
    try {
      await api.updateItemPile(actor, { tablesForPopulate: r.tablesForPopulate, ...r.settings });
    } catch (err) {
      r.ok = false;
      r.reason = `Item Piles refused: ${err?.message ?? err}`;
    }
  }
  if (card) await postCard(dryRun ? "Apply tables (dry run)" : "Apply tables", MM.summaryLines("apply", p.rows), p.missing);
  return p;
}

/**
 * The safe restock: delete the merchant's items not flagged keepOnMerchant / keepIfZero / isService, roll its tables with
 * `removeExistingActorItems: false`, then mark the new basics infinite and not sellable to merchants.
 * @param {string[] | string | null} [ids]
 * @param {{ dryRun?: boolean, card?: boolean }} [opts]
 */
export async function restock(ids = null, { dryRun = false, card = true } = {}) {
  const api = ip();
  if (!api) { ui.notifications.warn("Loot Ledger: Item Piles is not active."); return null; }
  const map = readMap();
  const want = toIds(ids);
  const results = [];
  const tables = new Map(game.tables.contents.map(t => [t.uuid, t]));
  for (const actor of merchantActors(api)) {
    if (want && !want.includes(actor.id)) continue;
    const entry = map.merchants[actor.id];
    if (!entry || !MM.restockable(entry)) continue;
    const list = existingTables(api, actor);
    const items = api.getActorItems(actor).map(i => ({ id: i.id, name: i.name, ipItem: i.flags?.[IP]?.item }));
    const r = { id: actor.id, name: actor.name, ...MM.restockPlan(items, list) };
    results.push(r);
    if (dryRun || !r.ok) continue;
    try {
      if (r.remove.length) await actor.deleteEmbeddedDocuments("Item", r.remove);
      const before = actor.items.map(i => i.id);
      await api.refreshMerchantInventory(actor, { removeExistingActorItems: false });
      const basicNames = list
        .filter(t => MM.parseTableName(nameOf(t.uuid))?.kind === "basics")
        .flatMap(t => tables.get(t.uuid)?.results.contents.map(x => x.name ?? x.text ?? "") ?? []);
      const after = actor.items.map(i => ({ id: i.id, name: i.name }));
      r.added = after.filter(i => !before.includes(i.id)).length;
      const basics = MM.newBasics(after, before, basicNames);
      r.basics = basics.length;
      if (basics.length) await actor.updateEmbeddedDocuments("Item", basics.map(MM.basicUpdate));
    } catch (err) {
      r.error = err?.message ?? String(err);
    }
  }
  if (card) await postCard(dryRun ? "Restock (dry run)" : "Restock", MM.summaryLines("restock", results, { dryRun }), []);
  return results;
}

/** A summary card whispered to the GMs. */
async function postCard(title, lines, missing) {
  if (!lines.length && !missing.length) { ui.notifications.info(`Loot Ledger: ${title}: no mapped merchants.`); return; }
  const li = lines.map(l => `<li class="ll-m-${esc(l.level)}">${esc(l.text)}</li>`).join("");
  const miss = missing.length
    ? `<details><summary>${missing.length} missing table${missing.length === 1 ? "" : "s"}</summary><ul>${missing.map(n => `<li>${esc(n)}</li>`).join("")}</ul></details>`
    : "";
  const content = `<div class="${UI_CLASSES.join(" ")} loot-ledger-mcard"><h3>Merchants: ${esc(title)}</h3><ul>${li}</ul>${miss}</div>`;
  await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: { alias: "Loot Ledger" },
    flags: { [MODULE_ID]: { [MM.CARD_FLAG]: true } }
  });
}

/** Health report (core shape): `[{ title, lines: [{ level, text }] }]`, `[]` for players. Never writes. */
export async function healthReport({ timeoutMs = 20000 } = {}) {
  if (!game.user?.isGM) return [];
  const h = healthCollector({ timeoutMs });
  await h.checkAsync("Merchant tables", add => {
    if (!merchantsOn()) { add("off", "Merchant tables are turned off."); return; }
    const api = ip();
    const merchants = merchantActors(api).map(a => a.id);
    const map = readMap();
    const p = plan();
    for (const l of MM.healthLines({ itemPiles: !!api, merchants: merchants.length, map, orphans: MM.orphanIds(map, merchants), plan: p })) add(l.level, l.text);
  });
  return h.report();
}

/** What Remove merchant data would touch (read only). */
export function cleanupPlan() {
  const cards = game.messages.filter(m => m.getFlag(MODULE_ID, MM.CARD_FLAG)).map(m => m.id);
  const basics = [];
  for (const a of game.actors) for (const i of a.items) if (i.getFlag(MODULE_ID, MM.BASIC_FLAG)) basics.push(i.uuid);
  return { settings: [SETTING_MAP, SETTING_DEFAULTS], cards, basics };
}

/**
 * Remove Loot Ledger's merchant data: the mapping and defaults settings (back to defaults), our summary cards, and our
 * `merchantBasic` tag on merchant items. Item Piles' own data (tablesForPopulate, prices, its item flags, stock) is left alone.
 * @param {{ confirm?: boolean }} [opts] confirm: ask first (default)
 */
export async function removeData({ confirm = true } = {}) {
  const p = cleanupPlan();
  if (confirm) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remove merchant data" },
      classes: [...UI_CLASSES],
      content: `<p>Reset the merchant mapping and defaults, delete ${p.cards.length} summary card(s) and untag ${p.basics.length} merchant item(s)? Item Piles' own merchant settings and stock are not changed.</p>`
    });
    if (!ok) return null;
  }
  await game.settings.set(MODULE_ID, SETTING_MAP, MM.emptyMap());
  await game.settings.set(MODULE_ID, SETTING_DEFAULTS, MM.defaultDefaults());
  if (p.cards.length) await ChatMessage.deleteDocuments(p.cards);
  for (const uuid of p.basics) {
    const item = fromUuidSync(uuid);
    if (item) await item.unsetFlag(MODULE_ID, MM.BASIC_FLAG);
  }
  ui.notifications.info("Loot Ledger: merchant data removed.");
  return p;
}

/** Set (merge) mapping fields for merchants. */
export async function setMapping(ids, fields) {
  return saveMap(MM.withEntries(readMap(), toIds(ids) ?? [], fields));
}

/** The defaults (types' prices, size formulas, bands), normalized. */
export const defaults = () => readDefaults();

/** Replace the defaults (normalized: bad values fall back to the shipped ones). `null` restores the shipped defaults. */
export async function setDefaults(raw) {
  return game.settings.set(MODULE_ID, SETTING_DEFAULTS, raw === null ? MM.defaultDefaults() : MM.normalizeDefaults({ ...raw, v: MM.DEFAULTS_VERSION }));
}

/** Forget merchants in the mapping (the actors are not changed). */
export async function unmap(ids) {
  let m = readMap();
  for (const id of toIds(ids) ?? []) m = MM.withEntry(m, id, null);
  return saveMap(m);
}

/** Open the window (GM). */
export async function open() {
  const { MerchantsApp } = await import("./merchants-app.mjs");
  const app = foundry.applications.instances.get("loot-ledger-merchants") ?? new MerchantsApp();
  app.render({ force: true });
  return app;
}

/** The GM-gated `api.merchants` members (main.mjs wraps them with gateApi). */
export const MERCHANT_API = {
  plan: (opts) => plan(opts),
  apply: (ids, opts) => apply(ids, opts),
  restock: (ids, opts) => restock(ids, opts),
  setMapping: (ids, fields) => setMapping(ids, fields),
  unmap: (ids) => unmap(ids),
  defaults: () => defaults(),
  setDefaults: (raw) => setDefaults(raw),
  open: () => open(),
  cleanupPlan: () => cleanupPlan(),
  removeData: (opts) => removeData(opts),
  health: (opts) => healthReport(opts)
};
