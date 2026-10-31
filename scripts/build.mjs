/**
 * Build pipeline: copy the source items into a world compendium with sell-accurate prices,
 * then generate the roll tables into a second world compendium.
 */
import {
  MODULE_ID, SOURCE_PACK, QUALITY_BY_KEY, DROP_QUALITIES, BANDS, CATEGORIES, CREATURES,
  analyse, priceFor, formatCoins, bandLabel, creatureRegex
} from "./data.mjs";
import { convertItem, reviewRow, applyOfficial, SRD_PACKS, OFFICIAL_PACKS, CONVERTER_VERSION } from "./convert.mjs";
import {
  sourceHash, rulesFingerprint, planSync, indexReplaceList, replaceEntry, replaceListStatus, reportRow, errorRow,
  summaryCounts, summaryHtml, reportPages
} from "./ledger.mjs";
import { REPLACE_LIST } from "./replace-list.mjs";
import { protectReviewed, carryReview, isRejected } from "./review-model.mjs";
import { CREATURE_TABLE } from "./rules.mjs";

export const ITEMS_PACK = { name: "loot-ledger-items", label: "Loot Ledger · Items" };
export const CONVERTED_PACK = { name: "loot-ledger-converted-items", label: "Loot Ledger · Converted Items" };
export const TABLES_PACK = { name: "loot-ledger-tables", label: "Loot Ledger · Tables" };
export const REPORT_NAME = "Loot Ledger · Build Report";

/** "poor 60%, common 25%, ..." from the drop weights in rules.mjs (DROP_WEIGHT). */
export function dropOdds() {
  const qs = DROP_QUALITIES.filter(q => QUALITY_BY_KEY[q].weight > 0);
  const total = qs.reduce((n, q) => n + QUALITY_BY_KEY[q].weight, 0);
  return qs.map(q => `${q} ${Number((100 * QUALITY_BY_KEY[q].weight / total).toFixed(1))}%`).join(", ");
}

const ITEM_CHUNK = 500;
const TABLE_CHUNK = 25;
const TABLE_IMG = "icons/svg/d20-grey.svg";

/** Deterministic 16-character document id derived from a string, so rebuilds keep stable UUIDs. */
export function stableId(str) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  let out = "";
  for (let round = 0; out.length < 16; round++) {
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i) + round;
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    let n = (h2 >>> 0) * 4294967296 + (h1 >>> 0);
    for (let k = 0; k < 8 && out.length < 16; k++) { out += chars[n % 62]; n = Math.floor(n / 62); }
  }
  return out;
}

function CompendiumCls() {
  return foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
}

/** Find or create a world compendium. */
export async function ensurePack({ name, label }, type) {
  const existing = game.packs.get(`world.${name}`);
  if (existing) return existing;
  return CompendiumCls().createCompendium({ type, label, name, package: "world" });
}

/** Dry runs must never reach a write. Every write path in this file calls this first, so a bug cannot slip one through. */
function noWrites(dryRun, what) {
  if (dryRun) throw new Error(`Loot Ledger: dry run attempted a write (${what}); this is a bug.`);
}

/** The collection id of one of our world packs, whether or not the pack exists yet. */
const worldCollection = ({ name }) => `world.${name}`;

/** Remove every document and folder from one of our packs. */
async function clearPack(pack, dryRun = false) {
  noWrites(dryRun, "clearPack");
  if (pack.locked) await pack.configure({ locked: false });
  const cls = pack.documentClass;
  const ids = Array.from((await pack.getIndex()).keys());
  for (let i = 0; i < ids.length; i += 1000) {
    await cls.deleteDocuments(ids.slice(i, i + 1000), { pack: pack.collection });
  }
  const folderIds = pack.folders.map(f => f.id);
  if (folderIds.length) await Folder.deleteDocuments(folderIds, { pack: pack.collection });
}

function progressBar(label) {
  let note = null;
  try { note = ui.notifications.info(label, { progress: true, permanent: true }); } catch { /* older core */ }
  return {
    update(pct, message) {
      if (note?.update) note.update({ pct: Math.min(1, Math.max(0, pct)), message: message ?? label });
    },
    done(message) {
      if (note?.update) note.update({ pct: 1, message });
      setTimeout(() => { try { note?.remove?.(); } catch { /* ignore */ } }, 2500);
    }
  };
}

