/**
 * Merchant tables (pure): vendor types, world-data defaults, the merchant mapping record, table names, the Item Piles
 * `tablesForPopulate` plan and the restock plan. No Foundry calls at import or call time; tested in Node.
 *
 * Item Piles 3.3.4 facts this relies on (checked in its source at tag 3.3.4):
 * - merchant flag `flags.item-piles.data.tablesForPopulate` = [{ uuid, addAll, timesToRoll, items, customCategory }]
 *   (`rollMerchantTables` in src/helpers/pile-utilities.js: addAll → `items` maps a TableResult id to a quantity formula;
 *   otherwise the table is drawn `timesToRoll` (a dice formula) times; a roll of 0 or less adds nothing);
 * - item flag `flags.item-piles.item` defaults (`CONSTANTS.ITEM_DEFAULTS`): `keepOnMerchant`, `isService`,
 *   `infiniteQuantity` ("default" | "yes" | "no"), `cantBeSoldToMerchants`; Item Piles' own "clear items" button and its
 *   calendar refresh keep `keepOnMerchant` (and `keepIfZero`) items.
 */

/** Version of the stored mapping and defaults records. */
export const MAP_VERSION = 1;
export const DEFAULTS_VERSION = 1;
/** Caps: merchants in the mapping, types per merchant, bands. */
export const MERCHANTS_MAX = 500;
export const TYPES_PER_MERCHANT = 6;
export const BANDS_MAX = 12;
/** Longest dice formula kept for a size. */
export const FORMULA_MAX = 40;

/** Table kinds per type and band. basics = always stocked (infinite), stock = rolled, rare = rolled, fewer. */
export const KINDS = /** @type {const} */ (["basics", "stock", "rare"]);
/** Folder (RollTable) the shop tables live in; subfolders per type. Tables are found by name, anywhere in the world. */
export const TABLE_FOLDER = "Merchant stock";
/** Name prefix of every shop table; Apply replaces only entries whose table carries it. */
export const TABLE_PREFIX = "Shop · ";

/** The 16 vendor types. `tables: false` = hand-stocked (no tables, nothing applied or restocked from tables). */
export const VENDOR_TYPES = Object.freeze([
  { key: "general", label: "General goods" },
  { key: "food", label: "Food and drink" },
  { key: "inn", label: "Inn" },
  { key: "reagents", label: "Reagents" },
  { key: "trade", label: "Trade goods" },
  { key: "weapons", label: "Weapons" },
  { key: "ammo", label: "Ammunition" },
  { key: "bows", label: "Bows" },
  { key: "guns", label: "Guns" },
  { key: "armor-heavy", label: "Heavy armour" },
  { key: "armor-light", label: "Light armour" },
  { key: "arcane", label: "Arcane goods" },
  { key: "healer", label: "Healer" },
  { key: "tinker", label: "Tinker" },
  { key: "fence", label: "Fence" },
  { key: "special", label: "Special (hand-stocked)", tables: false }
].map(t => Object.freeze({ tables: true, ...t })));
export const TYPE_KEYS = VENDOR_TYPES.map(t => t.key);
const TYPE_BY_KEY = Object.fromEntries(VENDOR_TYPES.map(t => [t.key, t]));

/** Merchant sizes; the default formulas are editable world data. */
export const SIZES = /** @type {const} */ (["city", "town", "outpost", "wandering"]);
export const SIZE_LABELS = Object.freeze({ city: "City", town: "Town", outpost: "Outpost", wandering: "Wandering" });

/** The editable defaults (world data). */
export function defaultDefaults() {
  /** @type {Record<string, {buy:number, sell:number, hideNewItems:boolean, purchaseOnly:boolean}>} */
  const types = {};
  for (const t of TYPE_KEYS) types[t] = { buy: 1, sell: 0.25, hideNewItems: false, purchaseOnly: false };
  types.arcane.buy = 1.1;
  types.healer.buy = 1.1;
  types.fence = { buy: 1.25, sell: 0.5, hideNewItems: true, purchaseOnly: false };
  return {
    v: DEFAULTS_VERSION,
    types,
    sizes: {
      city: { stock: "2d4+2", rare: "1d2" },
      town: { stock: "1d4+2", rare: "1d2-1" },
      outpost: { stock: "1d4", rare: "0" },
      wandering: { stock: "1d4+1", rare: "1d2-1" }
    },
    bands: [1, 2, 3, 4, 5, 6].map(b => ({ band: b, min: (b - 1) * 10 + 1, max: b * 10 }))
  };
}

