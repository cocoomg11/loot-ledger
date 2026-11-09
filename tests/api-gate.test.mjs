import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gateApi } from "../scripts/gm.mjs";
import { createApi, findTable, clearTableIndexCache, registerTableIndexHooks, GM_ONLY, GM_ONLY_MEMBERS, OPEN_MEMBERS } from "../scripts/api.mjs";
import { loadBases } from "../scripts/build.mjs";

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
  assert.equal(GM_ONLY, GM_ONLY_MEMBERS, "0.2.5 alias");
  for (const name of ["auditHandAuthored", "build", "convertToPack", "findTable", "healthReport", "roll"]) assert.ok(GM_ONLY.includes(name), `${name} stays gated (0.2.5)`);
  for (const name of GM_ONLY.filter(n => typeof api[n] === "function")) {
    warnings = [];
    assert.equal(typeof api[name], "function", name);
    // The wrapped functions would throw or touch game.packs here; gated, they return undefined synchronously.
    assert.equal(api[name]({}), undefined, name);
    assert.equal(warnings.length, 1, name);
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
  const PURE = new Set(OPEN_MEMBERS);
  for (const [name, v] of Object.entries(api)) {
    if (typeof v !== "function") continue;
    assert.ok(GM_ONLY.includes(name) || PURE.has(name), `${name} is neither gated nor listed as pure`);
  }
  const src = read("scripts/api.mjs");
  const start = src.indexOf("const api = gateMembers({");
  const gatedBlock = src.slice(start, src.indexOf("}, GM_ONLY_MEMBERS);", start));
  assert.ok(start > 0 && gatedBlock.length > 0, "createApi wraps its members with gateMembers(..., GM_ONLY_MEMBERS)");
  for (const name of GM_ONLY) assert.match(gatedBlock, new RegExp(`\\b${name}\\b`), `${name} not inside gateMembers(...)`);
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

test("loadBases: each base source pack's index is read once per run and documents are cached", async () => {
  const own = fakePack("my-book.equipment", [{ _id: "a", name: "Boots A" }, { _id: "b", name: "Cloak B" }]);
  const srd = fakePack("dnd5e.equipment24", [{ _id: "s", name: "Rope" }]);
  let docReads = 0;
  own.getDocument = async id => { docReads++; return { id }; };
  globalThis.game.packs = new Map([[own.collection, own], [srd.collection, srd]]);
  const bases = await loadBases({ on: true, sources: [own.collection, srd.collection], book: "", confidence: {}, scoreItems: false, gapFills: true, handmade: [], rules: {} });
  assert.equal(own.reads, 1);
  assert.equal(srd.reads, 1);
  assert.equal((await bases.doc("u1", own.collection, "a")).id, "a");
  assert.equal((await bases.doc("u1", own.collection, "a")).id, "a");
  assert.equal(docReads, 1, "one document read per base per run");
});

test("source: convertToPack loads the bases once for the whole run (the 0.2.5 one-index-per-run rule)", () => {
  const src = read("scripts/build.mjs");
  const body = src.slice(src.indexOf("export async function convertToPack"), src.indexOf("export function baseSettings"));
  assert.match(body, /const bases = await loadBases\(bs\);/);
  assert.ok(body.indexOf("loadBases(bs)") < body.indexOf("for (const doc of docs)"), "outside the item loop");
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