function descriptionSuffix(meta) {
  const text = meta.noSell ? "Cannot be sold to vendors." : `Sells for ${formatCoins(meta.vendorSellCopper)}`;
  return `<p class="loot-ledger-sell"><em>${text}</em></p>`;
}

/**
 * Write the rarity in the shape the installed dnd5e version expects:
 * dnd5e 6 stores a set `system.rarities` (and `system.rarity` is a derived getter); dnd5e 5 stores `system.rarity`.
 */
export function setRarity(system, rarity) {
  const major = Number(String(game.system?.version ?? "0").split(".")[0]);
  if (major >= 6 || Array.isArray(system.rarities)) {
    system.rarities = [rarity];
    delete system.rarity;
  } else {
    system.rarity = rarity;
  }
}

/** Build the world copy of one source item. */
export function transformItem(src, meta, ratio) {
  const data = typeof src.toObject === "function" ? src.toObject() : foundry.utils.deepClone(src);
  delete data._stats;
  delete data.folder;
  delete data.ownership;
  data.sort = 0;
  data.system ??= {};
  data.system.price = priceFor(meta.vendorSellCopper, ratio);
  setRarity(data.system, QUALITY_BY_KEY[meta.quality]?.rarity ?? "common");
  const desc = data.system.description?.value ?? "";
  data.system.description = { ...(data.system.description ?? {}), value: desc + descriptionSuffix(meta) };
  data.flags ??= {};
  data.flags[MODULE_ID] = {
    sourceUuid: src.uuid ?? null,
    quality: meta.quality,
    itemLevel: meta.itemLevel,
    ...(meta.requiredLevel !== null ? { requiredLevel: meta.requiredLevel } : {}),
    vendorSellCopper: meta.vendorSellCopper,
    vendorSell: formatCoins(meta.vendorSellCopper),
    noSell: meta.noSell,
    slot: meta.slot,
    category: meta.category,
    band: meta.band,
    coinRatio: ratio
  };
  return data;
}

/**
 * Build the world copy of one source item converted to 5e rules (see convert.mjs), with the sell line.
 * @returns {{data: object, result: object, row: object}}
 */
export function convertedItem(src, meta, ratio, options = {}) {
  const conv = convertItem(src, { ratio, ...options });
  if (options.official) applyOfficial(conv, options.official);
  const desc = conv.data.system.description ?? {};
  conv.data.system.description = { ...desc, value: (desc.value ?? "") + descriptionSuffix(meta) };
  return { data: conv.data, result: conv.result, row: reviewRow(src, conv) };
}

/**
 * Convert a chosen set of source items into a world compendium (replacing its contents), for review.
 * @param {object}   options
 * @param {string[]} [options.names]   exact source item names to convert
 * @param {Function} [options.filter]  or a (sourceDoc, meta) => boolean filter
 * @param {object}   [options.pack]    {name, label} of the target world compendium
 * @param {string}   [options.ratio]   coin ratio override
 * @returns {Promise<{pack: string, rows: object[]}>} review rows, one per converted item
 */
export async function convertToPack({ names = null, filter = null, pack = { name: "loot-ledger-converted", label: "Loot Ledger · Converted" }, ratio = null, options = {} } = {}) {
  if (!game.user.isGM) throw new Error("Loot Ledger: only a GM can convert items.");
  const source = game.packs.get(SOURCE_PACK);
  if (!source) throw new Error("Loot Ledger: the source compendium (wow-classic-items) is not available.");
  ratio ??= game.settings.get(MODULE_ID, "coinRatio");
  let docs;
  if (names) {
    const index = await source.getIndex();
    const ids = names.map(n => index.find(e => e.name === n)?._id).filter(Boolean);
    docs = (await Promise.all(ids.map(id => source.getDocument(id)))).filter(Boolean);
  } else docs = await source.getDocuments();
  const target = await ensurePack(pack, "Item");
  await clearPack(target);
  const payload = [], rows = [];
  const replaceIndex = indexReplaceList(REPLACE_LIST);
  for (const doc of docs) {
    const meta = analyse(doc);
    if (filter && !filter(doc, meta)) continue;
    const opts = { ratio, forceReplace: !!replaceEntry(doc, replaceIndex), ...options };
    const pre = convertItem(doc, opts);
    const official = pre.basedOn ? await findOfficial(pre.basedOn) : null;
    const { data, row } = convertedItem(doc, meta, ratio, { ...opts, official });
    if (pre.basedOn && !official) row.result.fallback = `${pre.basedOn.name} not found in any installed compendium; tier rules kept`;
    data._id = doc.id;
    payload.push(data);
    rows.push(row);
  }
  for (let i = 0; i < payload.length; i += ITEM_CHUNK) {
    await Item.createDocuments(payload.slice(i, i + ITEM_CHUNK), { pack: target.collection, keepId: true });
  }
  return { pack: target.collection, rows };
}

