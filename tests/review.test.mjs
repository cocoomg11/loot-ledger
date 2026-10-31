/**
 * Review board: pure state transitions, queue logic, item view, and the build wiring (reviewed items kept on
 * rebuild unless force, decisions carried forward, rejected items left out of the roll tables).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../scripts/review-model.mjs";
import { install } from "./_foundry.mjs";
import { FIXTURES, srcItem } from "./_fixtures.mjs";

test("applyAction: every action sets its status; note and author kept or replaced", () => {
  const at = "2026-10-31T00:00:00.000Z";
  let r = R.applyAction(null, "accept", { by: "GM", at });
  assert.deepEqual(r, { status: "accepted", note: "", by: "GM", at });
  r = R.applyAction(r, "note", { note: "  check the proc  " });
  assert.equal(r.status, "accepted", "note keeps the status");
  assert.equal(r.note, "check the proc");
  for (const [a, s] of Object.entries(R.ACTIONS)) assert.equal(R.applyAction(r, a, { by: "B", at }).status, s);
  assert.equal(R.applyAction(r, "skip").note, "check the proc", "note survives a status change");
  assert.equal(R.applyAction(r, "skip", { note: "" }).note, "");
  assert.equal(R.applyAction(r, "reject", { by: "B" }).by, "B");
  assert.throws(() => R.applyAction(r, "explode"));
});

test("statusOf / isRejected", () => {
  assert.equal(R.statusOf(undefined), "pending");
  assert.equal(R.statusOf({ review: { status: "bogus" } }), "pending");
  assert.equal(R.statusOf({ review: { status: "tweaked" } }), "tweaked");
  assert.equal(R.isRejected({ review: { status: "rejected" } }), true);
  assert.equal(R.isRejected({ review: { status: "skipped" } }), false);
  assert.equal(R.isRejected({}), false);
});

test("protectReviewed: accepted and tweaked are not rewritten unless force", () => {
  const plan = { create: ["n"], replace: ["a", "t", "s", "r", "p"], skip: ["k"], remove: ["x"] };
  const st = s => ({ flags: { review: { status: s } } });
  const stored = new Map([["a", st("accepted")], ["t", st("tweaked")], ["s", st("skipped")], ["r", st("rejected")], ["p", { flags: {} }]]);
  const out = R.protectReviewed(plan, stored);
  assert.deepEqual(out.plan.replace, ["s", "r", "p"]);
  assert.deepEqual(out.protected, ["a", "t"]);
  assert.deepEqual(out.plan.create, ["n"]);
  assert.deepEqual(out.plan.remove, ["x"], "removed source items still go");
  const forced = R.protectReviewed(plan, stored, { force: true });
  assert.deepEqual(forced.plan.replace, plan.replace);
  assert.deepEqual(forced.protected, []);
  assert.equal(R.protectReviewed(null, stored).plan, null);
});

test("carryReview: skip / reject / notes survive; forced rewrite resets signed-off items to pending", () => {
  assert.equal(R.carryReview(null), null);
  const sk = { status: "skipped", note: "later", by: "GM", at: "t" };
  assert.deepEqual(R.carryReview(sk), sk);
  assert.deepEqual(R.carryReview(sk, { force: true }), sk);
  assert.equal(R.carryReview({ status: "rejected" }, { force: true }).status, "rejected");
  const tw = R.carryReview({ status: "tweaked", note: "edited AC" }, { force: true });
  assert.equal(tw.status, "pending");
  assert.equal(tw.previous, "tweaked");
  assert.equal(tw.note, "edited AC");
  assert.equal(R.carryReview({ status: "accepted" }).status, "accepted");
});

const entries = [
  R.boardEntry("1", "Zeta Ring", { quality: "epic", category: "jewelry", slot: "Finger", converted: { needsReview: true, review: ["Equip: odd thing — no rule for this Equip effect yet"] } }),
  R.boardEntry("2", "Alpha Blade", { quality: "rare", category: "weapon", slot: "One-Hand", converted: { needsReview: true, review: ["Chance on hit: weird — no proc rule"] }, review: { status: "skipped", note: "ask the table" } }),
  R.boardEntry("3", "Beta Helm", { quality: "rare", category: "armor-head", slot: "Head", converted: { needsReview: true, review: ["Equip: odd thing — no rule for this Equip effect yet"] }, review: { status: "accepted" } }),
  R.boardEntry("4", "Gamma Cloak", { quality: "uncommon", category: "armor-back", slot: "Back", converted: { needsReview: true, review: [] }, review: { status: "rejected" } }),
  R.boardEntry("5", "Delta Boots", { quality: "uncommon", category: "armor-limbs", slot: "Feet", converted: { needsReview: true, review: ["x — no proc rule"] }, review: { status: "tweaked" } })
];

test("boardEntry, reasons and onBoard", () => {
  assert.deepEqual(entries[0].reasons, ["no rule for this Equip effect yet"]);
  assert.equal(R.lineOf("Equip: a — b — why"), "Equip: a — b");
  assert.equal(R.reasonOf("plain"), "plain");
  assert.equal(R.onBoard({ converted: { needsReview: false } }), false);
  assert.equal(R.onBoard({ converted: { needsReview: false }, review: { status: "accepted" } }), true);
  assert.equal(R.onBoard({ converted: { needsReview: true } }), true);
});

test("filterQueue, sortQueue, countStatuses", () => {
  const ids = l => l.map(e => e.id);
  assert.deepEqual(ids(R.filterQueue(entries)), ["1", "2"], "default view: pending + skipped");
  assert.deepEqual(ids(R.filterQueue(entries, { status: "all" })), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(ids(R.filterQueue(entries, { status: "accepted" })), ["3"]);
  assert.deepEqual(ids(R.filterQueue(entries, { status: "all", quality: "rare" })), ["2", "3"]);
  assert.deepEqual(ids(R.filterQueue(entries, { status: "all", category: "weapon" })), ["2"]);
  assert.deepEqual(ids(R.filterQueue(entries, { status: "all", slot: "Head" })), ["3"]);
  assert.deepEqual(ids(R.filterQueue(entries, { status: "all", reason: "no proc rule" })), ["2", "5"]);
  assert.deepEqual(ids(R.filterQueue(entries, { status: "all", search: "ODD" })), ["1", "3"], "search matches lines");
  assert.deepEqual(ids(R.filterQueue(entries, { status: "all", search: "the table" })), ["2"], "search matches notes");
  assert.deepEqual(ids(R.sortQueue(entries)), ["1", "2", "5", "3", "4"], "pending, skipped, tweaked, accepted, rejected");
  assert.deepEqual(R.countStatuses(entries), { total: 5, pending: 1, accepted: 1, tweaked: 1, skipped: 1, rejected: 1, done: 3 });
});

test("neighbour / nextAfter / shortcuts", () => {
  const l = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(R.neighbour(l, "b", 1), "c");
  assert.equal(R.neighbour(l, "c", 1), "c", "clamped");
  assert.equal(R.neighbour(l, "a", -1), "a");
  assert.equal(R.neighbour(l, "zz", 1), "a");
  assert.equal(R.neighbour([], "a", 1), null);
  assert.equal(R.nextAfter(l, "b"), "c");
  assert.equal(R.nextAfter(l, "c"), "b");
  assert.equal(R.nextAfter([{ id: "a" }], "a"), null);
  assert.equal(R.shortcutFor({ key: "a" }), "accept");
  assert.equal(R.shortcutFor({ key: "T" }), "tweak");
  assert.equal(R.shortcutFor({ key: "s" }), "skip");
  assert.equal(R.shortcutFor({ key: "r" }), "reject");
  assert.equal(R.shortcutFor({ key: "ArrowRight" }), "next");
  assert.equal(R.shortcutFor({ key: "ArrowLeft" }), "prev");
  assert.equal(R.shortcutFor({ key: "r", ctrlKey: true }), null, "Ctrl+R stays the browser's");
  assert.equal(R.shortcutFor({ key: "x" }), null);
});

test("itemView: flags the review lines among the source lines and splits off the 5e block", async () => {
  const { convertItem } = await import("../scripts/convert.mjs");
  const odd = FIXTURES.find(f => f.name === "Test Odd Ring");
  const { data } = convertItem(odd, { dnd5eMajor: 6 });
  const v = R.itemView(data);
  assert.equal(v.name, "Test Odd Ring");
  assert.equal(v.quality, "epic");
  const flagged = v.sourceLines.filter(l => l.flagged).map(l => l.text);
  assert.deepEqual(flagged, ["Equip: Your attacks summon a friendly squirrel."]);
  assert.ok(v.sourceLines.some(l => l.text === "Finger" && !l.flagged));
  assert.match(v.rulesHtml, /^<section class="loot-ledger-5e"/);
  assert.ok(v.reviewLines.length >= 1 && v.reviewLines.every(r => r.line && r.why));
});

/* ---------- build wiring ---------- */

