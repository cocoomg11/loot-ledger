/**
 * build() end to end against the in-memory Foundry mock: idempotence, resumability, conversion wiring, tables
 * pointing at converted items, replace list, review routing and the GM report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { install } from "./_foundry.mjs";
import { FIXTURES, srcItem } from "./_fixtures.mjs";

const { build, ITEMS_PACK, CONVERTED_PACK, TABLES_PACK } = await import("../scripts/build.mjs");
const items = env => env.packs.get(`world.${ITEMS_PACK.name}`);
const conv = env => env.packs.get(`world.${CONVERTED_PACK.name}`);
const tables = env => env.packs.get(`world.${TABLES_PACK.name}`);
const tableUuids = env => [...tables(env).docs.values()].flatMap(t => t.results.map(r => r.documentUuid));

test("conversion off (default): plain copies only, second build writes nothing", async () => {
  const env = install({ sourceItems: FIXTURES });
  const s1 = await build({ confirm: false });
  assert.equal(s1.convert, false);
  assert.equal(conv(env), undefined, "no converted pack");
  assert.equal(items(env).docs.size, FIXTURES.length);
  assert.equal(s1.build.copied, FIXTURES.length);
  assert.ok(tableUuids(env).every(u => !u.includes(CONVERTED_PACK.name)));
  const s2 = await build({ confirm: false });
  assert.equal(s2.build.copied, 0);
  assert.equal(s2.build.skipped, FIXTURES.length);
  assert.equal(items(env).docs.size, FIXTURES.length, "no duplicates");
  assert.equal(env.journal.length, 1, "one Build Report entry, reused");
  assert.equal(env.chat.length, 2);
  assert.ok(env.chat[1].whisper.length, "whispered to GMs");
});

test("conversion on: converted pack, tables point at it, report lists review and replaced", async () => {
  const listed = srcItem({ name: "Scarlet Kris", quality: "rare", type: "weapon",
    pre: "<p><strong>Edge.</strong> When you hit, the target takes an extra 1d6 fire damage.</p>",
    lines: ["One-Hand", "Dagger", "20 - 40 Damage", "Speed 1.80", "Chance on hit: Burns the target for 40 Fire damage.", "Item Level 40"] });
  const env = install({ sourceItems: [...FIXTURES, listed], settings: { convertOnBuild: true } });
  const s = await build({ confirm: false });
  assert.equal(s.convert, true);
  const n = FIXTURES.length + 1;
  assert.equal(conv(env).docs.size, n);
  assert.equal(s.build.converted, n);
  // every item table result points at the converted pack
  const itemResults = tableUuids(env).filter(u => u.includes(".Item."));
  assert.ok(itemResults.length > 0);
  assert.ok(itemResults.every(u => u.includes(CONVERTED_PACK.name)), "tables use converted versions");
  // routing
  assert.equal(s.build.review, 1, "the odd ring");
  assert.equal(s.build.replaced, 2, "fibbing headdress (audit) + Scarlet Kris (replace list)");
  assert.equal(s.build.replaceList, 1);
  assert.equal(s.build.kept, 1);
  assert.deepEqual(s.replaceList.applied, ["Scarlet Kris"]);
  assert.deepEqual(s.replaceList.missing, ["Feathermoon Headdress", "Band of Sulfuras"]);
  const kris = conv(env).docs.get(listed._id);
  assert.equal(kris.flags["loot-ledger"].converted.replaceList, true);
  assert.equal(kris.flags["loot-ledger"].converted.handAuthoredKept, false);
  // report
  const pages = env.journal[0]._pages;
  assert.equal(pages.length, 4);
  assert.match(pages[1].name, /GM review \(1\)/);
  assert.match(pages[3].name, /^Random suffixes \(0\)$/);
  assert.match(pages[1].text.content, /Test Odd Ring/);
  assert.match(pages[2].text.content, /Scarlet Kris/);
  assert.match(env.chat.at(-1).content, /GM review needed:<\/strong> 1/);
  // idempotent
  const s2 = await build({ confirm: false });
  assert.equal(s2.build.converted, 0);
  assert.equal(s2.build.copied, 0);
  assert.equal(s2.build.skipped, 2 * n);
  assert.equal(conv(env).docs.size, n);
  assert.equal(s2.build.review, 1, "unchanged items still reported");
});

test("changed source item is rewritten, removed one pruned, the rest skipped", async () => {
  const env = install({ sourceItems: FIXTURES, settings: { convertOnBuild: true } });
  await build({ confirm: false });
  const [first, second] = [...env.source.docs.values()];
  first.flags["wow-classic-items"].vendorPrice.totalCopper += 1;
  env.source.docs.delete(second._id);
  const s = await build({ confirm: false });
  assert.equal(s.build.copied, 1);
  assert.equal(s.build.converted, 1);
  assert.equal(s.build.removed, 2);
  assert.equal(items(env).docs.size, FIXTURES.length - 1);
  assert.equal(conv(env).docs.size, FIXTURES.length - 1);
});

test("resumes after an interrupted build", async () => {
  const env = install({ sourceItems: FIXTURES, settings: { convertOnBuild: true } });
  await build({ confirm: false });
  // simulate a crash that lost half of the converted pack
  const ids = [...conv(env).docs.keys()].slice(0, 5);
  for (const id of ids) conv(env).docs.delete(id);
  const s = await build({ confirm: false });
  assert.equal(s.build.converted, 5);
  assert.equal(s.build.copied, 0);
  assert.equal(conv(env).docs.size, FIXTURES.length);
});

test("turning conversion off again points tables back at the plain copies", async () => {
  const env = install({ sourceItems: FIXTURES, settings: { convertOnBuild: true } });
  await build({ confirm: false });
  env.store.convertOnBuild = false;
  await build({ confirm: false });
  assert.ok(tableUuids(env).filter(u => u.includes(".Item.")).every(u => u.includes(ITEMS_PACK.name)));
});

test("force rewrites everything", async () => {
  const env = install({ sourceItems: FIXTURES });
  await build({ confirm: false });
  const s = await build({ confirm: false, force: true });
  assert.equal(s.build.copied, FIXTURES.length);
  assert.equal(items(env).docs.size, FIXTURES.length);
});

/** Counts every call that could write: pack document/folder creates and deletes, journal and chat creates, pack creation. */
function spyOnWrites(env) {
  const calls = [];
  const wrap = (obj, name, label) => { const orig = obj[name]; obj[name] = (...a) => { calls.push(label); return orig.apply(obj, a); }; };
  for (const k of ["Item", "RollTable", "Folder"]) { wrap(globalThis[k], "createDocuments", `${k}.createDocuments`); wrap(globalThis[k], "deleteDocuments", `${k}.deleteDocuments`); }
  wrap(globalThis.JournalEntry, "create", "JournalEntry.create");
  wrap(globalThis.ChatMessage, "create", "ChatMessage.create");
  const C = globalThis.foundry.documents.collections.CompendiumCollection;
  wrap(C, "createCompendium", "createCompendium");
  for (const p of env.packs.values()) wrap(p, "configure", "pack.configure");
  const dlg = globalThis.foundry.applications.api.DialogV2; wrap(dlg, "confirm", "confirm dialog");
  return calls;
}