/** An official item from the user's installed compendium (by id, then name), else the SRD by name; or null. */
export async function findOfficial(ref) {
  const own = game.packs.get(ref.pack);
  if (own) {
    const id = ref.id ?? (await own.getIndex()).find(e => e.name === ref.name)?._id;
    const doc = id ? await own.getDocument(id) : null;
    if (doc) return doc;
  }
  for (const key of SRD_PACKS) {
    const pack = game.packs.get(key);
    const e = pack && (await pack.getIndex()).find(x => x.name === ref.name);
    if (e) return pack.getDocument(e._id);
  }
  return null;
}

/** Turn a list of weighted results into RollTable source data with contiguous ranges. */
function tableData({ name, folder, sort, description, flags, results }) {
  let lo = 1;
  const rows = results.map(r => {
    const w = Math.max(1, Math.round(r.weight ?? 1));
    const row = {
      type: "document", documentUuid: r.uuid, name: r.name, img: r.img ?? TABLE_IMG,
      weight: w, range: [lo, lo + w - 1], drawn: false
    };
    lo += w;
    return row;
  });
  return {
    _id: stableId(`table:${name}`), name, folder, sort, img: TABLE_IMG, description,
    formula: `1d${Math.max(1, lo - 1)}`, replacement: true, displayRoll: true, results: rows,
    flags: { [MODULE_ID]: flags }
  };
}

/**
 * Plan every roll table from the analysed item list.
 * @param {object[]} metas     analysed items ({id, uuid, name, img, quality, band, category, rollable})
 * @param {string}   tablePack collection id of the tables pack (for sub-table UUIDs)
 * @param {object}   folders   {quality, type, drop, creature} folder ids
 */
