/**
 * Review-board overrides and flags: the pure override model (actions, group decisions, folded groups, kind filters),
 * the converter's review flags and overrides (pinned / dropped base, Advantage, endgame raise), and the build wiring
 * (an override rewrites the item on the next Build; dry run writes nothing). Made-up fixtures only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../scripts/review-model.mjs";
import { convertItem, REVIEW_FLAGS } from "../scripts/convert.mjs";
import { indexBases } from "../scripts/base-match.mjs";
import { install } from "./_foundry.mjs";
import { FIXTURES, srcItem } from "./_fixtures.mjs";

const flagsOf = (o = {}) => ({ quality: "epic", base: { uuid: "u1", name: "Fixture Ring of Warding", status: "suggest", confidence: 0.5 },
  baseCandidates: [{ uuid: "u1", name: "Fixture Ring of Warding", confidence: 0.5 }, { uuid: "u2", name: "Fixture Band of Embers", confidence: 0.45 }], ...o });

test("overrideUpdate: every action, its guards, merge semantics", () => {
  assert.deepEqual(R.overrideUpdate(flagsOf(), "acceptBase"), { overrides: { base: "u1" } });
  assert.deepEqual(R.overrideUpdate(flagsOf({ base: null }), "acceptBase"), { overrides: { base: "u1" } }, "falls back to the first candidate");
  assert.throws(() => R.overrideUpdate({ quality: "epic" }, "acceptBase"), /no base/);
  assert.deepEqual(R.overrideUpdate(flagsOf(), "pickBase", { uuid: "u2" }), { overrides: { base: "u2" } });
  assert.throws(() => R.overrideUpdate(flagsOf(), "pickBase", { uuid: "nope" }), /candidates/);
  assert.deepEqual(R.overrideUpdate(flagsOf({ overrides: { raise: true } }), "dropBase"), { overrides: { raise: true, base: "none" } }, "other overrides kept");
  assert.deepEqual(R.overrideUpdate(flagsOf({ collapse: { group: "g", size: 2 } }), "split"), { collapse: { group: "g", size: 2, split: true } });
  assert.deepEqual(R.overrideUpdate(flagsOf(), "advantage"), { overrides: { advantage: true } });
  assert.deepEqual(R.overrideUpdate(flagsOf({ overrides: { advantage: true } }), "advantage"), { overrides: { advantage: false } }, "toggle off is written, not deleted");
  assert.throws(() => R.overrideUpdate(flagsOf({ quality: "rare" }), "advantage"), /epic and legendary/);
  assert.deepEqual(R.overrideUpdate({}, "raise"), { overrides: { raise: true } });
  assert.throws(() => R.overrideUpdate({}, "explode"), /unknown override/);
  assert.deepEqual(R.OVERRIDE_ACTIONS, ["acceptBase", "pickBase", "dropBase", "split", "advantage", "raise"]);
});

const entry = (id, name, o = {}) => R.boardEntry(id, name, { quality: "epic", slot: "Finger", converted: { route: "base", review: [] }, ...o });
const grp = (canonicalId, id, extra = {}) => ({ group: "g1", canonical: id === canonicalId, canonicalId, size: 3, ...extra });
const entries = [
  entry("a", "Alpha Band", { collapse: grp("a", "a") }),
  entry("b", "Beta Band", { collapse: grp("a", "b") }),
  entry("c", "Gamma Band", { collapse: grp("a", "c", { split: true }) }),
  entry("d", "Delta Band", { converted: { route: "convert-review", review: ["Equip: x — no rule"] }, base: { status: "suggest", name: "B", confidence: 0.5 } }),
  entry("e", "Echo Band", { converted: { route: "convert-review", review: ["Equip: y — no rule"], flags: [{ kind: "zeroPrice", why: "no vendor price" }] } }),
  entry("f", "Foxtrot Band", { converted: { route: "convert-review", sourceText: true, review: [] } })
];

test("groupIds and foldGroups: a group is one entry with its members; split members stand alone", () => {
  assert.deepEqual(R.groupIds(entries, entries[0]), ["a", "b"], "split member c is not part of the decision");
  assert.deepEqual(R.groupIds(entries, entries[1]), ["a", "b"]);
  assert.deepEqual(R.groupIds(entries, entries[2]), ["c"]);
  assert.deepEqual(R.groupIds(entries, entries[3]), ["d"]);
  const folded = R.foldGroups(entries);
  assert.deepEqual(folded.map(e => e.id), ["a", "c", "d", "e", "f"]);
  assert.deepEqual(folded[0].members.map(m => m.id), ["a", "b"]);
  assert.equal(folded[1].members, undefined);
});

test("kind filters: suggested base, no base, collapsed group, source-text item, flagged", () => {
  const ids = f => R.filterQueue(entries, { status: "all", ...f }).map(e => e.id);
  assert.deepEqual(ids({ kind: "suggested" }), ["d"]);
  assert.deepEqual(ids({ kind: "nobase" }), ["e", "f"]);
  assert.deepEqual(ids({ kind: "group" }), ["a", "b"]);
  assert.deepEqual(ids({ kind: "sourceText" }), ["f"]);
  assert.deepEqual(ids({ kind: "flagged" }), ["e"]);
  assert.deepEqual(ids({}), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(Object.keys(R.KINDS), ["suggested", "nobase", "group", "sourceText", "flagged"]);
  const e = entries[3];
  assert.equal(e.base.status, "suggest");
  assert.deepEqual(entries[4].flags, [{ kind: "zeroPrice", why: "no vendor price" }]);
});

/* ---------- converter: review flags and overrides ---------- */

