/**
 * Collapse (shared mode): keys, groups, canonical pick, members standing alone, the build wiring (flags written and
 * updated, members share one rule, dry run writes nothing) and the collapseMode setting. Made-up fixtures only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../scripts/collapse.mjs";
import { install } from "./_foundry.mjs";
import { FIXTURES, srcItem } from "./_fixtures.mjs";

const flagsOf = (o = {}) => ({ quality: "epic", slot: "Finger", band: 6, converted: { route: "base", shape: "gear" },
  base: { uuid: "Compendium.t.b.Item.x", status: "accept", source: "compendium", plus: 0 }, gapFills: [], ...o });

test("tier bands: four character-level bands over the seven loot bands", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(C.tierBandOf), [1, 1, 2, 2, 3, 3, 4]);
  assert.equal(C.tierBandOf(99), null);
  assert.equal(C.TIER_BANDS.length, 4);
});

test("collapseKey: same rule = same key; quality, band, base, +N and gap-fills split keys", () => {
  const sys = { type: { value: "ring", baseItem: "" } };
  const k1 = C.collapseKey("a", flagsOf(), sys);
  assert.equal(k1, C.collapseKey("b", flagsOf(), sys), "the id is not part of the key");
  assert.ok(k1.includes("|3|"), "tier band 3 for loot band 6");
  assert.notEqual(k1, C.collapseKey("b", flagsOf({ quality: "rare" }), sys));
  assert.notEqual(k1, C.collapseKey("b", flagsOf({ band: 4 }), sys));
  assert.equal(k1, C.collapseKey("b", flagsOf({ band: 5 }), sys), "loot bands 5 and 6 share a tier band");
  assert.notEqual(k1, C.collapseKey("b", flagsOf({ base: { uuid: "Compendium.t.b.Item.y", status: "accept" } }), sys));
  assert.notEqual(k1, C.collapseKey("b", flagsOf({ gapFills: [{ kind: "variant", detail: "stealth" }] }), sys));
  assert.notEqual(k1, C.collapseKey("b", flagsOf(), { ...sys, magicalBonus: 2 }));
  const tpl = flagsOf({ base: { uuid: null, name: "Weapon +1", source: "template", status: "accept", plus: 1 }, converted: { route: "base", shape: "weapon" } });
  assert.match(C.collapseKey("w", tpl, { type: { value: "simpleM", baseItem: "club" }, magicalBonus: 1 }), /template:Weapon \+1\|\+1\|/);
});

test("collapseKey: book, hand-made, source-text and tooltip conversions never collapse; baseline gear collapses by shape, slot, type and band", () => {
  const sys = { type: { value: "ring" } };
  assert.equal(C.collapseKey("a", flagsOf({ converted: { route: "book", shape: "gear" } }), sys), null);
  assert.equal(C.collapseKey("a", flagsOf({ handmade: true }), sys), null);
  assert.equal(C.collapseKey("a", flagsOf({ converted: { route: "convert-review", shape: "gear", sourceText: true } }), sys), null);
  assert.equal(C.collapseKey("a", flagsOf({ converted: { route: "convert-auto", shape: "gear" }, base: undefined }), sys), null, "tooltip conversions follow their own lines");
  assert.equal(C.collapseKey("a", flagsOf({ base: { uuid: "u", status: "suggest" } }), sys), null, "a suggested base is not shared yet");
  assert.equal(C.collapseKey("a", {}), null);
  const grey = { quality: "poor", slot: "Two-Hand", band: 1, converted: { route: "baseline", shape: "weapon" } };
  const wsys = { type: { value: "simpleM", baseItem: "greatclub" } };
  assert.equal(C.collapseKey("a", grey, wsys), C.collapseKey("b", grey, wsys));
  assert.match(C.collapseKey("a", grey, wsys), /^baseline\|weapon\|Two-Hand\|simpleM\/greatclub\|1$/);
  assert.notEqual(C.collapseKey("a", grey, wsys), C.collapseKey("b", { ...grey, slot: "One-Hand" }, wsys), "hands (slot) split baseline keys");
});

test("standsAlone: overrides, a Tweak or an explicit split keep a member out of its group", () => {
  const sys = { type: { value: "ring" } };
  const base = C.collapseKey("a", flagsOf(), sys);
  for (const extra of [{ overrides: { advantage: true } }, { overrides: { raise: true } }, { overrides: { base: "none" } }, { review: { status: "tweaked" } }, { collapse: { split: true } }]) {
    const k = C.collapseKey("a", flagsOf(extra), sys);
    assert.ok(k.startsWith(base) && k.endsWith("|solo:a"), JSON.stringify(extra));
  }
  assert.equal(C.standsAlone(flagsOf({ overrides: { advantage: false, base: "" } })), false, "empty overrides do not count");
  assert.equal(C.standsAlone(flagsOf({ review: { status: "accepted" } })), false);
});

test("collapseGroups: deterministic canonical (first by name, then id), sizes, mode off", () => {
  const sys = { type: { value: "ring" } };
  const items = [
    { id: "z1", name: "Zeta Band", flags: flagsOf(), system: sys },
    { id: "a1", name: "Alpha Band", flags: flagsOf(), system: sys },
    { id: "m1", name: "Alpha Band", flags: flagsOf(), system: sys },
    { id: "r1", name: "Rare Band", flags: flagsOf({ quality: "rare" }), system: sys },
    { id: "b1", name: "Book Band", flags: flagsOf({ converted: { route: "book" } }), system: sys }
  ];
  const { flags, groups } = C.collapseGroups(items);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].members, ["a1", "m1", "z1"], "largest group first; members sorted by name then id");
  assert.equal(groups[0].canonicalId, "a1");
  assert.equal(flags.get("a1").canonical, true);
  assert.equal(flags.get("z1").canonical, false);
  assert.equal(flags.get("z1").canonicalId, "a1");
  assert.equal(flags.get("z1").size, 3);
  assert.equal(flags.get("z1").group, flags.get("a1").group);
  assert.equal(flags.get("r1").size, 1, "a singleton still carries its key");
  assert.equal(flags.get("b1"), null);
  const shuffled = C.collapseGroups([...items].reverse());
  assert.equal(shuffled.flags.get("z1").group, flags.get("z1").group, "order of input does not matter");
  assert.equal(shuffled.groups[0].canonicalId, "a1");
  const off = C.collapseGroups(items, { mode: "off" });
  assert.ok([...off.flags.values()].every(v => v === null));
  assert.equal(off.groups.length, 0);
});

test("collapseUpdates: only changed flags are written; sameCollapse ignores nothing that matters", () => {
  const a = { key: "k", group: "g", canonical: true, canonicalId: "a", size: 2 };
  assert.equal(C.sameCollapse(a, { ...a }), true);
  assert.equal(C.sameCollapse(a, { ...a, size: 3 }), false);
  assert.equal(C.sameCollapse(a, { ...a, split: true }), false);
  assert.equal(C.sameCollapse(null, null), true);
  const wanted = new Map([["a", a], ["b", { ...a, canonical: false, canonicalId: "a" }], ["c", null], ["d", null]]);
  const stored = new Map([["a", { collapse: { ...a } }], ["b", {}], ["c", { collapse: a }], ["d", {}]]);
  assert.deepEqual(C.collapseUpdates(wanted, stored).map(u => u.id), ["b", "c"]);
  assert.deepEqual(C.groupSummary([{ group: "g", canonicalId: "a", members: ["a", "b"] }, { group: "h", canonicalId: "c", members: ["c"] }], id => id.toUpperCase()),
    [{ group: "g", size: 2, canonical: "A", members: ["A", "B"] }]);
});

/* ---------- build wiring ---------- */