export function planTables(metas, tablePack, folders) {
  const tables = [];
  const pool = metas.filter(m => m.rollable);
  const uuidOf = t => `Compendium.${tablePack}.RollTable.${t._id}`;
  const asResult = m => ({ uuid: m.uuid, name: m.name, img: m.img, weight: 1 });
  const byName = (a, b) => a.name.localeCompare(b.name);
  let sort = 0;

  for (const b of BANDS) {
    const inBand = pool.filter(m => m.band === b.band);
    const range = b.max === Infinity ? `${b.min}+` : `${b.min}–${b.max}`;
    const prefix = `Loot · ${bandLabel(b.band)}`;

    // Quality tables
    const qualityTables = {};
    for (const qk of DROP_QUALITIES) {
      const q = QUALITY_BY_KEY[qk];
      const items = inBand.filter(m => m.quality === qk).sort(byName);
      if (!items.length) continue;
      const t = tableData({
        name: `${prefix} · ${q.label}`, folder: folders.quality, sort: sort++,
        description: `${q.label} quality items, item level ${range} (about character levels ${b.levels.slice(1)}).`,
        flags: { kind: "quality", band: b.band, quality: qk },
        results: items.map(asResult)
      });
      qualityTables[qk] = t;
      tables.push(t);
    }

    // Item-type tables
    for (const cat of CATEGORIES) {
      const items = inBand.filter(m => m.category === cat.key).sort(byName);
      if (!items.length) continue;
      tables.push(tableData({
        name: `${prefix} · ${cat.label}`, folder: folders.type, sort: sort++,
        description: `${cat.label}, item level ${range}. Every result has equal weight.`,
        flags: { kind: "type", band: b.band, type: cat.key },
        results: items.map(asResult)
      }));
    }

    // Mixed drop table: rolls one of the quality tables with classic-style weights.
    const dropResults = DROP_QUALITIES.filter(qk => qualityTables[qk]).map(qk => ({
      uuid: uuidOf(qualityTables[qk]), name: qualityTables[qk].name, img: TABLE_IMG, weight: QUALITY_BY_KEY[qk].weight
    }));
    let drop = null;
    if (dropResults.length) {
      drop = tableData({
        name: `${prefix} · Drop (mixed)`, folder: folders.drop, sort: sort++,
        description: `A typical drop for item level ${range}: rolls a quality table (${dropOdds()}, re-weighted when a quality is missing).`,
        flags: { kind: "drop", band: b.band },
        results: dropResults
      });
      tables.push(drop);
    }

    // Creature tables: type-appropriate junk plus the band's mixed drop (about half each).
    const junk = pool.filter(m => m.category === "junk");
    for (const c of CREATURES) {
      const rx = creatureRegex(c);
      const matches = junk.filter(m => rx.test(m.name));
      let items = matches.filter(m => Math.abs(m.band - b.band) <= CREATURE_TABLE.bandSpread);
      if (items.length < CREATURE_TABLE.minItems) items = matches;
      if (c.gear) items = items.concat(inBand.filter(m => m.quality === "poor" && m.category !== "junk"));
      items = items.sort(byName);
      const results = items.map(asResult);
      if (drop) results.push({ uuid: uuidOf(drop), name: drop.name, img: TABLE_IMG, weight: Math.max(1, items.length) });
      if (!results.length) continue;
      tables.push(tableData({
        name: `${prefix} · Creature · ${c.label}`, folder: folders.creature, sort: sort++,
        description: `${c.label} remains for item level ${range}: about half the time ${c.label.toLowerCase()} junk, otherwise the band's mixed drop.`,
        flags: { kind: "creature", band: b.band, creature: c.key },
        results
      }));
    }
  }

  // One table for the rare legendary/artifact items, any band.
  const top = pool.filter(m => m.quality === "legendary" || m.quality === "artifact").sort(byName);
  if (top.length) tables.push(tableData({
    name: "Loot · Legendary & Artifact", folder: folders.quality, sort: sort++,
    description: "Legendary and artifact items from every band. Use sparingly.",
    flags: { kind: "quality", band: null, quality: "legendary" },
    results: top.map(asResult)
  }));
  return tables;
}

async function confirmRebuild(labels, convert) {
  const DialogV2 = foundry.applications.api.DialogV2;
  return DialogV2.confirm({
    window: { title: "Loot Ledger: build loot pools" },
    content: `<p>This brings the world compendiums ${labels.map(l => `<strong>${l}</strong>`).join(", ")} up to date
      with the source module. Items whose source and rules are unchanged since the last build are skipped; changed
      items are rewritten; the roll tables are regenerated.</p>
      <p>5e conversion is <strong>${convert ? "on" : "off"}</strong> (setting "Convert items to 5e when building").</p>
      <p>Nothing else in your world is changed, apart from the <strong>${REPORT_NAME}</strong> journal entry.
      The first build, or one after a rules change, can take several minutes.</p>`,
    rejectClose: false, modal: true
  });
}

/** Create the per-category item folders that are missing (stable ids). Returns {category: folderId}. */
async function ensureItemFolders(pack, dryRun = false) {
  const ids = {};
  const missing = [];
  CATEGORIES.forEach((c, i) => {
    ids[c.key] = stableId(`ifolder:${c.key}`);
    if (!pack?.folders.get(ids[c.key])) missing.push({ _id: ids[c.key], name: c.label, type: "Item", sort: (i + 1) * 100, sorting: "a" });
  });
  if (missing.length && !dryRun) await Folder.createDocuments(missing, { pack: pack.collection, keepId: true });
  return ids;
}