const conv = (src, o = {}) => convertItem(src, { dnd5eMajor: 6, ...o });
const kinds = r => (r.data.flags["loot-ledger"].converted.flags ?? []).map(f => f.kind);

test("review flags raised at build: zero price, source text replaced, non-damage proc, fist stand-in, thrown, proc parts", () => {
  const free = srcItem({ name: "Test Free Band", quality: "rare", lines: ["Finger", "+9 Strength", "Item Level 40"], sell: 0 });
  assert.deepEqual(kinds(conv(free)), ["zeroPrice"]);
  const fist = srcItem({ name: "Test Claw", quality: "rare", type: "weapon", lines: ["One-Hand", "Fist Weapon", "20 - 40 Damage", "Speed 1.50", "+8 Agility", "Item Level 40"] });
  assert.ok(kinds(conv(fist)).includes("fistStandIn"));
  const thrown = srcItem({ name: "Test Throwing Knife", quality: "uncommon", type: "weapon", lines: ["Thrown", "Thrown", "10 - 20 Damage", "Speed 1.50", "Item Level 20"] });
  assert.ok(kinds(conv(thrown)).includes("stackableThrown"));
  const flurry = FIXTURES.find(f => f.name === "Test Quick Dagger");
  assert.ok(kinds(conv(flurry)).includes("nonDamageProc"));
  const parts = srcItem({ name: "Test Twin Fang", quality: "epic", type: "weapon", lines: ["One-Hand", "Dagger", "30 - 56 Damage", "Speed 1.80", "Chance on hit: Deals 80 Shadow damage. Lowers all stats.", "Item Level 60"] });
  const r = conv(parts);
  assert.ok(kinds(r).includes("procParts"));
  assert.equal(r.result.needsReview, true, "proc parts still go to review as before");
  const replaced = FIXTURES.find(f => f.name === "Test Fibbing Headdress");
  assert.ok(kinds(conv(replaced)).includes("sourceTextConflict"));
  const plain = FIXTURES.find(f => f.name === "Test Lucky Charm");
  assert.deepEqual(kinds(conv(plain)), [], "a clean item carries no flag");
  assert.equal(conv(free).result.needsReview, false, "a flag alone does not need review");
  for (const k of Object.keys(REVIEW_FLAGS)) assert.ok(REVIEW_FLAGS[k].length > 3, k);
});

const fxBase = (id, name, o = {}) => ({ _id: id, name, type: "equipment", img: "icons/svg/ring.svg",
  system: { rarities: [o.rarity ?? "rare"], type: { value: "ring", baseItem: "" }, attunement: "", description: { value: o.text ?? "" }, properties: [] },
  effects: o.effects ?? [], _stats: { modifiedTime: 1 }, flags: {} });
const ward = () => fxBase("fx1", "Fixture Ring of Warding", { effects: [{ name: "fx", transfer: true, changes: [{ key: "system.traits.dr.value", mode: 2, value: "fire" }] }] });
const keen = () => fxBase("fx2", "Fixture Band of Keenness", { effects: [{ name: "fx", transfer: true, changes: [{ key: "system.attributes.init.bonus", mode: 2, value: "2" }] }] });
const ember = () => srcItem({ name: "Test Ember Band", quality: "epic", lines: ["Finger", "+25 Fire Resistance", "Item Level 60"] });
const index = () => indexBases([{ pack: "test.bases", entries: [ward(), keen()].map(e => ({ ...e, uuid: `Compendium.test.bases.Item.${e._id}` })) }]);