const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
/** A finite number in [0, 10] rounded to 3 decimals, else the fallback. */
function modifier(v, fallback) {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n) || n < 0 || n > 10) return fallback;
  return Math.round(n * 1000) / 1000;
}
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
const intIn = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
};

/** A dice formula kept only when it is plain dice and numbers with + and − (Item Piles evaluates it as a Roll). */
export const FORMULA_RE = /^\s*(\d{1,3}(d\d{1,3})?)(\s*[+-]\s*\d{1,3}(d\d{1,3})?){0,5}\s*$/i;
export function cleanFormula(v, fallback) {
  const s = String(v ?? "").trim();
  return s.length <= FORMULA_MAX && FORMULA_RE.test(s) ? s.replace(/\s+/g, "") : fallback;
}

/**
 * The one reader of the defaults record: unknown keys dropped, bad values replaced by the shipped default, bands sorted,
 * capped and unique (never empty).
 * @param {unknown} raw
 */
export function normalizeDefaults(raw) {
  const d = defaultDefaults();
  if (!isObj(raw) || (raw.v !== undefined && raw.v !== DEFAULTS_VERSION)) return d;
  const r = /** @type {any} */ (raw);
  for (const t of TYPE_KEYS) {
    const src = isObj(r.types?.[t]) ? r.types[t] : {};
    const def = d.types[t];
    d.types[t] = {
      buy: modifier(src.buy, def.buy),
      sell: modifier(src.sell, def.sell),
      hideNewItems: bool(src.hideNewItems, def.hideNewItems),
      purchaseOnly: bool(src.purchaseOnly, def.purchaseOnly)
    };
  }
  for (const s of SIZES) {
    const src = isObj(r.sizes?.[s]) ? r.sizes[s] : {};
    d.sizes[s] = { stock: cleanFormula(src.stock, d.sizes[s].stock), rare: cleanFormula(src.rare, d.sizes[s].rare) };
  }
  if (Array.isArray(r.bands)) {
    const seen = new Set();
    const bands = [];
    for (const b of r.bands) {
      if (!isObj(b)) continue;
      const band = intIn(b.band, 1, 99, null);
      const min = intIn(b.min, 0, 999, null);
      const max = intIn(b.max, 0, 999, null);
      if (band === null || min === null || max === null || min > max || seen.has(band)) continue;
      seen.add(band);
      bands.push({ band, min, max });
    }
    bands.sort((a, b) => a.band - b.band);
    if (bands.length) d.bands = bands.slice(0, BANDS_MAX);
  }
  return d;
}

/** An empty mapping record. */
export const emptyMap = () => ({ v: MAP_VERSION, merchants: {} });

/** A Foundry document id (16 alphanumerics). */
export const ID_RE = /^[A-Za-z0-9]{16}$/;

/**
 * One merchant's entry: types (known, unique, ≤ TYPES_PER_MERCHANT), band (integer or null = not set; a wandering merchant's
 * band can also be picked at apply time), size, and price overrides (null = the first type's default).
 * @param {unknown} raw
 */
export function cleanEntry(raw) {
  const r = isObj(raw) ? /** @type {any} */ (raw) : {};
  const types = [...new Set((Array.isArray(r.types) ? r.types : []).map(String).filter(t => TYPE_BY_KEY[t]))].slice(0, TYPES_PER_MERCHANT);
  return {
    types,
    band: intIn(r.band, 1, 99, null),
    size: SIZES.includes(r.size) ? r.size : "town",
    buy: modifier(r.buy, null),
    sell: modifier(r.sell, null),
    hideNewItems: bool(r.hideNewItems, null),
    purchaseOnly: bool(r.purchaseOnly, null)
  };
}

/**
 * The one reader of the mapping record `{ v: 1, merchants: { actorId: entry } }`: bad ids and entries dropped, capped at
 * MERCHANTS_MAX (first ones kept). A newer version than this code reads as empty (never written back damaged).
 * @param {unknown} raw
 */
export function normalizeMap(raw) {
  const out = emptyMap();
  if (!isObj(raw)) return out;
  const r = /** @type {any} */ (raw);
  if (r.v !== undefined && r.v !== MAP_VERSION) return out;
  if (!isObj(r.merchants)) return out;
  for (const [id, entry] of Object.entries(r.merchants)) {
    if (Object.keys(out.merchants).length >= MERCHANTS_MAX) break;
    if (!ID_RE.test(id) || !isObj(entry)) continue;
    out.merchants[id] = cleanEntry(entry);
  }
  return out;
}

