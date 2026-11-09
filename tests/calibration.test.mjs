/**
 * Book-day tooling: tools/calibration-report.mjs and the hand-written audit helper (ledger.mjs handWrittenAudit).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { toSource, rulesRows, conversionRows, DEFAULT_ITEMS } from "../tools/calibration-report.mjs";
import { handWrittenAudit, replaceListSnippet, auditPageHtml } from "../scripts/ledger.mjs";
import { auditHandAuthored, parseSource, convertItem } from "../scripts/convert.mjs";
import * as R from "../scripts/rules.mjs";
import { REPLACE_LIST } from "../scripts/replace-list.mjs";
import { FIXTURES, srcItem } from "./_fixtures.mjs";

const SAMPLES = JSON.parse(readFileSync(DEFAULT_ITEMS, "utf8"));
const TOOL = fileURLToPath(new URL("../tools/calibration-report.mjs", import.meta.url));

test("sample fixture: ~40 items across qualities, shapes and line kinds, all made up", () => {
  assert.ok(SAMPLES.length >= 38 && SAMPLES.length <= 50, `${SAMPLES.length} items`);
  for (const e of SAMPLES) assert.match(e.name, /^Sample /, "sample names are made up and marked");
  const q = new Set(SAMPLES.map(e => e.quality));
  for (const k of ["poor", "common", "uncommon", "rare", "epic", "legendary"]) assert.ok(q.has(k), k);
  const rows = conversionRows(SAMPLES);
  const shapes = new Set(rows.map(r => r.shape));
  for (const s of ["weapon", "chest", "gear", "shield", "wand", "consumable", "loot"]) assert.ok(shapes.has(s), s);
  assert.ok(rows.every(r => !String(r.review).startsWith("ERROR")), "every sample converts");
  assert.ok(rows.some(r => r.review === "REVIEW"), "some sample lands on GM review");
  assert.ok(rows.some(r => /^kept/.test(r.hand)) && rows.some(r => /^replaced/.test(r.hand)), "one kept, one replaced hand-written item");
});

test("compact samples convert exactly like the test fixtures' source shape", () => {
  const e = { name: "Test Longblade", quality: "rare", type: "weapon", sell: 1234, lines: ["Binds when picked up", "One-Hand", "Sword", "40 - 75 Damage", "Speed 2.60", "+8 Strength", "+5 Stamina", "Item Level 40", "Requires Level 35"] };
  const a = convertItem(toSource(e), { dnd5eMajor: 6 }).result;
  const b = convertItem(FIXTURES.find(f => f.name === "Test Longblade"), { dnd5eMajor: 6 }).result;
  assert.deepEqual(a, b);
  const full = FIXTURES[0];
  assert.equal(toSource(full), full, "full source documents pass through");
});

test("rules table lists every export of rules.mjs", () => {
  const names = new Set(rulesRows().map(r => r.name));
  for (const k of Object.keys(R)) assert.ok(names.has(k), k);
});

test("CLI runs: rules, items, json", () => {
  const out = execFileSync(process.execPath, [TOOL], { encoding: "utf8" });
  assert.match(out, /CONVERTER_VERSION|converter version/);
  assert.match(out, /Sample conversions/);
  assert.match(out, /GEAR_BONUS/);
  const json = JSON.parse(execFileSync(process.execPath, [TOOL, "--json"], { encoding: "utf8" }));
  assert.equal(json.length, SAMPLES.length);
  assert.ok(json[0].features && "rarity" in json[0]);
});

test("hand-written audit: lists hand-written items, flags failures, marks the replace list", () => {
  const listedFail = srcItem({ name: "Band of Sulfuras", quality: "epic", wowId: 1111,
    pre: "<p><strong>Ember.</strong> You have Resistance to Cold damage.</p>", lines: ["Finger", "Item Level 60"] });
  const docs = [...FIXTURES, listedFail];
  const res = handWrittenAudit(docs, REPLACE_LIST, d => auditHandAuthored(parseSource(d)));
  assert.equal(res.handWritten, 3, "only items flagged handAuthored");
  assert.deepEqual(res.failing.map(r => r.name), ["Band of Sulfuras", "Test Fibbing Headdress"]);
  assert.deepEqual(res.passing.map(r => r.name), ["Test Hand-Written Blade"]);
  assert.equal(res.listed, 1);
  assert.deepEqual(res.unlisted.map(r => r.name), ["Test Fibbing Headdress"]);
  assert.ok(res.failing[1].problems.some(p => p.startsWith("resistance:")));
  assert.equal(res.failing[0].itemId, 1111);

  const snippet = replaceListSnippet(res.unlisted);
  assert.match(snippet, /^ {2}\{ name: "Test Fibbing Headdress", note: "no backing tooltip line for: [a-z-, ]+" \},$/);
  // The snippet is valid replace-list data (identifiers and a short note only).
  const parsed = Function(`return [${snippet}]`)();
  assert.deepEqual(Object.keys(parsed[0]).sort(), ["name", "note"]);
  assert.match(replaceListSnippet([{ name: "X", itemId: 42, problems: [] }]), /itemId: 42/);

  const html = auditPageHtml(res, { expected: 47 });
  assert.match(html, /3 hand-written conversions/);
  assert.match(html, /review total: 47/);
  assert.ok(!html.includes("<script"));
});
