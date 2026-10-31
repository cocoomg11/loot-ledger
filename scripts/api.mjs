/**
 * Public API, exposed as game.modules.get("loot-ledger").api
 */
import { MODULE_ID, SOURCE_PACK, BANDS, QUALITIES, CATEGORIES, CREATURES, bandForLevel, formatCoins, vendorCopperOf } from "./data.mjs";
import { build, convertToPack, TABLES_PACK } from "./build.mjs";
import { REPLACE_LIST, REPLACE_LIST_EXPECTED } from "./replace-list.mjs";
import { handWrittenAudit, replaceListSnippet, auditPageHtml } from "./ledger.mjs";
import * as RULES from "./rules.mjs";
import { convertItem, parseSource, auditHandAuthored } from "./convert.mjs";
import { rollSuffix, listSuffixes } from "./suffix-hooks.mjs";

/** Find the generated table matching a query. */
export async function findTable({ band = null, level = null, quality = null, type = null, creature = null, pack = TABLES_PACK.name } = {}) {
  const tables = game.packs.get(`world.${pack}`);
  if (!tables) throw new Error("Loot Ledger: no tables compendium yet. Run Build loot pools first.");
  if (band === null || band === undefined) band = level ? bandForLevel(level) : 1;
  band = Number(band);
  const kind = creature ? "creature" : type ? "type" : quality ? "quality" : "drop";
  const index = await tables.getIndex({ fields: [`flags.${MODULE_ID}`] });
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

/**
 * Book day: list every hand-written conversion in the source module, flag the ones that fail the traceability
 * audit, and say which are not on the replace list yet. Read-only (writes nothing unless `journal` is true).
 * @param {object}   [options]
 * @param {boolean}  [options.journal=false]  also write the result as a page "Hand-written audit" in the Build Report
 * @param {string[]} [options.add=[]]         names of PASSING items you judged failing on review: included in the
 *                                            snippet alongside the failing, unlisted ones
 * @param {boolean}  [options.log=true]       console.table the failing rows and print the snippet
 * @returns {Promise<object>} handWrittenAudit() result plus `snippet` (lines to paste into scripts/replace-list.mjs)
 */
export async function auditHandWritten({ journal = false, add = [], log = true } = {}) {
  const pack = game.packs.get(SOURCE_PACK);
  if (!pack) throw new Error(`Loot Ledger: source compendium ${SOURCE_PACK} not found.`);
  const docs = await pack.getDocuments();
  const res = handWrittenAudit(docs, REPLACE_LIST, d => auditHandAuthored(parseSource(d)));
  const extra = new Set(add.map(n => String(n).toLowerCase()));
  const picked = [...res.unlisted, ...res.passing.filter(r => !r.onList && extra.has(r.name.toLowerCase()))];
  res.snippet = replaceListSnippet(picked);
  res.expected = REPLACE_LIST_EXPECTED;
  if (log) {
    console.log(`Loot Ledger | ${res.handWritten} hand-written, ${res.failing.length} failing, ${res.listed} on the replace list (review total ${REPLACE_LIST_EXPECTED}).`);
    console.table(res.failing.map(r => ({ name: r.name, itemId: r.itemId, onList: r.onList, problems: r.problems.join(" | ") })));
    console.log(`Loot Ledger | paste into scripts/replace-list.mjs (REPLACE_LIST):\n${res.snippet}`);
  }
  if (journal) {
    const { REPORT_NAME } = await import("./build.mjs");
    let entry = game.journal.find(j => j.getFlag(MODULE_ID, "buildReport")) ?? game.journal.getName(REPORT_NAME);
    entry ??= await JournalEntry.create({ name: REPORT_NAME, flags: { [MODULE_ID]: { buildReport: true } }, ownership: { default: 0 } });
    const old = entry.pages.filter(p => p.name === "Hand-written audit").map(p => p.id);
    if (old.length) await entry.deleteEmbeddedDocuments("JournalEntryPage", old);
    await entry.createEmbeddedDocuments("JournalEntryPage", [{
      name: "Hand-written audit", type: "text", sort: 900, text: { content: auditPageHtml(res, { expected: REPLACE_LIST_EXPECTED }) + `<h3>Snippet</h3><pre>${res.snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`, format: 1 }
    }]);
    res.journalUuid = entry.uuid;
  }
  return res;
}

export function createApi() {
  return {
    build: (options) => build(options),
    convert: (item, options) => convertItem(item, options),
    auditHandAuthored: (item) => auditHandAuthored(parseSource(item)),
    auditHandWritten: (options) => auditHandWritten(options),
    convertToPack: (options) => convertToPack(options),
    /** Read-only copies of the calibration tables (edit scripts/rules.mjs to change them). */
    rules: () => foundry.utils.deepClone(RULES),
    replaceList: () => REPLACE_LIST.map(e => ({ ...e })),
    roll,
    findTable,
    /** Random suffixes: (re)roll one item (optionally a chosen suffix id), and list the suffix table. GM only. */
    rollSuffix: (item, options) => rollSuffix(item, options),
    suffixes: () => listSuffixes(),
    sellPrice,
    bandForLevel,
    formatCoins,
    BANDS: foundry.utils.deepClone(BANDS),
    QUALITIES: QUALITIES.map(q => q.key),
    TYPES: CATEGORIES.map(c => c.key),
    CREATURES: CREATURES.map(c => c.key)
  };
}