/** The mapping with one merchant's entry set (merged over the old one) or removed (`entry` null). Never mutates. */
export function withEntry(map, id, entry) {
  const m = normalizeMap(map);
  if (!ID_RE.test(id)) return m;
  if (entry === null) {
    delete m.merchants[id];
    return m;
  }
  if (!m.merchants[id] && Object.keys(m.merchants).length >= MERCHANTS_MAX) return m;
  m.merchants[id] = cleanEntry({ ...(m.merchants[id] ?? {}), ...entry });
  return m;
}

/** The mapping with the same fields set on several merchants (a folder's bulk set). */
export function withEntries(map, ids, fields) {
  let m = normalizeMap(map);
  for (const id of ids) m = withEntry(m, id, fields);
  return m;
}

/** Mapping ids whose actor no longer exists (or is no longer a merchant). */
export function orphanIds(map, merchantIds) {
  const have = new Set(merchantIds);
  return Object.keys(normalizeMap(map).merchants).filter(id => !have.has(id));
}

/** `Shop · <type> · B<n> · <kind>` */
export function tableName(type, band, kind) {
  return `${TABLE_PREFIX}${type} · B${band} · ${kind}`;
}

/** The parts of a shop table name, or null. */
export function parseTableName(name) {
  const m = /^Shop · ([a-z-]+) · B(\d{1,2}) · (basics|stock|rare)$/.exec(String(name ?? "").trim());
  if (!m || !TYPE_BY_KEY[m[1]]) return null;
  return { type: m[1], band: Number(m[2]), kind: m[3] };
}
export const isShopTableName = name => String(name ?? "").trim().startsWith(TABLE_PREFIX);

/** "Lv 11–20" for a band, from the defaults' bands (or "B<n>" when the band is not listed). */
export function bandLabel(defaults, band) {
  const b = normalizeDefaults(defaults).bands.find(x => x.band === band);
  return b ? `B${band} (Lv ${b.min}–${b.max})` : `B${band}`;
}

/** The band whose required-level range holds `level`, or null. */
export function bandForRequiredLevel(defaults, level) {
  const n = Number(level);
  return normalizeDefaults(defaults).bands.find(b => n >= b.min && n <= b.max)?.band ?? null;
}

/**
 * The effective Item Piles merchant settings for an entry: overrides win, else the first table type's defaults (else the
 * first type's), else general's.
 */
export function merchantSettings(entry, defaults) {
  const d = normalizeDefaults(defaults);
  const e = cleanEntry(entry);
  const first = e.types[0] ?? "general";
  const base = d.types[first];
  return {
    buyPriceModifier: e.buy ?? base.buy,
    sellPriceModifier: e.sell ?? base.sell,
    hideNewItems: e.hideNewItems ?? base.hideNewItems,
    purchaseOnly: e.purchaseOnly ?? base.purchaseOnly
  };
}

/**
 * Index world tables by exact (trimmed) name. Duplicates are listed so health and the window can warn; the first one wins.
 * @param {{ uuid: string, name: string, results?: {id: string}[] }[]} tables
 */
export function indexTables(tables) {
  /** @type {Map<string, any>} */
  const byName = new Map();
  /** @type {Set<string>} */
  const dupes = new Set();
  for (const t of tables ?? []) {
    if (!t || !isShopTableName(t.name)) continue;
    const name = String(t.name).trim();
    if (byName.has(name)) dupes.add(name);
    else byName.set(name, t);
  }
  return { byName, dupes: [...dupes].sort() };
}

/**
 * Plan one merchant's tables.
 * @param {object} args
 * @param {string} args.id actor id
 * @param {string} [args.name]
 * @param {unknown} args.entry the mapping entry
 * @param {unknown} args.defaults
 * @param {{ byName: Map<string, any> }} args.index from indexTables
 * @param {any[]} [args.existing] the merchant's current tablesForPopulate
 * @param {(uuid: string) => (string | null | undefined)} [args.nameOf] a table uuid's name (to tell our entries from others')
 * @param {number | null} [args.band] apply-time band for a wandering merchant (wins over the saved band)
 * @returns {{ id, name, ok: boolean, reason: string | null, band: number | null, found: string[], missing: string[],
 *   tablesForPopulate: any[], kept: number, settings: object, basics: string[] }}
 */
