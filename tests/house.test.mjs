/** House practices: release tag format, manifest compatibility, hook payloads, cleanup plan, version-bump safety. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dropPayload, isLootLedgerItem, DROPPED_HOOK, makeCreateItemHandler } from "../scripts/events.mjs";
import { cleanupPlan, SETTING_KEYS, PACK_NAMES } from "../scripts/cleanup.mjs";
import { sourceHash, planSync } from "../scripts/ledger.mjs";
import { protectReviewed } from "../scripts/review-model.mjs";
import { ITEMS_PACK, CONVERTED_PACK, TABLES_PACK } from "../scripts/build.mjs";
import "./_foundry.mjs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("release workflow rejects tags that are not vMAJOR.MINOR.PATCH", () => {
  const wf = read(".github/workflows/release.yml");
  const m = wf.match(/=~ (\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$)/);
  assert.ok(m, "tag check step present");
  const rx = new RegExp(m[1]);
  for (const ok of ["v0.3.0", "v1.20.13"]) assert.ok(rx.test(ok), ok);
  for (const bad of ["0.3.0", "v0.3", "v0.3.0-beta", "v0.3.0.1", "vx.1.2", "v1.2.3\n4"]) assert.ok(!rx.test(bad), bad);
  assert.ok(wf.indexOf("Check the release tag format") < wf.indexOf("Set version and URLs"), "check runs first");
});

test("module.json: compatibility, dnd5e range, optional modules only recommended", () => {
  const m = JSON.parse(read("module.json"));
  assert.equal(m.compatibility.minimum, "14");
  assert.equal(m.compatibility.verified, "14");
  const dnd = m.relationships.systems.find(s => s.id === "dnd5e");
  assert.equal(dnd.compatibility.verified, "6.0.6");
  assert.ok(dnd.compatibility.minimum);
  const rec = m.relationships.recommends.map(r => r.id);
  for (const id of ["item-piles", "wayfarers-toolkit"]) {
    assert.ok(rec.includes(id), id);
    assert.ok(!m.relationships.requires.some(r => r.id === id), `${id} must not be required`);
  }
});

test("itemDropped payload and the createItem bail-outs", () => {
  assert.equal(DROPPED_HOOK, "loot-ledger.itemDropped");
  const item = { name: "X", flags: { "loot-ledger": { sourceUuid: "Compendium.a.b.Item.c" } } };
  assert.deepEqual(dropPayload({ item, source: "roll", query: { band: 2 } }), { item, source: "roll", query: { band: 2 } });
  assert.equal(dropPayload({ item, source: "weird" }), null);
  assert.equal(dropPayload({ item: null, source: "roll" }), null);
  assert.equal(isLootLedgerItem(item), true);
  assert.equal(isLootLedgerItem({ flags: {} }), false);
  assert.equal(isLootLedgerItem({ flags: { "loot-ledger": { quality: "epic" } } }), false, "a hand-set quality alone is not a drop");

  class Actor {}
  globalThis.Actor = Actor;
  const fired = [];
  globalThis.Hooks = { callAll: (...a) => fired.push(a) };
  let gm = true;
  const handle = makeCreateItemHandler(() => gm);
  handle({ ...item, parent: null });
  handle({ ...item, parent: Object.assign(new Actor(), { name: "A" }) , flags: {} });
  gm = false;
  handle({ ...item, parent: new Actor() });
  assert.equal(fired.length, 0, "world items, unflagged items and non-active-GM clients never fire");
  gm = true;
  const actor = new Actor();
  handle({ ...item, parent: actor });
  assert.equal(fired.length, 1);
  assert.equal(fired[0][0], DROPPED_HOOK);
  assert.equal(fired[0][1].source, "actor");
  assert.equal(fired[0][1].actor, actor);
});

test("cleanup plan: names the packs that exist, item flags only on request, setting list matches the registrations", async () => {
  const found = { packs: ["loot-ledger-tables", "someone-elses"], journals: 2, worldItems: 5, actorItems: 3 };
  assert.deepEqual(cleanupPlan(found), { packs: ["loot-ledger-tables"], journals: 2, settings: SETTING_KEYS, itemFlags: false, worldItems: 0, actorItems: 0 });
  const withFlags = cleanupPlan(found, { itemFlags: true });
  assert.equal(withFlags.worldItems, 5);
  assert.equal(withFlags.actorItems, 3);
  assert.deepEqual(PACK_NAMES, [ITEMS_PACK.name, CONVERTED_PACK.name, TABLES_PACK.name]);
  const registered = [...(read("scripts/main.mjs") + read("scripts/suffix-hooks.mjs")).matchAll(/register\(MODULE_ID, "(\w+)"/g)].map(m => m[1]);
  const merchants = await import("../scripts/merchants.mjs");
  registered.push(merchants.SETTING_ON, merchants.SETTING_MAP, merchants.SETTING_DEFAULTS); // registered from merchants.mjs by constant
  assert.deepEqual([...registered].sort(), [...SETTING_KEYS].sort(), "every registered setting is in the cleanup list");
});

test("no world setting holds a growing record (all registered settings are Boolean or String)", () => {
  const src = read("scripts/main.mjs") + read("scripts/suffix-hooks.mjs");
  const types = [...src.matchAll(/type: (\w+)/g)].map(m => m[1]).filter(t => !["BuildMenu", "MerchantsApp"].includes(t)); // settings-menu classes, not settings
  // Exception released in 0.3.0: the merchant mapping and defaults are bounded Object records (MERCHANTS_MAX, BANDS_MAX) in merchants.mjs.
  const merchantTypes = [...read("scripts/merchants.mjs").matchAll(/type: (\w+)/g)].map(m => m[1]);
  assert.deepEqual(merchantTypes, ["Boolean", "Object", "Object"]);
  assert.ok(types.length + merchantTypes.length >= SETTING_KEYS.length);
  for (const t of types) assert.ok(["Boolean", "String"].includes(t), t);
});

test("a converter version bump rewrites unreviewed items but never accepted or tweaked ones", () => {
  const src = { _id: "a", name: "Ring", system: {}, flags: {} };
  const o = { mode: "convert", ratio: "100", replace: false, dnd5eMajor: 6, rules: "r" };
  const oldHash = sourceHash(src, { ...o, converterVersion: 3 });
  const newHash = sourceHash(src, { ...o, converterVersion: 4 });
  assert.notEqual(oldHash, newHash);
  const stored = new Map([["a", oldHash], ["b", oldHash], ["c", oldHash]]);
  const plan = planSync(stored, [{ id: "a", hash: newHash }, { id: "b", hash: newHash }, { id: "c", hash: newHash }]);
  assert.deepEqual([...plan.replace].sort(), ["a", "b", "c"]);
  const flags = new Map([["a", { flags: { review: { status: "accepted" } } }], ["b", { flags: { review: { status: "tweaked" } } }], ["c", { flags: { review: { status: "skipped" } } }]]);
  const { plan: safe, protected: kept } = protectReviewed(plan, flags);
  assert.deepEqual(safe.replace, ["c"]);
  assert.deepEqual(kept.sort(), ["a", "b"]);
});

test("docs: conversion.md names only rules exports that exist, and public docs carry no game-publisher or official item names", async () => {
  const doc = read("docs/conversion.md");
  const R = await import("../scripts/rules.mjs");
  const named = [...new Set([...doc.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map(m => m[1]))];
  assert.ok(named.length > 15, "the doc names the rule tables");
  for (const n of named) assert.ok(n in R || ["SETTING_KEYS", "REPLACE_LIST", "REVIEW_FLAGS"].includes(n), `${n} is not an export of rules.mjs`);
  const banned = /warcraft|azeroth|blizzard|elvenkind|pearl of power|ring of protection|ring of resistance|ogre power|giant strength/i;
  for (const f of ["docs/conversion.md", "README.md", "CHANGELOG.md"]) {
    const text = read(f).replace(/Blizzard Entertainment or Wizards of the Coast/g, "");
    assert.ok(!banned.test(text), `${f} mentions a publisher or official item name`);
  }
});

test("CI: core's reusable checks at the pinned core version, with a committed lockfile", () => {
  const lock = JSON.parse(read("wanderers-core.lock.json"));
  const wf = read(".github/workflows/test.yml");
  assert.match(wf, new RegExp(`cocoomg11/wanderers-core/\\.github/workflows/module-checks\\.yml@v${lock.version.replace(/\./g, "\\.")}\\b`));
  const pkg = JSON.parse(read("package.json"));
  const pl = JSON.parse(read("package-lock.json"));
  assert.equal(pl.version, pkg.version, "package-lock follows package.json");
  assert.equal(pl.packages[""].version, pkg.version);
  assert.deepEqual(pl.packages[""].devDependencies, pkg.devDependencies);
  assert.equal(pl.packages["node_modules/eslint"].version, pkg.devDependencies.eslint);
  assert.equal(JSON.parse(read("module.json")).version, pkg.version, "module.json and package.json agree");
});
