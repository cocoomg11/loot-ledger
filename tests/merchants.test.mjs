import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MM from "../scripts/merchants-model.mjs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const A = "aaaaaaaaaaaaaaa1", B = "bbbbbbbbbbbbbbb2", C = "ccccccccccccccc3";

test("16 vendor types; only special is hand-stocked", () => {
  assert.equal(MM.VENDOR_TYPES.length, 16);
  assert.deepEqual(MM.VENDOR_TYPES.filter(t => !t.tables).map(t => t.key), ["special"]);
  assert.ok(MM.TYPE_KEYS.includes("armor-heavy") && MM.TYPE_KEYS.includes("fence"));
});

test("defaults: price modifiers, size formulas, six bands", () => {
  const d = MM.defaultDefaults();
  assert.deepEqual(d.types.general, { buy: 1, sell: 0.25, hideNewItems: false, purchaseOnly: false });
  assert.equal(d.types.arcane.buy, 1.1);
  assert.equal(d.types.healer.buy, 1.1);
  assert.deepEqual(d.types.fence, { buy: 1.25, sell: 0.5, hideNewItems: true, purchaseOnly: false });
  assert.deepEqual(Object.fromEntries(MM.SIZES.map(s => [s, d.sizes[s].stock])), { city: "2d4+2", town: "1d4+2", outpost: "1d4", wandering: "1d4+1" });
  assert.deepEqual(d.bands.map(b => [b.band, b.min, b.max]), [[1, 1, 10], [2, 11, 20], [3, 21, 30], [4, 31, 40], [5, 41, 50], [6, 51, 60]]);
  assert.deepEqual(MM.normalizeDefaults(undefined), d);
});

test("normalizeDefaults keeps edits, rejects bad values, sorts and caps bands", () => {
  const d = MM.normalizeDefaults({
    v: 1,
    types: { weapons: { buy: 1.5, sell: "x", hideNewItems: true }, bogus: { buy: 3 } },
    sizes: { city: { stock: "3d6 + 1", rare: "Math.random()" } },
    bands: [{ band: 2, min: 11, max: 20 }, { band: 1, min: 1, max: 10 }, { band: 1, min: 5, max: 6 }, { band: 3, min: 9, max: 2 }]
  });
  assert.equal(d.types.weapons.buy, 1.5);
  assert.equal(d.types.weapons.sell, 0.25);
  assert.equal(d.types.weapons.hideNewItems, true);
  assert.equal(d.types.bogus, undefined);
  assert.equal(d.sizes.city.stock, "3d6+1");
  assert.equal(d.sizes.city.rare, "1d2");
  assert.deepEqual(d.bands.map(b => b.band), [1, 2]);
  assert.equal(MM.normalizeDefaults({ v: 2, types: { general: { buy: 9 } } }).types.general.buy, 1);
  const many = Array.from({ length: 20 }, (_, i) => ({ band: i + 1, min: i, max: i }));
  assert.equal(MM.normalizeDefaults({ bands: many }).bands.length, MM.BANDS_MAX);
});

test("formula check: plain dice and numbers only", () => {
  for (const ok of ["1", "0", "1d4", "2d4+2", "1d2-1", "1d4 + 1d6 - 2"]) assert.notEqual(MM.cleanFormula(ok, null), null, ok);
  for (const bad of ["", "@level", "1d4*2", "floor(1)", "1d4+".repeat(3), "x"]) assert.equal(MM.cleanFormula(bad, null), null, bad);
});

test("mapping normalizer: version, ids, types, cap", () => {
  assert.deepEqual(MM.normalizeMap(null), { v: 1, merchants: {} });
  assert.deepEqual(MM.normalizeMap({ v: 9, merchants: { [A]: { types: ["food"] } } }).merchants, {});
  const m = MM.normalizeMap({ v: 1, merchants: { [A]: { types: ["food", "food", "nope", "inn"], band: "3", size: "huge", buy: -1 }, "bad id": { types: ["food"] } } });
  assert.deepEqual(Object.keys(m.merchants), [A]);
  assert.deepEqual(m.merchants[A], { types: ["food", "inn"], band: 3, size: "town", buy: null, sell: null, hideNewItems: null, purchaseOnly: null });
  const lots = {};
  for (let i = 0; i < MM.MERCHANTS_MAX + 5; i++) lots[String(i).padStart(16, "x")] = { types: ["general"] };
  assert.equal(Object.keys(MM.normalizeMap({ merchants: lots }).merchants).length, MM.MERCHANTS_MAX);
  const many = MM.cleanEntry({ types: MM.TYPE_KEYS });
  assert.equal(many.types.length, MM.TYPES_PER_MERCHANT);
});