test("converter overrides: a pinned base is accepted, 'none' drops the base, candidates are stored, Advantage and raise", () => {
  const auto = conv(ember(), { bases: index() });
  const f = auto.data.flags["loot-ledger"];
  assert.equal(f.base.status, "accept");
  assert.equal(f.base.name, "Fixture Ring of Warding");
  assert.ok(f.baseCandidates.length >= 1 && f.baseCandidates[0].uuid, "candidates stored at build");
  assert.equal(f.overrides, undefined);
  const dropped = conv(ember(), { bases: index(), overrides: { base: "none" } });
  const fd = dropped.data.flags["loot-ledger"];
  assert.equal(fd.base, undefined);
  assert.equal(fd.converted.route, "convert-auto");
  assert.deepEqual(fd.overrides, { base: "none" });
  assert.ok(fd.baseCandidates.length >= 1, "candidates still stored so the GM can pick again");
  const pinned = conv(ember(), { bases: index(), overrides: { base: "Compendium.test.bases.Item.fx2" } });
  const fp = pinned.data.flags["loot-ledger"];
  assert.equal(fp.base.name, "Fixture Band of Keenness");
  assert.equal(fp.base.status, "accept");
  assert.equal(fp.base.pinned, true);
  assert.equal(fp.converted.route, "base");
  assert.equal(pinned.basedOn.uuid, "Compendium.test.bases.Item.fx2");
  const missing = conv(ember(), { bases: index(), overrides: { base: "Compendium.test.bases.Item.zz" } });
  assert.equal(missing.data.flags["loot-ledger"].base.name, "Fixture Ring of Warding", "unknown uuid: the matcher's choice stays");
  assert.ok(missing.result.needsReview);
  // Advantage swap (epic / legendary only) and the endgame raise
  const charm = srcItem({ name: "Test Keen Cloak", quality: "epic", lines: ["Back", "+20 Agility", "Item Level 60"] });
  const flat = conv(charm), adv = conv(charm, { overrides: { advantage: true } });
  const keys = r => r.data.effects.flatMap(e => e.changes.map(c => c.key));
  assert.ok(keys(flat).includes("system.skills.ste.bonuses.check"));
  assert.ok(keys(adv).includes("system.skills.ste.roll.mode"), "Advantage swap on");
  const green = srcItem({ name: "Test Keen Cape", quality: "uncommon", lines: ["Back", "+10 Agility", "Item Level 30"] });
  assert.ok(!keys(conv(green, { overrides: { advantage: true } })).includes("system.skills.ste.roll.mode"), "never below epic");
  const blade = FIXTURES.find(f => f.name === "Test Longblade");
  assert.equal(conv(blade).data.system.magicalBonus, 1);
  assert.equal(conv(blade, { overrides: { raise: true } }).data.system.magicalBonus, 2);
});

/* ---------- build wiring ---------- */

const { build, CONVERTED_PACK } = await import("../scripts/build.mjs");
const convPack = env => env.packs.get(`world.${CONVERTED_PACK.name}`);

test("build: an override stored on the converted item rewrites it on the next Build and survives; dry run writes nothing", async () => {
  const env = install({ sourceItems: [...FIXTURES, ember()], settings: { convertOnBuild: true, baseSources: "test.bases" }, extraPacks: { "test.bases": [ward(), keen()] } });
  await build({ confirm: false });
  const doc = () => convPack(env).docs.get(ember()._id);
  assert.equal(doc().flags["loot-ledger"].base.name, "Fixture Ring of Warding");
  assert.throws(() => R.overrideUpdate(doc().flags["loot-ledger"], "pickBase", { uuid: "Compendium.test.bases.Item.fx2" }), /candidates/, "not a scored candidate of this item");
  doc().flags["loot-ledger"].overrides = { base: "Compendium.test.bases.Item.fx2" }; // a GM macro may pin any indexed base
  const before = JSON.stringify([...convPack(env).docs.entries()]);
  const dry = await build({ dryRun: true });
  assert.equal(JSON.stringify([...convPack(env).docs.entries()]), before, "dry run: untouched");
  assert.deepEqual(dry.plan.convert.replace, [ember()._id], "only the overridden item is planned");
  const s = await build({ confirm: false });
  assert.equal(s.build.converted, 1);
  const f = doc().flags["loot-ledger"];
  assert.equal(f.base.name, "Fixture Band of Keenness");
  assert.equal(f.base.pinned, true);
  assert.deepEqual(f.overrides, { base: "Compendium.test.bases.Item.fx2" }, "override carried onto the rewrite");
  const again = await build({ confirm: false });
  assert.equal(again.build.converted, 0, "stable afterwards");
  Object.assign(doc().flags["loot-ledger"], R.overrideUpdate(f, "dropBase"));
  await build({ confirm: false });
  assert.equal(doc().flags["loot-ledger"].base, undefined);
  assert.equal(doc().flags["loot-ledger"].converted.route, "convert-auto");
});