test("dryRun on an empty world: returns plan, report data and counts; zero writes of any kind", async () => {
  const rollable = srcItem({ name: "Sample Sturdy Axe", quality: "rare", type: "weapon", lines: ["One-Hand", "Axe", "30 - 55 Damage", "Speed 2.40", "+8 Strength", "Item Level 42"] });
  const sources = [...FIXTURES, rollable]; // fixture names start with "Test " and are kept out of the tables
  const env = install({ sourceItems: sources, settings: { convertOnBuild: true } });
  const calls = spyOnWrites(env);
  const packsBefore = [...env.packs.keys()];
  const s = await build({ dryRun: true });   // confirm left on: a dry run must not even ask
  assert.deepEqual(calls, [], "no write, create, delete, configure, chat or confirm call");
  assert.deepEqual([...env.packs.keys()], packsBefore, "no compendium created");
  assert.equal(env.journal.length, 0);
  assert.equal(env.chat.length, 0);
  assert.equal(s.dryRun, true);
  assert.equal(s.build.copied, sources.length);
  assert.equal(s.build.converted, sources.length);
  assert.equal(s.build.review, 1, "the odd ring is reported");
  assert.equal(s.plan.copy.create.length, sources.length);
  assert.equal(s.plan.convert.create.length, sources.length);
  assert.ok(s.plan.tables.length > 0 && s.tables === s.plan.tables.length);
  assert.ok(s.plan.tables.flatMap(t => t.results.map(r => r.documentUuid)).filter(u => u.includes(".Item.")).every(u => u.includes(CONVERTED_PACK.name)));
  assert.equal(s.report.pages.length, 4);
  assert.match(s.report.pages[1].html ?? s.report.pages[1].text?.content ?? "", /Test Odd Ring/);
  assert.match(s.report.summaryHtml, /GM review needed/);
  assert.equal(s.reportUuid ?? null, null);
  // and a real build afterwards still works and matches the plan
  const real = await build({ confirm: false });
  assert.equal(real.build.copied, s.build.copied);
  assert.equal(real.build.converted, s.build.converted);
  assert.equal(real.build.review, s.build.review);
  assert.equal(real.tables, s.tables);
});

