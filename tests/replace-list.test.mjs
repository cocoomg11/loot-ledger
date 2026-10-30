import { test } from "node:test";
import assert from "node:assert/strict";
import { REPLACE_LIST, REPLACE_LIST_EXPECTED } from "../scripts/replace-list.mjs";
import { indexReplaceList, replaceEntry, replaceListStatus } from "../scripts/ledger.mjs";
import { convertItem } from "../scripts/convert.mjs";
import { srcItem, FIXTURES } from "./_fixtures.mjs";

test("replace list holds identifiers only, no duplicates", () => {
  const names = new Set();
  for (const e of REPLACE_LIST) {
    assert.equal(typeof e.name, "string");
    assert.ok(e.name.length > 0 && e.name.length < 80);
    assert.deepEqual(Object.keys(e).filter(k => !["name", "itemId", "note"].includes(k)), [], `${e.name}: only name / itemId / note`);
    assert.ok(!names.has(e.name.toLowerCase()), `duplicate ${e.name}`);
    names.add(e.name.toLowerCase());
  }
  assert.ok(REPLACE_LIST.length <= REPLACE_LIST_EXPECTED);
  for (const n of ["Scarlet Kris", "Feathermoon Headdress", "Band of Sulfuras"]) assert.ok(names.has(n.toLowerCase()), n);
});

test("matching: item id first, then case-insensitive exact name", () => {
  const idx = indexReplaceList([{ name: "Alpha Blade" }, { name: "Renamed Thing", itemId: 1234 }]);
  assert.ok(replaceEntry({ name: "alpha blade", flags: {} }, idx));
  assert.equal(replaceEntry({ name: "Alpha Blade of Doom", flags: {} }, idx), null, "no partial matches");
  assert.ok(replaceEntry({ name: "New Name", flags: { "wow-classic-items": { itemId: 1234 } } }, idx));
  assert.equal(replaceEntry({ name: "Renamed Thing", flags: {} }, idx), null, "an id entry only matches by id");
});

test("a listed hand-written item is replaced even when it passes the audit", () => {
  const kept = FIXTURES.find(f => f.name === "Test Hand-Written Blade");
  const normal = convertItem(kept, { dnd5eMajor: 6 });
  assert.equal(normal.data.flags["loot-ledger"].converted.handAuthoredKept, true, "passes the audit on its own");
  const forced = convertItem(kept, { dnd5eMajor: 6, forceReplace: true });
  const c = forced.data.flags["loot-ledger"].converted;
  assert.equal(c.handAuthoredKept, false);
  assert.equal(c.replaceList, true);
  assert.ok(c.handAuthoredReplaced.some(x => x.startsWith("replace-list")));
  assert.match(forced.data.system.description.value, /replace list/);
  assert.ok(forced.result.features.length >= 1, "Loot Ledger's own traceable conversion is used");
});

test("forceReplace on an item without hand-written rules changes nothing", () => {
  const plain = FIXTURES.find(f => f.name === "Test Longblade");
  assert.deepEqual(convertItem(plain, { dnd5eMajor: 6, forceReplace: true }).data, convertItem(plain, { dnd5eMajor: 6 }).data);
});

test("status lists applied, missing and no-effect entries", () => {
  const list = [{ name: "A" }, { name: "B" }, { name: "C" }];
  const s = replaceListStatus(list, [{ entry: list[0], handAuthored: true }, { entry: list[2], handAuthored: false }]);
  assert.deepEqual(s, { total: 3, applied: ["A"], notHandWritten: ["C"], missing: ["B"] });
});

test("named items match source-shaped data", () => {
  const idx = indexReplaceList(REPLACE_LIST);
  const item = srcItem({ name: "Band of Sulfuras", quality: "epic", lines: ["Finger", "Item Level 60"] });
  assert.ok(replaceEntry(item, idx));
});
