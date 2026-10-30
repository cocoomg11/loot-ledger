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
  assert.equal(pages.length, 3);
  assert.match(pages[1].name, /GM review \(1\)/);
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