const { build, CONVERTED_PACK, TABLES_PACK } = await import("../scripts/build.mjs");
const conv = env => env.packs.get(`world.${CONVERTED_PACK.name}`);
const tableUuids = env => [...env.packs.get(`world.${TABLES_PACK.name}`).docs.values()].flatMap(t => t.results.map(r => r.documentUuid));
// Fixture names start with "Test " and are never rollable; these two are.
const axe = srcItem({ name: "Sample Sturdy Axe", quality: "rare", type: "weapon", lines: ["One-Hand", "Axe", "30 - 55 Damage", "Speed 2.40", "+8 Strength", "Item Level 42"] });
const ring = srcItem({ name: "Sample Odd Band", quality: "epic", lines: ["Finger", "Equip: Your attacks summon a friendly squirrel.", "Item Level 60"] });
const setReview = (env, id, review) => { conv(env).docs.get(id).flags["loot-ledger"].review = review; };

test("rejected items are left out of the roll tables on the next build (also with conversion off)", async () => {
  const env = install({ sourceItems: [...FIXTURES, axe, ring], settings: { convertOnBuild: true } });
  await build({ confirm: false });
  assert.ok(tableUuids(env).some(u => u.endsWith(ring._id)), "on the tables before");
  setReview(env, ring._id, { status: "rejected", note: "", by: "GM", at: "t" });
  const s = await build({ confirm: false });
  assert.ok(!tableUuids(env).some(u => u.endsWith(ring._id)), "gone after the rebuild");
  assert.ok(tableUuids(env).some(u => u.endsWith(axe._id)), "others stay");
  assert.equal(s.build.rejected, 1);
  assert.match(env.chat.at(-1).content, /Rejected on the review board/);
  env.store.convertOnBuild = false;
  await build({ confirm: false });
  assert.ok(!tableUuids(env).some(u => u.endsWith(ring._id)), "still left out when the tables use plain copies");
  // un-reject: back on the tables
  env.store.convertOnBuild = true;
  setReview(env, ring._id, { status: "pending", note: "", by: "GM", at: "t" });
  await build({ confirm: false });
  assert.ok(tableUuids(env).some(u => u.endsWith(ring._id)));
});