const { build, CONVERTED_PACK } = await import("../scripts/build.mjs");
const conv = env => env.packs.get(`world.${CONVERTED_PACK.name}`);
const fxBase = (id, name, o = {}) => ({ _id: id, name, type: "equipment", img: "icons/svg/ring.svg",
  system: { rarities: [o.rarity ?? "rare"], type: { value: "ring", baseItem: "" }, attunement: "", description: { value: "" }, properties: [] },
  effects: [{ name: "fx", transfer: true, changes: [{ key: "system.traits.dr.value", mode: 2, value: "fire" }] }], _stats: { modifiedTime: 1 }, flags: {} });
const ember = () => srcItem({ name: "Test Ember Band", quality: "epic", lines: ["Finger", "+25 Fire Resistance", "Item Level 60"] });
const cinder = () => srcItem({ name: "Test Cinder Band", quality: "epic", lines: ["Finger", "+28 Fire Resistance", "Item Level 58"] });
const greyA = () => srcItem({ name: "Test Grey Club", quality: "poor", type: "weapon", lines: ["Two-Hand", "Mace", "5 - 9 Damage", "Speed 3.00", "Item Level 5"] });
const greyB = () => srcItem({ name: "Test Dull Maul", quality: "poor", type: "weapon", lines: ["Two-Hand", "Mace", "6 - 10 Damage", "Speed 3.20", "Item Level 7"] });
const setup = (settings = {}) => install({ sourceItems: [...FIXTURES.filter(f => f.name !== "Test Grey Club"), ember(), cinder(), greyA(), greyB()],
  settings: { convertOnBuild: true, baseSources: "test.bases", ...settings }, extraPacks: { "test.bases": [fxBase("fx1", "Fixture Ring of Warding")] } });
