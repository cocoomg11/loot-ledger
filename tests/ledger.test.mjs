import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, hashString, sourceHash, rulesFingerprint, planSync, route, reportRow, errorRow, summaryCounts, summaryHtml, reportPages } from "../scripts/ledger.mjs";
import * as RULES from "../scripts/rules.mjs";
import { convertItem } from "../scripts/convert.mjs";
import { FIXTURES, srcItem } from "./_fixtures.mjs";

const base = () => srcItem({ name: "Hash Probe", quality: "rare", lines: ["Finger", "+9 Stamina", "Item Level 40"] });

test("canonical JSON ignores key order and handles Sets, RegExps, Infinity", () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.notEqual(canonical({ x: /a/i }), canonical({ x: /a/g }));
  assert.equal(canonical(new Set([2, 1])), canonical(new Set([1, 2])));
  assert.equal(canonical({ x: Infinity }), '{"x":"∞"}');
  assert.match(hashString("x"), /^[0-9a-f]{16}$/);
});

test("source hash is stable for identical input", () => {
  const o = { mode: "convert", ratio: "100", converterVersion: 2, rules: rulesFingerprint(), replace: false, officialPacks: ["b", "a"], dnd5eMajor: 6 };
  assert.equal(sourceHash(base(), o), sourceHash(base(), { ...o, officialPacks: ["a", "b"] }));
  assert.equal(sourceHash(base(), { mode: "copy", ratio: "100" }), sourceHash(base(), { mode: "copy", ratio: "100" }));
});

test("source hash changes with the source, ratio, rules, converter version and replace flag", () => {
  const o = { mode: "convert", ratio: "100", converterVersion: 2, rules: rulesFingerprint(), replace: false, dnd5eMajor: 6 };
  const h = sourceHash(base(), o);
  const edited = base(); edited.system.description.value += "<div>Equip: something new.</div>";
  const resold = base(); resold.flags["wow-classic-items"].vendorPrice.totalCopper = 1;
  assert.notEqual(sourceHash(edited, o), h, "tooltip edit");
  assert.notEqual(sourceHash(resold, o), h, "price change");
  assert.notEqual(sourceHash(base(), { ...o, ratio: "10" }), h, "coin ratio");
  assert.notEqual(sourceHash(base(), { ...o, converterVersion: 3 }), h, "converter version");
  assert.notEqual(sourceHash(base(), { ...o, replace: true }), h, "replace list");
  assert.notEqual(sourceHash(base(), { ...o, officialPacks: ["dnd5e.items"] }), h, "official packs installed");
  assert.notEqual(sourceHash(base(), { ...o, mode: "copy" }), h, "copy vs convert");
});

test("rules fingerprint changes when any calibration value changes", () => {
  const f = rulesFingerprint();
  assert.equal(rulesFingerprint(), f);
  const tweaked = { ...RULES, BLAST_USES: { ...RULES.BLAST_USES, 4: 4 } };
  assert.notEqual(rulesFingerprint(tweaked), f);
  const rx = { ...RULES, TRINKET_RULE: { ...RULES.TRINKET_RULE, defensive: /Armor/i } };
  assert.notEqual(rulesFingerprint(rx), f, "regex edits count");
});

test("planSync: create, replace, skip, remove", () => {
  const existing = new Map([["a", "h1"], ["b", "old"], ["c", null], ["gone", "h9"]]);
  const plan = planSync(existing, [{ id: "a", hash: "h1" }, { id: "b", hash: "h2" }, { id: "c", hash: "h3" }, { id: "new", hash: "h4" }]);
  assert.deepEqual(plan, { create: ["new"], replace: ["b", "c"], skip: ["a"], remove: ["gone"] });
});

test("planSync is idempotent: a second run over its own output writes nothing", () => {
  const desired = FIXTURES.map(f => ({ id: f._id, hash: sourceHash(f, { mode: "copy" }) }));
  const first = planSync(new Map(), desired);
  assert.equal(first.create.length, FIXTURES.length);
  const stored = new Map(desired.map(d => [d.id, d.hash]));
  const second = planSync(stored, FIXTURES.map(f => ({ id: f._id, hash: sourceHash(f, { mode: "copy" }) })));
  assert.deepEqual(second, { create: [], replace: [], skip: FIXTURES.map(f => f._id), remove: [] });
});