test("withEntry / withEntries merge, remove and never mutate", () => {
  const m0 = MM.emptyMap();
  const m1 = MM.withEntry(m0, A, { types: ["weapons"], band: 2 });
  assert.deepEqual(m0.merchants, {});
  const m2 = MM.withEntry(m1, A, { size: "city" });
  assert.deepEqual([m2.merchants[A].types, m2.merchants[A].band, m2.merchants[A].size], [["weapons"], 2, "city"]);
  assert.equal(MM.withEntry(m2, A, null).merchants[A], undefined);
  assert.deepEqual(MM.withEntry(m2, "nope", { types: ["food"] }).merchants, m2.merchants);
  const m3 = MM.withEntries(m2, [B, C], { types: ["food"], band: 1 });
  assert.deepEqual(Object.keys(m3.merchants).sort(), [A, B, C]);
  assert.deepEqual(MM.orphanIds(m3, [A]), [B, C]);
});

test("table names round-trip", () => {
  assert.equal(MM.tableName("armor-heavy", 3, "rare"), "Shop · armor-heavy · B3 · rare");
  assert.deepEqual(MM.parseTableName("Shop · armor-heavy · B3 · rare"), { type: "armor-heavy", band: 3, kind: "rare" });
  assert.equal(MM.parseTableName("Shop · dragons · B3 · rare"), null);
  assert.equal(MM.parseTableName("Weapons B3"), null);
  assert.equal(MM.bandLabel(undefined, 2), "B2 (Lv 11–20)");
  assert.equal(MM.bandForRequiredLevel(undefined, 25), 3);
  assert.equal(MM.bandForRequiredLevel(undefined, 61), null);
});

const tbl = (name, results = []) => ({ uuid: `RollTable.${name.replace(/\W/g, "")}`, name, results });