const ll = (env, id) => conv(env).docs.get(id).flags["loot-ledger"];

test("build: same-rule items share a group and one rule; each keeps its own identity; second build changes nothing", async () => {
  const env = setup();
  const s = await build({ confirm: false });
  const a = ll(env, ember()._id), b = ll(env, cinder()._id);
  assert.equal(a.converted.route, "base");
  assert.equal(a.collapse.group, b.collapse.group);
  assert.equal(a.collapse.size, 2);
  assert.equal(a.collapse.canonicalId, cinder()._id, "first by name");
  assert.equal(b.collapse.canonical, true);
  assert.equal(a.collapse.canonical, false);
  const A = conv(env).docs.get(ember()._id), B = conv(env).docs.get(cinder()._id);
  assert.notEqual(A.name, B.name);
  assert.notEqual(A.flags["loot-ledger"].itemLevel, B.flags["loot-ledger"].itemLevel);
  assert.deepEqual(A.effects.map(e => e.system?.changes ?? e.changes), B.effects.map(e => e.system?.changes ?? e.changes), "same mechanics");
  assert.equal(A.type, B.type);
  const g1 = ll(env, greyA()._id), g2 = ll(env, greyB()._id);
  assert.equal(g1.collapse.group, g2.collapse.group, "baseline gear groups by shape, slot, type and band");
  assert.ok(s.collapse.groups >= 2);
  assert.equal(s.bases.groups, s.collapse.groups);
  const odd = ll(env, FIXTURES.find(f => f.name === "Test Odd Ring")._id);
  assert.equal(odd.collapse, undefined, "a tooltip conversion is not grouped");
  const pages = env.journal[0]._pages;
  const basesPage = pages.find(p => p.name.startsWith("Official bases"));
  assert.ok(basesPage, "Official bases page");
  assert.match(basesPage.text.content, /Collapse groups/);
  assert.match(basesPage.text.content, /Test Cinder Band/);
  const updated = conv(env).writes.updated;
  assert.ok(updated >= 9, "the first build wrote the flags in place");
  const s2 = await build({ confirm: false });
  assert.equal(s2.collapse.changed, 0);
  assert.equal(conv(env).writes.updated, updated, "no flag updates when nothing moved");
});

test("build: an override or split takes a member out of the group; mode off removes the flags; dry run writes nothing", async () => {
  const env = setup();
  await build({ confirm: false });
  conv(env).docs.get(ember()._id).flags["loot-ledger"].overrides = { advantage: true };
  const s = await build({ confirm: false });
  assert.equal(s.build.converted, 1, "the override changes the item's hash: rewritten");
  assert.equal(ll(env, ember()._id).collapse.size, 1);
  assert.equal(ll(env, cinder()._id).collapse.size, 1, "the other member's flag was updated in place");
  assert.deepEqual(ll(env, ember()._id).overrides, { advantage: true }, "overrides survive the rewrite");
  conv(env).docs.get(greyA()._id).flags["loot-ledger"].collapse.split = true;
  await build({ confirm: false });
  assert.equal(ll(env, greyA()._id).collapse.split, true);
  assert.equal(ll(env, greyA()._id).collapse.size, 1);
  assert.equal(ll(env, greyB()._id).collapse.size, 1);
  // dry run with the setting off: plans the removals, writes nothing
  env.store.collapseMode = "off";
  const before = JSON.stringify([...conv(env).docs.entries()]);
  const dry = await build({ dryRun: true });
  assert.equal(JSON.stringify([...conv(env).docs.entries()]), before);
  assert.equal(dry.collapse.mode, "off");
  assert.ok(dry.collapse.changed >= 4, "every flag would go");
  assert.ok(dry.plan.items.every(i => i.collapse === null), "dry-run item plan shows no groups");
  assert.ok(dry.plan.items.some(i => i.base?.status === "accept" && i.route === "base"));
  const real = await build({ confirm: false });
  assert.equal(real.collapse.changed, dry.collapse.changed);
  assert.equal(ll(env, cinder()._id).collapse, undefined);
});