export function planMerchant({ id, name = "", entry, defaults, index, existing = [], nameOf = () => null, band = null }) {
  const e = cleanEntry(entry);
  const d = normalizeDefaults(defaults);
  const useBand = e.size === "wandering" && Number.isInteger(band) ? band : e.band;
  const settings = merchantSettings(e, d);
  const others = (Array.isArray(existing) ? existing : []).filter(t => t && !isShopTableName(nameOf(t.uuid)));
  const base = { id, name, band: useBand, found: [], missing: [], tablesForPopulate: [], kept: others.length, settings, basics: [] };
  if (!e.types.length) return { ...base, ok: false, reason: "no vendor type" };
  const tableTypes = e.types.filter(t => TYPE_BY_KEY[t].tables);
  if (!tableTypes.length) return { ...base, ok: true, reason: "hand-stocked", tablesForPopulate: others };
  if (!Number.isInteger(useBand)) return { ...base, ok: false, reason: e.size === "wandering" ? "pick a band" : "no band" };
  const size = d.sizes[e.size];
  /** @type {any[]} */
  const ours = [];
  const found = [];
  const missing = [];
  const basics = [];
  for (const type of tableTypes) {
    for (const kind of KINDS) {
      const tname = tableName(type, useBand, kind);
      const t = index.byName.get(tname);
      if (!t) { missing.push(tname); continue; }
      found.push(tname);
      if (kind === "basics") {
        basics.push(t.uuid);
        const items = Object.fromEntries((t.results ?? []).filter(r => r?.id).map(r => [r.id, "1"]));
        ours.push({ uuid: t.uuid, addAll: true, timesToRoll: "1", items, customCategory: "" });
      } else {
        ours.push({ uuid: t.uuid, addAll: false, timesToRoll: kind === "stock" ? size.stock : size.rare, items: {}, customCategory: "" });
      }
    }
  }
  return { ...base, ok: true, reason: found.length ? null : "no tables yet", found, missing, basics, tablesForPopulate: [...others, ...ours] };
}

/**
 * Plan every listed merchant.
 * @param {{ merchants: {id: string, name?: string, existing?: any[]}[], map: unknown, defaults: unknown,
 *   tables: any[], nameOf?: (uuid: string) => any, band?: number | null, ids?: string[] | null }} args
 */
export function planAll({ merchants, map, defaults, tables, nameOf, band = null, ids = null }) {
  const m = normalizeMap(map);
  const index = indexTables(tables);
  const want = ids ? new Set(ids) : null;
  const rows = [];
  for (const mer of merchants ?? []) {
    if (want && !want.has(mer.id)) continue;
    const entry = m.merchants[mer.id];
    if (!entry) continue;
    rows.push(planMerchant({ id: mer.id, name: mer.name, entry, defaults, index, existing: mer.existing, nameOf, band }));
  }
  const missing = [...new Set(rows.flatMap(r => r.missing))].sort();
  return { rows, missing, dupes: index.dupes, ready: rows.filter(r => r.ok && r.found.length).length };
}

/** Item Piles item flags the restock keeps (Item Piles' own "clear items" keeps the first two; services are hand-made). */
export const KEEP_FLAGS = /** @type {const} */ (["keepOnMerchant", "keepIfZero", "isService"]);

/**
 * Restock plan for one merchant: which of its (Item Piles-visible) items to delete before the refresh.
 * @param {{ id: string, name: string, ipItem?: object }[]} items  `ipItem` = the item's `flags.item-piles.item`
 * @param {any[]} tablesForPopulate the merchant's current list
 */
export function restockPlan(items, tablesForPopulate) {
  const remove = [];
  const keep = [];
  for (const it of items ?? []) {
    const f = isObj(it?.ipItem) ? it.ipItem : {};
    (KEEP_FLAGS.some(k => f[k] === true) ? keep : remove).push(it);
  }
  const tables = Array.isArray(tablesForPopulate) ? tablesForPopulate.filter(t => t?.uuid).length : 0;
  return {
    ok: tables > 0,
    reason: tables > 0 ? null : "no tables set on this merchant",
    tables,
    remove: remove.map(i => i.id),
    removeNames: remove.map(i => i.name),
    keep: keep.map(i => i.id)
  };
}

/**
 * Which items added by a refresh are basics: new ids (not there before) whose name is one of the basics tables' results.
 * @param {{ id: string, name: string }[]} after items after the refresh
 * @param {Set<string> | string[]} beforeIds
 * @param {Set<string> | string[]} basicNames
 * @returns {string[]}
 */