test("dryRun on a built world: plans only the differences, leaves the packs byte-for-byte alone", async () => {
  const env = install({ sourceItems: FIXTURES, settings: { convertOnBuild: true } });
  await build({ confirm: false });
  const snapshot = () => JSON.stringify([...env.packs].filter(([k]) => k.startsWith("world.")).map(([k, p]) => [k, [...p.docs.entries()], [...p.folderDocs.entries()], p.writes]));
  const before = snapshot(), chatBefore = env.chat.length, journalBefore = env.journal.length;
  const [first, second] = [...env.source.docs.values()];
  first.flags["wow-classic-items"].vendorPrice.totalCopper += 1;
  env.source.docs.delete(second._id);
  const calls = spyOnWrites(env);
  const s = await build({ dryRun: true, confirm: false });
  assert.deepEqual(calls, []);
  assert.equal(snapshot(), before, "packs untouched");
  assert.equal(env.chat.length, chatBefore);
  assert.equal(env.journal.length, journalBefore);
  assert.equal(s.build.copied, 1);
  assert.equal(s.build.converted, 1);
  assert.equal(s.build.removed, 2);
  assert.equal(s.plan.copy.remove.length, 1);
  assert.equal(s.build.review, 1, "unchanged review items still reported");
});

test("dryRun with the pack locked and with conversion off: still no writes", async () => {
  const env = install({ sourceItems: FIXTURES });
  await build({ confirm: false });
  for (const p of env.packs.values()) p.locked = true;
  const calls = spyOnWrites(env);
  const s = await build({ dryRun: true, force: true });
  assert.deepEqual(calls, []);
  assert.ok([...env.packs.values()].filter(p => p !== env.source).every(p => p.locked), "still locked");
  assert.equal(s.convert, false);
  assert.equal(s.plan.convert, null);
  assert.equal(s.build.copied, FIXTURES.length, "force plans every item");
});

test('"<Random enchantment>" is flavour: not counted as not converted', async () => {
  const { convertItem } = await import("../scripts/convert.mjs");
  const base = ["Finger", "+9 Strength", "Item Level 40"];
  const plain = srcItem({ name: "Test Plain Band", quality: "rare", lines: base });
  const rnd = srcItem({ name: "Test Random Band", quality: "rare", lines: [...base, "&lt;Random enchantment&gt;"] });
  const rnd2 = srcItem({ name: "Test Random Band Raw", quality: "rare", lines: [...base, "<Random enchantment>"] });
  const nc = d => convertItem(d, { dnd5eMajor: 6 }).result.notConverted ?? [];
  const parse = d => convertItem(d, { dnd5eMajor: 6 });
  for (const d of [rnd, rnd2]) {
    const r = parse(d);
    assert.equal(JSON.stringify(r).includes("Random enchantment") && JSON.stringify(nc(d)).includes("enchantment"), false, "not listed as not converted");
    assert.deepEqual(nc(d), nc(plain), "same not-converted list as the same item without the line");
  }
  assert.equal(parse(rnd2).result.needsReview, parse(plain).result.needsReview, "no review added either");
});
