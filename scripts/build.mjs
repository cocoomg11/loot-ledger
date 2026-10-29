/**
 * Build pipeline: copy the source items into a world compendium with sell-accurate prices,
 * then generate the roll tables into a second world compendium.
 */
import {
  MODULE_ID, SOURCE_PACK, QUALITY_BY_KEY, DROP_QUALITIES, BANDS, CATEGORIES, CREATURES,
  analyse, priceFor, formatCoins, bandLabel, creatureRegex
} from "./data.mjs";

export const ITEMS_PACK = { name: "loot-ledger-items", label: "Loot Ledger · Items" };
export const TABLES_PACK = { name: "loot-ledger-tables", label: "Loot Ledger · Tables" };

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

/** Remove every document and folder from one of our packs. */
async function clearPack(pack) {
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
        description: `A typical drop for item level ${range}: rolls a quality table (poor 60%, common 25%, uncommon 12%, rare 2.5%, epic 0.5%, re-weighted when a quality is missing).`,
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
      let items = matches.filter(m => Math.abs(m.band - b.band) <= 1);
      if (items.length < 3) items = matches;
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

async function confirmRebuild(itemsLabel, tablesLabel) {
  const DialogV2 = foundry.applications.api.DialogV2;
  return DialogV2.confirm({
    window: { title: "Loot Ledger: build loot pools" },
    content: `<p>This will <strong>replace</strong> the contents of the world compendiums
      <strong>${itemsLabel}</strong> and <strong>${tablesLabel}</strong> with a fresh copy of every item from
      the source module and newly generated roll tables.</p>
      <p>Nothing else in your world is changed. It can take a few minutes for large item lists.</p>`,
    rejectClose: false, modal: true
  });
}

/**
 * Build (or rebuild) the loot pools.
 * @param {object}   [options]
 * @param {boolean}  [options.confirm=true]   ask before replacing pack contents
 * @param {object}   [options.itemsPack]      {name, label} of the items compendium
 * @param {object}   [options.tablesPack]     {name, label} of the tables compendium
 * @param {Function} [options.filter]         optional (sourceDoc, meta) => boolean to build a subset
 * @param {string}   [options.ratio]          coin ratio override ("100" or "10")
 */
export async function build({ confirm = true, itemsPack = ITEMS_PACK, tablesPack = TABLES_PACK, filter = null, ratio = null } = {}) {
  if (!game.user.isGM) throw new Error("Loot Ledger: only a GM can build loot pools.");
  const source = game.packs.get(SOURCE_PACK);
  if (!source) {
    ui.notifications.error("Loot Ledger: the source compendium (wow-classic-items) is not available. Is the module enabled?");
    return null;
  }
  if (confirm && !(await confirmRebuild(itemsPack.label, tablesPack.label))) return null;
  ratio ??= game.settings.get(MODULE_ID, "coinRatio");

  const bar = progressBar("Loot Ledger: reading source items…");
  const t0 = performance.now();
  try {
    const docs = await source.getDocuments();
    bar.update(0.05, `Loot Ledger: analysing ${docs.length} items…`);

    const items = await ensurePack(itemsPack, "Item");
    const tables = await ensurePack(tablesPack, "RollTable");
    await clearPack(items);
    await clearPack(tables);
    bar.update(0.1, "Loot Ledger: preparing folders…");

    // Item folders, one per category
    const itemFolders = {};
    const folderData = CATEGORIES.map((c, i) => {
      itemFolders[c.key] = stableId(`ifolder:${c.key}`);
      return { _id: itemFolders[c.key], name: c.label, type: "Item", sort: (i + 1) * 100, sorting: "a" };
    });
    await Folder.createDocuments(folderData, { pack: items.collection, keepId: true });

    const metas = [];
    const payload = [];
    for (const doc of docs) {
      const meta = analyse(doc);
      if (filter && !filter(doc, meta)) continue;
      const data = transformItem(doc, meta, ratio);
      data._id = doc.id;
      data.folder = itemFolders[meta.category] ?? null;
      payload.push(data);
      metas.push({
        ...meta, id: doc.id, name: doc.name, img: doc.img,
        uuid: `Compendium.${items.collection}.Item.${doc.id}`
      });
    }

    for (let i = 0; i < payload.length; i += ITEM_CHUNK) {
      await Item.createDocuments(payload.slice(i, i + ITEM_CHUNK), { pack: items.collection, keepId: true });
      bar.update(0.1 + 0.7 * ((i + ITEM_CHUNK) / payload.length), `Loot Ledger: items ${Math.min(i + ITEM_CHUNK, payload.length)} / ${payload.length}`);
    }

    // Table folders
    const tf = { quality: "By quality", type: "By item type", drop: "Mixed drops", creature: "By creature type" };
    const tableFolders = {};
    await Folder.createDocuments(Object.entries(tf).map(([k, name], i) => {
      tableFolders[k] = stableId(`tfolder:${k}`);
      return { _id: tableFolders[k], name, type: "RollTable", sort: (i + 1) * 100, sorting: "m" };
    }), { pack: tables.collection, keepId: true });

    const plan = planTables(metas, tables.collection, tableFolders);
    for (let i = 0; i < plan.length; i += TABLE_CHUNK) {
      await RollTable.createDocuments(plan.slice(i, i + TABLE_CHUNK), { pack: tables.collection, keepId: true });
      bar.update(0.8 + 0.2 * ((i + TABLE_CHUNK) / plan.length), `Loot Ledger: tables ${Math.min(i + TABLE_CHUNK, plan.length)} / ${plan.length}`);
    }

    const counts = plan.reduce((acc, t) => {
      const k = t.flags[MODULE_ID].kind;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    const summary = {
      items: payload.length, rollable: metas.filter(m => m.rollable).length, tables: plan.length, counts,
      seconds: Math.round((performance.now() - t0) / 100) / 10, itemsPack: items.collection, tablesPack: tables.collection
    };
    bar.done(`Loot Ledger: built ${summary.items} items and ${summary.tables} tables.`);
    ui.notifications.info(`Loot Ledger: built ${summary.items} items and ${summary.tables} roll tables in ${summary.seconds}s.`);
    return summary;
  } catch (err) {
    bar.done("Loot Ledger: build failed.");
    ui.notifications.error(`Loot Ledger: build failed (${err.message}). See the console for details.`);
    console.error(`${MODULE_ID} |`, err);
    throw err;
  }
}