export function newBasics(after, beforeIds, basicNames) {
  const before = new Set(beforeIds);
  const names = new Set([...basicNames].map(n => String(n).trim().toLowerCase()));
  return (after ?? []).filter(i => i && !before.has(i.id) && names.has(String(i.name ?? "").trim().toLowerCase())).map(i => i.id);
}

/** The update for a basic on the merchant (Item Piles' item flags + our tag). Never applied to source items. */
export function basicUpdate(id) {
  return {
    _id: id,
    "flags.item-piles.item.infiniteQuantity": "yes",
    "flags.item-piles.item.cantBeSoldToMerchants": true,
    "flags.loot-ledger.merchantBasic": true
  };
}

/** Plain-text summary lines for the chat card and notifications. */
export function summaryLines(kind, results, { dryRun = false } = {}) {
  const lines = [];
  for (const r of results ?? []) {
    if (kind === "apply") {
      if (!r.ok) lines.push({ level: "warn", text: `${r.name}: skipped (${r.reason}).` });
      else if (r.reason === "hand-stocked") lines.push({ level: "info", text: `${r.name}: hand-stocked, prices set.` });
      else lines.push({
        level: r.missing.length ? "warn" : "ok",
        text: `${r.name}: ${r.found.length} table${r.found.length === 1 ? "" : "s"}${r.missing.length ? `, ${r.missing.length} missing` : ""}${r.kept ? `, ${r.kept} other kept` : ""}${Number.isInteger(r.band) ? `, B${r.band}` : ""}.`
      });
    } else {
      if (!r.ok) lines.push({ level: "warn", text: `${r.name}: skipped (${r.reason}).` });
      else lines.push({
        level: r.error ? "bad" : "ok",
        text: r.error ? `${r.name}: failed (${r.error}).`
          : `${r.name}: ${dryRun ? "would remove" : "removed"} ${r.remove.length}, kept ${r.keep.length}${dryRun ? "" : `, added ${r.added ?? 0} (${r.basics ?? 0} basics)`}.`
      });
    }
  }
  return lines;
}

/**
 * Health lines for the merchant tables (pure; core health levels).
 * @param {{ itemPiles: boolean, merchants: number, map: unknown, orphans: string[], plan: ReturnType<typeof planAll> }} f
 * @returns {{ level: string, text: string }[]}
 */
export function healthLines({ itemPiles, merchants, map, orphans = [], plan }) {
  if (!itemPiles) return [{ level: "off", text: "Item Piles is not active: merchant tables are idle." }];
  const m = normalizeMap(map);
  const mapped = Object.keys(m.merchants).length;
  const lines = [{ level: mapped ? "ok" : "info", text: `${mapped} of ${merchants} Item Piles merchant${merchants === 1 ? "" : "s"} mapped to vendor types.` }];
  const untyped = Object.values(m.merchants).filter(e => !e.types.length).length;
  if (untyped) lines.push({ level: "warn", text: `${untyped} mapped merchant${untyped === 1 ? " has" : "s have"} no vendor type.` });
  const noBand = (plan?.rows ?? []).filter(r => !r.ok && r.reason === "no band").length;
  if (noBand) lines.push({ level: "warn", text: `${noBand} merchant${noBand === 1 ? " has" : "s have"} no level band.` });
  const missing = plan?.missing?.length ?? 0;
  lines.push(missing
    ? { level: "warn", text: `${missing} shop table${missing === 1 ? " is" : "s are"} missing (named "${TABLE_PREFIX}<type> · B<n> · <kind>"; none are created yet).` }
    : { level: "ok", text: "Every shop table the mapping needs exists." });
  if (plan?.dupes?.length) lines.push({ level: "warn", text: `${plan.dupes.length} shop table name${plan.dupes.length === 1 ? " is" : "s are"} used twice; the first table found is used.` });
  if (orphans.length) lines.push({ level: "info", text: `${orphans.length} mapping entr${orphans.length === 1 ? "y points" : "ies point"} at actors that are gone or no longer merchants.` });
  return lines;
}

/** Whether Restock may touch a merchant: mapped with at least one table type (hand-stocked "special" only = never). */
export function restockable(entry) {
  return cleanEntry(entry).types.some(t => TYPE_BY_KEY[t].tables);
}

/** Flag key on our summary chat cards and on basics we marked on merchants (cleanup finds both). */
export const CARD_FLAG = "merchantCard";
export const BASIC_FLAG = "merchantBasic";
