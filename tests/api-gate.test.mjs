import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gateApi } from "../scripts/gm.mjs";
import { createApi, findTable, clearTableIndexCache, registerTableIndexHooks, GM_ONLY } from "../scripts/api.mjs";
import { findOfficial } from "../scripts/build.mjs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** Minimal Foundry globals; `isGM` and the packs are set per test. */
let warnings, hooks;
beforeEach(() => {
  warnings = [];
  hooks = {};
  globalThis.foundry = { utils: { deepClone: v => structuredClone(v) } };
  globalThis.ui = { notifications: { warn: m => warnings.push(m), error: m => warnings.push(m), info: () => {} } };
  globalThis.game = { user: { isGM: false }, i18n: { localize: k => k }, packs: new Map(), settings: { get: () => "100" } };
  globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, callAll: () => {} };
  clearTableIndexCache();
});

test("gateApi: a player gets a warning and undefined, and the function is not called", () => {
  let calls = 0;
  const api = gateApi({ go: () => { calls++; return 1; }, K: 5 }, { isGM: () => false, notify: m => warnings.push(m), message: () => "no" });
  assert.equal(api.go(), undefined);
  assert.equal(calls, 0);
  assert.deepEqual(warnings, ["no"]);
  assert.equal(api.K, 5);
});

test("gateApi: a GM call passes arguments and the result through; the check is made at call time", () => {
  let gm = false;
  const api = gateApi({ add: (a, b) => a + b }, { isGM: () => gm, notify: () => {}, message: () => "" });
  assert.equal(api.add(1, 2), undefined);
  gm = true;
  assert.equal(api.add(1, 2), 3);
});

test("every API entry that reads, writes or rolls is gated for players; pure helpers stay open", async () => {
  const api = createApi();
  assert.deepEqual([...GM_ONLY].sort(), ["auditHandAuthored", "build", "convertToPack", "findTable", "roll"]);
  for (const name of GM_ONLY) {
    warnings = [];
    assert.equal(typeof api[name], "function", name);
    // The wrapped functions would throw or touch game.packs here; gated, they return undefined synchronously.
    assert.equal(api[name]({}), undefined, name);
    assert.deepEqual(warnings, ["LOOTLEDGER.Notice.GmOnly"], name);
  }
  warnings = [];
  assert.equal(api.formatCoins(12345), api.formatCoins(12345));
  assert.equal(typeof api.bandForLevel(5), "number");
  assert.equal(api.sellPrice({ flags: { "loot-ledger": { vendorSellCopper: 150 } } }).copper, 150);
  assert.equal(typeof api.convert, "function");
  assert.ok(Array.isArray(api.QUALITIES) && api.BANDS);
  assert.deepEqual(warnings, []);
});

test("source: every function member of the API is either in GM_ONLY or a known pure helper", () => {
  const api = createApi();
  const PURE = new Set(["convert", "sellPrice", "bandForLevel", "formatCoins"]);
  for (const [name, v] of Object.entries(api)) {
    if (typeof v !== "function") continue;
    assert.ok(GM_ONLY.includes(name) || PURE.has(name), `${name} is neither gated nor listed as pure`);
  }
  const src = read("scripts/api.mjs");
  const gatedBlock = src.slice(src.indexOf("const gated = gateApi({"), src.indexOf("});", src.indexOf("const gated = gateApi({")));
  for (const name of GM_ONLY) assert.match(gatedBlock, new RegExp(`\\b${name}\\b`), `${name} not inside gateApi(...)`);
  assert.match(read("scripts/main.mjs"), /module\.api = createApi\(\)/);
  assert.ok(read("lang/en.json").includes('"GmOnly"'));
});

/** A fake compendium that counts index reads. */
function fakePack(collection, entries, docs = {}) {
  return {
    collection, reads: 0,
    async getIndex() { this.reads++; return entries; },
    async getDocument(id) { return docs[id] ?? { id }; }
  };
}

test("findOfficial: with one Map per run, each pack's index is read once", async () => {
  const own = fakePack("dnd-dungeon-masters-guide.equipment", [{ _id: "a", name: "Boots of Speed" }, { _id: "b", name: "Cloak of Protection" }]);
  const srd = fakePack("dnd5e.equipment24", [{ _id: "s", name: "Rope" }]);
  globalThis.game.packs = new Map([[own.collection, own], [srd.collection, srd]]);
  const indexes = new Map();
  assert.equal((await findOfficial({ pack: own.collection, name: "Boots of Speed" }, indexes)).id, "a");
  assert.equal((await findOfficial({ pack: own.collection, name: "Cloak of Protection" }, indexes)).id, "b");
  assert.equal((await findOfficial({ pack: own.collection, name: "Rope" }, indexes)).id, "s");
  assert.equal(await findOfficial({ pack: own.collection, name: "Nothing" }, indexes), null);
  assert.equal(own.reads, 1);
  assert.equal(srd.reads, 1);
  // Without a Map (old call shape) it still works.
  assert.equal((await findOfficial({ pack: own.collection, name: "Boots of Speed" })).id, "a");
});

test("source: convertToPack passes one index cache to findOfficial for the whole run", () => {
  const src = read("scripts/build.mjs");
  const body = src.slice(src.indexOf("export async function convertToPack"), src.indexOf("export async function findOfficial"));
  assert.match(body, /const indexes = new Map\(\)/);
  assert.match(body, /findOfficial\(pre\.basedOn, indexes\)/);
});

test("findTable: the index is cached and cleared by RollTable create/update/delete hooks", async () => {
  globalThis.game.user.isGM = true;
  registerTableIndexHooks();
  for (const h of ["createRollTable", "updateRollTable", "deleteRollTable"]) assert.equal(hooks[h]?.length, 1, h);
  const entries = [{ _id: "t1", flags: { "loot-ledger": { kind: "quality", band: 2, quality: "rare" } } }];
  const tables = fakePack("world.loot-ledger-tables", entries);
  globalThis.game.packs = new Map([[tables.collection, tables]]);
  assert.equal((await findTable({ band: 2, quality: "rare" })).id, "t1");
  assert.equal((await findTable({ band: 2, quality: "rare" })).id, "t1");
  assert.equal(await findTable({ band: 3, quality: "rare" }), null);
  assert.equal(tables.reads, 1);
  hooks.updateRollTable[0]();
  await findTable({ band: 2, quality: "rare" });
  assert.equal(tables.reads, 2);
  hooks.deleteRollTable[0]();
  hooks.createRollTable[0]();
  await findTable({ band: 2, quality: "rare" });
  assert.equal(tables.reads, 3);
  // A replaced pack object (pack deleted and made again) is read afresh.
  const again = fakePack("world.loot-ledger-tables", entries);
  globalThis.game.packs = new Map([[again.collection, again]]);
  await findTable({ band: 2, quality: "rare" });
  assert.equal(again.reads, 1);
});