test("planMerchant: basics add all, stock/rare roll by size, missing reported, other tables kept", () => {
  const tables = [
    tbl(MM.tableName("weapons", 2, "basics"), [{ id: "r1" }, { id: "r2" }]),
    tbl(MM.tableName("weapons", 2, "stock")),
    tbl(MM.tableName("weapons", 2, "stock")), // duplicate name
    tbl("Hand-made list")
  ];
  const index = MM.indexTables(tables);
  assert.deepEqual(index.dupes, [MM.tableName("weapons", 2, "stock")]);
  const names = Object.fromEntries(tables.map(t => [t.uuid, t.name]));
  const existing = [{ uuid: "RollTable.Handmadelist", addAll: false, timesToRoll: "1" }, { uuid: tables[1].uuid, addAll: false, timesToRoll: "9" }];
  const r = MM.planMerchant({ id: A, name: "Smith", entry: { types: ["weapons"], band: 2, size: "city" }, defaults: undefined, index, existing, nameOf: u => names[u] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, [MM.tableName("weapons", 2, "rare")]);
  assert.equal(r.kept, 1);
  assert.equal(r.tablesForPopulate.length, 3);
  assert.deepEqual(r.tablesForPopulate[0], existing[0]);
  assert.deepEqual(r.tablesForPopulate[1], { uuid: tables[0].uuid, addAll: true, timesToRoll: "1", items: { r1: "1", r2: "1" }, customCategory: "" });
  assert.deepEqual(r.tablesForPopulate[2], { uuid: tables[1].uuid, addAll: false, timesToRoll: "2d4+2", items: {}, customCategory: "" });
  assert.deepEqual(r.settings, { buyPriceModifier: 1, sellPriceModifier: 0.25, hideNewItems: false, purchaseOnly: false });
  assert.deepEqual(r.basics, [tables[0].uuid]);
});

test("planMerchant: overrides, fence defaults, special, no band, wandering band at apply time", () => {
  const index = MM.indexTables([tbl(MM.tableName("fence", 4, "stock"))]);
  const fence = MM.planMerchant({ id: A, entry: { types: ["fence"], band: 4, sell: 0.4 }, index });
  assert.deepEqual(fence.settings, { buyPriceModifier: 1.25, sellPriceModifier: 0.4, hideNewItems: true, purchaseOnly: false });
  const special = MM.planMerchant({ id: A, entry: { types: ["special"] }, index, existing: [{ uuid: "x" }] });
  assert.deepEqual([special.ok, special.reason, special.tablesForPopulate.length], [true, "hand-stocked", 1]);
  assert.equal(MM.planMerchant({ id: A, entry: { types: [] }, index }).reason, "no vendor type");
  assert.equal(MM.planMerchant({ id: A, entry: { types: ["fence"] }, index }).reason, "no band");
  const w = { types: ["fence"], size: "wandering" };
  assert.equal(MM.planMerchant({ id: A, entry: w, index }).reason, "pick a band");
  const wb = MM.planMerchant({ id: A, entry: w, index, band: 4 });
  assert.deepEqual([wb.ok, wb.band, wb.found.length, wb.tablesForPopulate[0].timesToRoll], [true, 4, 1, "1d4+1"]);
  // A non-wandering merchant ignores the apply-time band.
  assert.equal(MM.planMerchant({ id: A, entry: { types: ["fence"], band: 1 }, index, band: 4 }).band, 1);
});

test("planAll: only mapped merchants, ids filter, missing list merged", () => {
  const map = MM.withEntries(MM.emptyMap(), [A, B], { types: ["food"], band: 1 });
  const p = MM.planAll({ merchants: [{ id: A, name: "a" }, { id: B, name: "b" }, { id: C, name: "c" }], map, tables: [tbl(MM.tableName("food", 1, "basics"))] });
  assert.equal(p.rows.length, 2);
  assert.deepEqual(p.missing, [MM.tableName("food", 1, "rare"), MM.tableName("food", 1, "stock")]);
  assert.equal(p.ready, 2);
  assert.equal(MM.planAll({ merchants: [{ id: A }, { id: B }], map, tables: [], ids: [B] }).rows.length, 1);
});

test("restockPlan keeps keepOnMerchant / keepIfZero / services, removes the rest", () => {
  const items = [
    { id: "1", name: "Bread", ipItem: {} },
    { id: "2", name: "Lucky charm", ipItem: { keepOnMerchant: true } },
    { id: "3", name: "Repair", ipItem: { isService: true } },
    { id: "4", name: "Rope" },
    { id: "5", name: "Lantern", ipItem: { keepIfZero: true } }
  ];
  const r = MM.restockPlan(items, [{ uuid: "t" }]);
  assert.deepEqual([r.ok, r.remove, r.keep], [true, ["1", "4"], ["2", "3", "5"]]);
  assert.equal(MM.restockPlan(items, []).ok, false);
  assert.equal(MM.restockable({ types: ["special"] }), false);
  assert.equal(MM.restockable({ types: ["special", "food"] }), true);
});

test("newBasics and basicUpdate: only new items named in basics tables; Item Piles flags on the merchant copy", () => {
  const after = [{ id: "old", name: "Bread" }, { id: "n1", name: "bread " }, { id: "n2", name: "Sword" }];
  assert.deepEqual(MM.newBasics(after, ["old"], ["Bread"]), ["n1"]);
  assert.deepEqual(MM.basicUpdate("n1"), {
    _id: "n1", "flags.item-piles.item.infiniteQuantity": "yes", "flags.item-piles.item.cantBeSoldToMerchants": true,
    "flags.loot-ledger.merchantBasic": true
  });
});

test("summary and health lines", () => {
  const map = MM.withEntries(MM.emptyMap(), [A], { types: ["food"] });
  const p = MM.planAll({ merchants: [{ id: A, name: "Cook" }], map, tables: [] });
  assert.match(MM.summaryLines("apply", p.rows)[0].text, /Cook: skipped \(no band\)/);
  const lines = MM.healthLines({ itemPiles: true, merchants: 3, map, orphans: [B], plan: p });
  assert.equal(lines[0].text, "1 of 3 Item Piles merchants mapped to vendor types.");
  assert.ok(lines.some(l => l.level === "warn" && /no level band/.test(l.text)));
  assert.ok(lines.some(l => /gone or no longer merchants/.test(l.text)));
  assert.equal(MM.healthLines({ itemPiles: false })[0].level, "off");
  const rs = MM.summaryLines("restock", [{ name: "Cook", ok: true, remove: ["1"], keep: [], added: 3, basics: 1 }]);
  assert.equal(rs[0].text, "Cook: removed 1, kept 0, added 3 (1 basics).");
});

test("source: never removeExistingActorItems: true; restock deletes then refreshes with false; writes only on GM paths", () => {
  const src = read("scripts/merchants.mjs");
  assert.doesNotMatch(src.replace(/^\s*\*.*$/gm, ""), /removeExistingActorItems:\s*true/);
  const body = src.slice(src.indexOf("export async function restock"), src.indexOf("/** A summary card"));
  assert.ok(body.indexOf("deleteEmbeddedDocuments") < body.indexOf("refreshMerchantInventory(actor, { removeExistingActorItems: false })"));
  assert.doesNotMatch(src, /Hooks\.on\(/);
  assert.doesNotMatch(src + read("scripts/merchants-app.mjs"), /wc-r\d/);
  assert.doesNotMatch(read("scripts/merchants-model.mjs"), /\b(game|foundry|ui|Hooks)\./);
});

let warnings;
beforeEach(() => {
  warnings = [];
  globalThis.foundry = { utils: { deepClone: v => structuredClone(v) } };
  globalThis.ui = { notifications: { warn: m => warnings.push(m), info: () => {} } };
  globalThis.game = { user: { isGM: false }, i18n: { localize: k => k }, settings: { get: (_m, k) => k === "merchantTables" ? true : undefined } };
});

test("api.merchants: every member GM-gated; undefined while the setting is off", async () => {
  const { createApi, MERCHANT_GM_ONLY } = await import("../scripts/api.mjs");
  const api = createApi();
  assert.deepEqual([...MERCHANT_GM_ONLY].sort(), ["apply", "cleanupPlan", "defaults", "health", "open", "plan", "removeData", "restock", "setDefaults", "setMapping", "unmap"]);
  for (const name of MERCHANT_GM_ONLY) {
    warnings = [];
    assert.equal(api.merchants[name](), undefined, name);
    assert.deepEqual(warnings, ["LOOTLEDGER.Notice.GmOnly"], name);
  }
  globalThis.game.settings.get = () => false;
  assert.equal(api.merchants, undefined);
});
