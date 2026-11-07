/**
 * Public API, exposed as game.modules.get("loot-ledger").api
 */
import { MODULE_ID, BANDS, QUALITIES, CATEGORIES, CREATURES, bandForLevel, formatCoins, vendorCopperOf } from "./data.mjs";
import { build, convertToPack, TABLES_PACK } from "./build.mjs";
import { convertItem, parseSource, auditHandAuthored } from "./convert.mjs";
import { gateApi } from "./gm.mjs";

/** Cached table indexes, by pack collection id: { pack, index: Promise }. Cleared by any RollTable create/update/delete. */
const tableIndexes = new Map();

/** Forget the cached table indexes (all of them; table writes are rare, a rebuild writes hundreds). */
export function clearTableIndexCache() {
  tableIndexes.clear();
}

/** Clear the table index cache whenever a roll table is created, changed or deleted (world or compendium). Call once at init. */
export function registerTableIndexHooks() {
  for (const hook of ["createRollTable", "updateRollTable", "deleteRollTable"]) Hooks.on(hook, clearTableIndexCache);
}

/** The pack's index with Loot Ledger flags, read once and reused until a table changes (or the pack object is replaced). */
async function tableIndex(tables) {
  const hit = tableIndexes.get(tables.collection);
  if (hit && hit.pack === tables) return hit.index;
  const index = tables.getIndex({ fields: [`flags.${MODULE_ID}`] });
  tableIndexes.set(tables.collection, { pack: tables, index });
  index.catch(() => { if (tableIndexes.get(tables.collection)?.index === index) tableIndexes.delete(tables.collection); });
  return index;
}

/** Find the generated table matching a query. */
export async function findTable({ band = null, level = null, quality = null, type = null, creature = null, pack = TABLES_PACK.name } = {}) {
  const tables = game.packs.get(`world.${pack}`);
  if (!tables) throw new Error("Loot Ledger: no tables compendium yet. Run Build loot pools first.");
  if (band === null || band === undefined) band = level ? bandForLevel(level) : 1;
  band = Number(band);
  const kind = creature ? "creature" : type ? "type" : quality ? "quality" : "drop";
  const index = await tableIndex(tables);
  const match = index.find(e => {
    const f = e.flags?.[MODULE_ID];
    if (!f || f.kind !== kind) return false;
    if (kind === "quality" && (quality === "legendary" || quality === "artifact")) return f.quality === "legendary";
    if (f.band !== band) return false;
    if (kind === "creature") return f.creature === creature;
    if (kind === "type") return f.type === type;
    if (kind === "quality") return f.quality === quality;
    return true;
  });
  return match ? tables.getDocument(match._id) : null;
}

/**
 * Roll loot.
 * @param {object} [query]
 * @param {number} [query.band]      band 1–7 (or pass `level` for a character level)
 * @param {number} [query.level]     character level 1–20, converted with bandForLevel
 * @param {string} [query.quality]   poor | common | uncommon | rare | epic | legendary
 * @param {string} [query.type]      weapon | armor-head | armor-body | armor-limbs | armor-back | shield | jewelry | consumable | goods | junk
 * @param {string} [query.creature]  beast | humanoid | undead | elemental | dragonkin | demon | giant | mechanical
 * @param {boolean} [query.chat=false] also post the draw to chat
 * @param {number} [query.count=1]   number of draws
 * @returns {Promise<Item[]>} the compendium items rolled (resolved documents)
 */
export async function roll(query = {}) {
  const table = await findTable(query);
  if (!table) {
    ui.notifications.warn("Loot Ledger: no table matches that query.");
    return [];
  }
  const items = [];
  const count = Math.max(1, Number(query.count) || 1);
  for (let i = 0; i < count; i++) {
    const res = query.chat ? await table.draw() : await table.roll();
    for (const r of res.results) {
      if (r.type !== "document" || !r.documentUuid) continue;
      const doc = await fromUuid(r.documentUuid);
      if (doc instanceof Item) items.push(doc);
    }
  }
  return items;
}

/**
 * Classic vendor sell price of an item (from Loot Ledger flags, or the source module's data).
 * @returns {{copper:number, text:string, noSell:boolean}}
 */
export function sellPrice(item) {
  const f = item?.flags?.[MODULE_ID];
  const copper = f?.vendorSellCopper ?? vendorCopperOf(item ?? {});
  return { copper, text: copper ? formatCoins(copper) : "—", noSell: !copper };
}

/** API members that read or write documents or roll: GM only (players get a warning and undefined). */
export const GM_ONLY = ["build", "convertToPack", "roll", "findTable", "auditHandAuthored"];

export function createApi() {
  const gated = gateApi({
    build: (options) => build(options),
    auditHandAuthored: (item) => auditHandAuthored(parseSource(item)),
    convertToPack: (options) => convertToPack(options),
    roll,
    findTable
  });
  return {
    ...gated,
    // Pure helpers and constants: open to everyone.
    convert: (item, options) => convertItem(item, options),
    sellPrice,
    bandForLevel,
    formatCoins,
    BANDS: foundry.utils.deepClone(BANDS),
    QUALITIES: QUALITIES.map(q => q.key),
    TYPES: CATEGORIES.map(c => c.key),
    CREATURES: CREATURES.map(c => c.key)
  };
}