/** id -> stored hash for every document in one of our item packs, plus the stored Loot Ledger flags. */
async function packState(pack) {
  if (!pack) return { hashes: new Map(), flags: new Map() }; // dry run and the pack does not exist yet
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}`] });
  const hashes = new Map(), flags = new Map();
  for (const e of index) {
    const f = foundry.utils.getProperty(e, `flags.${MODULE_ID}`) ?? {};
    hashes.set(e._id, f.hash ?? null);
    flags.set(e._id, { name: e.name, flags: f });
  }
  return { hashes, flags };
}

/**
 * Write a sync plan into a pack in batches. Each batch deletes its stale documents and creates their new data, so
 * an interrupted build leaves at most one batch missing and the next run (which compares hashes) fills it in.
 * `dataFor(id)` may return null (item could not be produced): it is then left out of the pack.
 */
async function applySync(pack, plan, dataFor, { onProgress, label, dryRun = false }) {
  const stale = new Set(plan.replace);
  const ids = [...plan.create, ...plan.replace];
  const produced = new Map(); // dry run: id -> the data that would have been written
  for (let i = 0; i < ids.length; i += ITEM_CHUNK) {
    const slice = ids.slice(i, i + ITEM_CHUNK);
    const batch = [];
    for (const id of slice) {
      const data = await dataFor(id);
      if (data) { batch.push(data); if (dryRun) produced.set(id, data); }
    }
    if (dryRun) { onProgress?.((i + slice.length) / ids.length, `${label} ${Math.min(i + ITEM_CHUNK, ids.length)} / ${ids.length}`); continue; }
    noWrites(dryRun, "applySync");
    const del = slice.filter(id => stale.has(id));
    if (del.length) await Item.deleteDocuments(del, { pack: pack.collection });
    if (batch.length) await Item.createDocuments(batch, { pack: pack.collection, keepId: true });
    onProgress?.((i + slice.length) / ids.length, `${label} ${Math.min(i + ITEM_CHUNK, ids.length)} / ${ids.length}`);
  }
  if (dryRun) return produced;
  for (let i = 0; i < plan.remove.length; i += 1000) {
    noWrites(dryRun, "applySync remove");
    await Item.deleteDocuments(plan.remove.slice(i, i + 1000), { pack: pack.collection });
  }
  return produced;
}

/** Find or create the Build Report journal entry and replace its pages. */
async function writeReport(pages, dryRun = false) {
  noWrites(dryRun, "writeReport");
  let entry = game.journal.find(j => j.getFlag(MODULE_ID, "buildReport")) ?? game.journal.getName(REPORT_NAME);
  if (!entry) {
    entry = await JournalEntry.create({ name: REPORT_NAME, flags: { [MODULE_ID]: { buildReport: true } }, ownership: { default: 0 } });
  } else {
    const old = entry.pages.map(p => p.id);
    if (old.length) await entry.deleteEmbeddedDocuments("JournalEntryPage", old);
  }
  await entry.createEmbeddedDocuments("JournalEntryPage", pages.map((p, i) => ({
    name: p.name, type: "text", sort: (i + 1) * 100, text: { content: p.html, format: 1 }
  })));
  return entry;
}

/**
 * Build (or update) the loot pools.
 *
 * Idempotent and resumable: every written item carries flags["loot-ledger"].hash (see ledger.mjs sourceHash), so
 * a re-run skips items whose source, coin ratio, rules and converter version are unchanged, rewrites the rest, and
 * removes items no longer in the source (full builds only). A build that stops part-way picks up where it left
 * off. Roll tables are always regenerated (stable ids).
 *
 * Review board decisions (flags["loot-ledger"].review, see review-model.mjs): converted items the GM accepted or
 * tweaked are never rewritten, even when their source or the rules changed, so manual edits survive; `force: true`
 * rewrites them too (their status goes back to pending; the note is kept). Skip / Reject / notes are carried onto
 * rewritten items. Rejected items are left out of the roll tables.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.confirm=true]   ask first
 * @param {object}   [options.itemsPack]      {name, label} of the plain-copy items compendium
 * @param {object}   [options.convertedPack]  {name, label} of the converted items compendium
 * @param {object}   [options.tablesPack]     {name, label} of the tables compendium
 * @param {Function} [options.filter]         optional (sourceDoc, meta) => boolean to build a subset (no pruning)
 * @param {string}   [options.ratio]          coin ratio override ("100" or "10")
 * @param {boolean}  [options.convert]        convert to 5e (default: the "Convert items to 5e when building" setting)
 * @param {boolean}  [options.force=false]    ignore stored hashes and rewrite every item, including converted items
 *                                            the GM accepted or tweaked on the review board (their manual edits are lost)
 * @param {boolean}  [options.report=true]    whisper the GM summary and write the Build Report journal
 * @param {boolean}  [options.dryRun=false]   run every stage up to the writes and return the plan, the report data and the
 *                                            summary counts instead of writing anything: no compendium or folder is created,
 *                                            changed or cleared, no Build Report is written, no chat message is sent, no
 *                                            confirm dialog is shown. Packs that already exist are only read.
 */
export async function build({
  confirm = true, itemsPack = ITEMS_PACK, convertedPack = CONVERTED_PACK, tablesPack = TABLES_PACK,
  filter = null, ratio = null, convert = null, force = false, report = true, dryRun = false
} = {}) {
  if (!game.user.isGM) throw new Error("Loot Ledger: only a GM can build loot pools.");
  const source = game.packs.get(SOURCE_PACK);
  if (!source) {
    ui.notifications.error("Loot Ledger: the source compendium (wow-classic-items) is not available. Is the module enabled?");
    return null;
  }
  convert ??= !!game.settings.get(MODULE_ID, "convertOnBuild");
  const labels = [itemsPack.label, ...(convert ? [convertedPack.label] : []), tablesPack.label];
  if (confirm && !dryRun && !(await confirmRebuild(labels, convert))) return null;
  ratio ??= game.settings.get(MODULE_ID, "coinRatio");
  const dnd5eMajor = Number(String(game.system?.version ?? "0").split(".")[0]);

  const bar = dryRun ? { update() {}, done() {} } : progressBar("Loot Ledger: reading source items…");
  const t0 = performance.now();
  try {
    const docs = await source.getDocuments();
    bar.update(0.04, `Loot Ledger: analysing ${docs.length} items…`);

    // A dry run only looks at packs that already exist (missing ones read as empty); it never creates or unlocks anything.
    const getPack = async (def, type) => dryRun ? (game.packs.get(worldCollection(def)) ?? null) : ensurePack(def, type);
    const items = await getPack(itemsPack, "Item");
    const conv = convert ? await getPack(convertedPack, "Item") : null;
    const tables = await getPack(tablesPack, "RollTable");
    if (!dryRun) for (const p of [items, conv, tables]) if (p?.locked) await p.configure({ locked: false });
    const itemFolders = await ensureItemFolders(items, dryRun);
    const convFolders = convert ? await ensureItemFolders(conv, dryRun) : null;
    const itemsId = worldCollection(itemsPack), convId = worldCollection(convertedPack), tablesId = worldCollection(tablesPack);

    // Analyse and hash every source item.
    const rules = rulesFingerprint();
    const officialPacks = [...Object.values(OFFICIAL_PACKS), ...SRD_PACKS].filter(k => game.packs.has(k));
    const replaceIndex = indexReplaceList(REPLACE_LIST);
    const byId = new Map(), copyWant = [], convWant = [], replaceHits = [];
    for (const doc of docs) {
      const meta = analyse(doc);
      if (filter && !filter(doc, meta)) continue;
      const entry = replaceEntry(doc, replaceIndex);
      if (entry) replaceHits.push({ entry, handAuthored: !!doc.flags?.["wow-classic-items"]?.handAuthored });
      const rec = {
        doc, meta, replace: !!entry,
        copyHash: sourceHash(doc, { mode: "copy", ratio, dnd5eMajor })
      };
      copyWant.push({ id: doc.id, hash: rec.copyHash });
      if (convert) {
        rec.convHash = sourceHash(doc, { mode: "convert", ratio, converterVersion: CONVERTER_VERSION, rules, replace: rec.replace, officialPacks, dnd5eMajor });
        convWant.push({ id: doc.id, hash: rec.convHash });
      }
      byId.set(doc.id, rec);
    }
    const prune = !filter;

    // 1. Plain copies.
    const copyState = await packState(items);
    const copyPlan = planSync(force ? new Map([...copyState.hashes].map(([k]) => [k, null])) : copyState.hashes, copyWant, { prune });
    bar.update(0.08, `Loot Ledger: copying ${copyPlan.create.length + copyPlan.replace.length} items (${copyPlan.skip.length} unchanged)…`);
    await applySync(items, copyPlan, id => {
      const { doc, meta, copyHash } = byId.get(id);
      const data = transformItem(doc, meta, ratio);
      data._id = doc.id;
      data.folder = itemFolders[meta.category] ?? null;
      data.flags[MODULE_ID].hash = copyHash;
      return data;
    }, { dryRun, label: "Loot Ledger: items", onProgress: (f, m) => bar.update(0.08 + (convert ? 0.27 : 0.62) * f, m) });

    // 2. 5e conversions (separate pack; tables point here when conversion is on).
    let convPlan = null, convProduced = new Map(), reviewProtected = [];
    const failed = new Map();
    if (convert) {
      const convState = await packState(conv);
      const planned = planSync(force ? new Map([...convState.hashes].map(([k]) => [k, null])) : convState.hashes, convWant, { prune });
      // Accepted / tweaked items keep the stored (possibly hand-edited) version unless force.
      ({ plan: convPlan, protected: reviewProtected } = protectReviewed(planned, convState.flags, { force }));
      bar.update(0.36, `Loot Ledger: converting ${convPlan.create.length + convPlan.replace.length} items (${convPlan.skip.length} unchanged)…`);
      const officialCache = new Map();
      const official = async ref => {
        const key = `${ref.pack}|${ref.id ?? ""}|${ref.name}`;
        if (!officialCache.has(key)) officialCache.set(key, await findOfficial(ref));
        return officialCache.get(key);
      };
      // Items the converter throws on go to GM review; their stale conversion is removed (tables use the plain copy).
      convProduced = await applySync(conv, convPlan, async id => {
        const { doc, meta, replace, convHash } = byId.get(id);
        try {
          const opts = { ratio, dnd5eMajor, forceReplace: replace };
          const pre = convertItem(doc, opts);
          const off = pre.basedOn ? await official(pre.basedOn) : null;
          const { data } = convertedItem(doc, meta, ratio, { ...opts, official: off });
          if (pre.basedOn && !off) data.flags[MODULE_ID].converted.fallback = `${pre.basedOn.name} not found in any installed compendium; tier rules kept`;
          data._id = doc.id;
          data.folder = convFolders[meta.category] ?? null;
          data.flags[MODULE_ID].hash = convHash;
          const review = carryReview(convState.flags.get(id)?.flags?.review, { force });
          if (review) data.flags[MODULE_ID].review = review;
          return data;
        } catch (err) {
          console.error(`${MODULE_ID} | conversion failed for ${doc.name}`, err);
          failed.set(id, err.message);
          return null;
        }
      }, { dryRun, label: "Loot Ledger: converted", onProgress: (f, m) => bar.update(0.36 + 0.34 * f, m) });
    }

    // 3. Roll tables: converted versions when available, plain copies otherwise.
    // Dry run: what the converted pack would hold after this build (stored items, minus removals, plus freshly converted ones).
    const convStored = convert ? (await packState(conv)).flags : new Map();
    if (dryRun && convert) {
      for (const id of convPlan.remove) convStored.delete(id);
      for (const [id, d] of convProduced) convStored.set(id, { name: d.name, flags: d.flags?.[MODULE_ID] ?? {} });
    }
    // Items rejected on the review board stay out of the tables (the decision lives on the converted item, which
    // is read even when conversion is now off).
    const reviewFlags = convert ? convStored : (await packState(game.packs.get(convId) ?? null)).flags;
    const rejected = new Set([...reviewFlags].filter(([, v]) => isRejected(v.flags)).map(([id]) => id));
    const metas = [];
    for (const [id, { doc, meta }] of byId) {
      const inConv = convert && convStored.has(id) && !failed.has(id);
      metas.push({
        ...meta, id, name: doc.name, img: doc.img, rollable: meta.rollable && !rejected.has(id),
        uuid: inConv ? `Compendium.${convId}.Item.${id}` : `Compendium.${itemsId}.Item.${id}`
      });
    }
    bar.update(0.72, "Loot Ledger: generating roll tables…");
    if (!dryRun) await clearPack(tables);
    const tf = { quality: "By quality", type: "By item type", drop: "Mixed drops", creature: "By creature type" };
    const tableFolders = {};
    const folderData = Object.entries(tf).map(([k, name], i) => {
      tableFolders[k] = stableId(`tfolder:${k}`);
      return { _id: tableFolders[k], name, type: "RollTable", sort: (i + 1) * 100, sorting: "m" };
    });
    if (!dryRun) await Folder.createDocuments(folderData, { pack: tables.collection, keepId: true });
    const plan = planTables(metas, tablesId, tableFolders);
    for (let i = 0; !dryRun && i < plan.length; i += TABLE_CHUNK) {
      noWrites(dryRun, "table write");
      await RollTable.createDocuments(plan.slice(i, i + TABLE_CHUNK), { pack: tables.collection, keepId: true });
      bar.update(0.75 + 0.2 * ((i + TABLE_CHUNK) / plan.length), `Loot Ledger: tables ${Math.min(i + TABLE_CHUNK, plan.length)} / ${plan.length}`);
    }

    // 4. Report: every converted item in the pack (fresh or unchanged), plus conversion errors.
    const rows = [];
    if (convert) {
      for (const [id, { name, flags }] of convStored) {
        if (byId.has(id) && !failed.has(id)) rows.push(reportRow(id, name, flags, `Compendium.${convId}.Item.${id}`));
      }
      for (const [id, msg] of failed) {
        const { doc, meta } = byId.get(id);
        rows.push(errorRow(id, doc.name, meta, `Compendium.${itemsId}.Item.${id}`, msg));
      }
    }
    const rl = convert ? replaceListStatus(REPLACE_LIST, replaceHits) : null;
    const seconds = Math.round((performance.now() - t0) / 100) / 10;
    const counts = summaryCounts({ copy: copyPlan, convert: convPlan, rows, protected: reviewProtected.length, rejected: rejected.size });

    const kinds = plan.reduce((acc, t) => {
      const k = t.flags[MODULE_ID].kind;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    let reportUuid = null;
    if (dryRun) {
      const pages = reportPages(counts, rows, { convertOn: convert, replaceList: rl, tables: plan.length, seconds });
      const result = {
        dryRun: true, items: copyWant.length, rollable: metas.filter(m => m.rollable).length, tables: plan.length, counts: kinds,
        build: counts, convert, replaceList: rl, seconds,
        itemsPack: itemsId, convertedPack: convert ? convId : null, tablesPack: tablesId,
        plan: { copy: copyPlan, convert: convPlan, tables: plan },
        report: { rows, pages, summaryHtml: summaryHtml(counts, { convertOn: convert, tables: plan.length, seconds }) }
      };
      console.info(`${MODULE_ID} | dry run: nothing was written.`, result.build);
      return result;
    }
    if (report) {
      const pages = reportPages(counts, rows, { convertOn: convert, replaceList: rl, tables: plan.length, seconds });
      noWrites(dryRun, "report");
      const entry = await writeReport(pages);
      reportUuid = entry.uuid;
      noWrites(dryRun, "chat message");
      await ChatMessage.create({
        content: summaryHtml(counts, { convertOn: convert, tables: plan.length, seconds, reportUuid }),
        whisper: game.users.filter(u => u.isGM).map(u => u.id),
        speaker: { alias: "Loot Ledger" }
      });
    }

    const summary = {
      items: copyWant.length, rollable: metas.filter(m => m.rollable).length, tables: plan.length, counts: kinds,
      build: counts, convert, replaceList: rl, reportUuid,
      seconds, itemsPack: items.collection, convertedPack: conv?.collection ?? null, tablesPack: tables.collection
    };
    bar.done(`Loot Ledger: built ${summary.items} items and ${summary.tables} tables.`);
    ui.notifications.info(`Loot Ledger: ${counts.copied + counts.converted} items written, ${counts.skipped} unchanged, ${summary.tables} roll tables (${seconds}s).`);
    return summary;
  } catch (err) {
    bar.done("Loot Ledger: build failed.");
    ui.notifications.error(`Loot Ledger: build failed (${err.message}). Run it again to resume; see the console for details.`);
    console.error(`${MODULE_ID} |`, err);
    throw err;
  }
}