test("accepted / tweaked items keep their manual edits on rebuild; force rewrites them back to pending", async () => {
  const env = install({ sourceItems: [...FIXTURES, axe, ring], settings: { convertOnBuild: true } });
  await build({ confirm: false });
  const c = conv(env);
  c.docs.get(ring._id).name = "Hand-Edited Band";
  setReview(env, ring._id, { status: "tweaked", note: "AC fixed", by: "GM", at: "t" });
  c.docs.get(axe._id).system.edited = true;
  setReview(env, axe._id, { status: "accepted", note: "", by: "GM", at: "t" });
  const skipId = FIXTURES[0]._id;
  setReview(env, skipId, { status: "skipped", note: "later", by: "GM", at: "t" });
  // every source item changes, so every hash is stale
  for (const d of env.source.docs.values()) d.flags["wow-classic-items"].vendorPrice.totalCopper += 1;
  const s = await build({ confirm: false });
  assert.equal(c.docs.get(ring._id).name, "Hand-Edited Band", "tweaked item not overwritten");
  assert.equal(c.docs.get(axe._id).system.edited, true, "accepted item not overwritten");
  assert.equal(s.build.reviewProtected, 2);
  assert.equal(s.build.converted, FIXTURES.length, "the rest rewritten");
  assert.deepEqual(c.docs.get(skipId).flags["loot-ledger"].review, { status: "skipped", note: "later", by: "GM", at: "t" }, "skip carried onto the rewrite");
  assert.match(env.chat.at(-1).content, /Kept as reviewed/);
  const f = await build({ confirm: false, force: true });
  assert.equal(f.build.reviewProtected, 0);
  assert.equal(c.docs.get(ring._id).name, "Sample Odd Band", "force rewrites");
  assert.equal(c.docs.get(ring._id).flags["loot-ledger"].review.status, "pending");
  assert.equal(c.docs.get(ring._id).flags["loot-ledger"].review.previous, "tweaked");
  assert.equal(c.docs.get(ring._id).flags["loot-ledger"].review.note, "AC fixed");
});

test("dry run with review decisions: zero writes, same exclusions and protection in the plan", async () => {
  const env = install({ sourceItems: [...FIXTURES, axe, ring], settings: { convertOnBuild: true } });
  await build({ confirm: false });
  setReview(env, ring._id, { status: "rejected", note: "", by: "GM", at: "t" });
  setReview(env, axe._id, { status: "accepted", note: "", by: "GM", at: "t" });
  env.source.docs.get(axe._id).flags["wow-classic-items"].vendorPrice.totalCopper += 1;
  const before = JSON.stringify([...conv(env).docs.entries()]);
  const s = await build({ dryRun: true });
  assert.equal(JSON.stringify([...conv(env).docs.entries()]), before);
  assert.equal(s.build.reviewProtected, 1);
  assert.equal(s.build.rejected, 1);
  assert.ok(!s.plan.convert.replace.includes(axe._id));
  assert.ok(!s.plan.tables.flatMap(t => t.results.map(r => r.documentUuid)).some(u => u.endsWith(ring._id)));
});