test("planSync never duplicates: repeated ids in the desired list yield one document", () => {
  const plan = planSync(new Map(), [{ id: "x", hash: "1" }, { id: "x", hash: "1" }]);
  assert.deepEqual(plan.create, ["x"]);
});

test("planSync resumes a partial build: only the missing / changed items are written", () => {
  const desired = ["a", "b", "c", "d"].map(id => ({ id, hash: `h-${id}` }));
  const half = new Map([["a", "h-a"], ["b", "h-b"]]);
  const plan = planSync(half, desired);
  assert.deepEqual(plan.create, ["c", "d"]);
  assert.deepEqual(plan.skip, ["a", "b"]);
});

test("planSync without prune keeps unrelated docs (subset builds)", () => {
  assert.deepEqual(planSync(new Map([["z", "h"]]), [{ id: "a", hash: "h" }], { prune: false }).remove, []);
});

test("review routing: unconvertible lines go to GM review, never invented", () => {
  const odd = FIXTURES.find(f => f.name === "Test Odd Ring");
  const c = convertItem(odd, { dnd5eMajor: 6 });
  const r = route(c.data.flags["loot-ledger"]);
  assert.equal(r.list, "review");
  assert.equal(c.result.features.length, 0, "no feature was made up for the unknown line");
  const row = reportRow(odd._id, odd.name, c.data.flags["loot-ledger"], "uuid");
  assert.equal(row.reviewLines.length, 2, "the unknown line, and a Very Rare item left with no feature");
  assert.match(row.reviewLines[0], /squirrel/);
  assert.match(row.reviewLines[1], /Very Rare item with no line that converts/);
});

test("routing of clean, replaced and kept items", () => {
  const byName = n => convertItem(FIXTURES.find(f => f.name === n), { dnd5eMajor: 6 }).data.flags["loot-ledger"];
  assert.deepEqual(route(byName("Test Longblade")), { list: "converted", review: false, replaced: false, kept: false });
  assert.deepEqual(route(byName("Test Fibbing Headdress")), { list: "replaced", review: false, replaced: true, kept: false });
  assert.deepEqual(route(byName("Test Hand-Written Blade")), { list: "converted", review: false, replaced: false, kept: true });
});

test("errorRow routes converter exceptions to review", () => {
  const r = errorRow("id", "Broken", { quality: "rare", band: 3 }, "u", "boom");
  assert.equal(r.list, "review");
  assert.match(r.reviewLines[0], /converter error: boom/);
});

test("summary counts and report pages", () => {
  const rows = FIXTURES.map(f => { const c = convertItem(f, { dnd5eMajor: 6 }); return reportRow(f._id, f.name, c.data.flags["loot-ledger"], `u.${f._id}`); });
  rows.push(errorRow("e1", "Broken", {}, "u.e1", "boom"));
  const copy = { create: ["a", "b"], replace: ["c"], skip: ["d"], remove: [] };
  const conv = { create: ["a"], replace: [], skip: ["b", "c", "d"], remove: ["z"] };
  const counts = summaryCounts({ copy, convert: conv, rows });
  assert.equal(counts.copied, 3);
  assert.equal(counts.converted, 1);
  assert.equal(counts.skipped, 4);
  assert.equal(counts.removed, 1);
  assert.equal(counts.review, 2, "odd ring + converter error");
  assert.equal(counts.errors, 1);
  assert.equal(counts.replaced, 1);
  assert.equal(counts.kept, 1);
  const html = summaryHtml(counts, { convertOn: true, tables: 165, seconds: 1.5, reportUuid: "JournalEntry.x" });
  assert.match(html, /GM review needed:<\/strong> 2/);
  assert.match(html, /@UUID\[JournalEntry\.x\]/);
  const pages = reportPages(counts, rows, { convertOn: true, replaceList: { total: 3, applied: ["A"], missing: ["B"], notHandWritten: ["C"] }, tables: 165 });
  assert.equal(pages.length, 3);
  assert.match(pages[1].name, /GM review \(2\)/);
  assert.match(pages[1].html, /squirrel/);
  assert.match(pages[2].html, /Test Fibbing Headdress/);
  assert.match(pages[0].html, /No source item found:<\/strong> B/);
  assert.equal(reportPages(counts, [], { convertOn: false }).length, 1, "conversion off: summary only");
  assert.match(summaryHtml(counts, { convertOn: false }), /off \(setting\)/);
});
