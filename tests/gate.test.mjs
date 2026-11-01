/**
 * GM-only API gating, the suffix-roll creator check and chat-card escaping (all pure; the hooks themselves need a live world).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gmOnly, gateMembers, requireGM, isGmUser, GM_NOTICE } from "../scripts/gate.mjs";
import { pickWhisperHtml } from "../scripts/suffix-hooks.mjs";

test("gmOnly: a player gets a notice and undefined and nothing runs; a GM passes through; checked at call time", () => {
  const ran = [], notes = [];
  let gm = false;
  const f = gmOnly(x => { ran.push(x); return x * 2; }, { isGM: () => gm, notify: m => notes.push(m) });
  assert.equal(f(2), undefined);
  assert.deepEqual(ran, []);
  assert.deepEqual(notes, [GM_NOTICE]);
  gm = true;
  assert.equal(f(2), 4);
  assert.equal(notes.length, 1, "a GM gets no notice");
});

test("requireGM and gateMembers", () => {
  const notes = [];
  assert.equal(requireGM({ isGM: () => false, notify: m => notes.push(m) }), false);
  assert.equal(requireGM({ isGM: () => true, notify: m => notes.push(m) }), true);
  assert.equal(notes.length, 1);
  const api = { a: () => "a", b: () => "b", n: 5, off: undefined };
  const g = gateMembers(api, ["a", "off", "missing"], { isGM: () => false, notify() { } });
  assert.equal(g.a(), undefined, "gated");
  assert.equal(g.b(), "b", "not listed: open");
  assert.equal(g.n, 5);
  assert.equal(g.off, undefined, "an absent member stays absent");
  assert.ok(!("missing" in g));
});

test("createApi: every function member is gated or deliberately open, and the gated ones refuse a player", async () => {
  globalThis.foundry = { utils: { deepClone: x => x } };
  const notes = [];
  globalThis.ui = { notifications: { warn: m => notes.push(m) } };
  globalThis.game = { user: { isGM: false }, settings: { get: () => true }, packs: { get() { throw new Error("world touched"); }, } };
  const { createApi, GM_ONLY_MEMBERS, OPEN_MEMBERS } = await import("../scripts/api.mjs");
  const api = createApi();
  const fns = Object.keys(api).filter(k => typeof api[k] === "function");
  for (const k of fns) assert.ok(GM_ONLY_MEMBERS.includes(k) !== OPEN_MEMBERS.includes(k), `${k} must be in exactly one list`);
  for (const k of [...GM_ONLY_MEMBERS, ...OPEN_MEMBERS]) assert.equal(typeof api[k], "function", `${k} is listed but missing`);
  for (const k of ["findTable", "roll", "build", "convertToPack", "auditHandWritten", "replaceList", "rollSuffix", "removeData", "reviewBoard", "setQuality"]) {
    assert.ok(GM_ONLY_MEMBERS.includes(k), `${k} gated`);
  }
  for (const k of ["convert", "rules", "suffixes", "qualityOf", "auditHandAuthored"]) assert.ok(OPEN_MEMBERS.includes(k), `${k} open`);
  for (const k of GM_ONLY_MEMBERS) {
    notes.length = 0;
    assert.equal(await api[k]({ journal: true }), undefined, `${k} refuses a player`);
    assert.deepEqual(notes, [GM_NOTICE], k);
  }
  assert.equal(typeof api.rules(), "object", "open helper still works for a player");
  assert.ok(api.suffixes().length || Object.keys(api.suffixes()).length);
  // direct export: findTable and auditHandWritten check the GM themselves (game.packs would throw if reached)
  const { findTable, auditHandWritten } = await import("../scripts/api.mjs");
  assert.equal(await findTable({}), undefined);
  assert.equal(await auditHandWritten({ journal: true }), undefined, "no journal write for a player");
});

test("suffix rolls need a GM creator (the userId hook argument)", () => {
  const users = new Map([["gm1", { id: "gm1", isGM: true }], ["p1", { id: "p1", isGM: false }]]);
  assert.equal(isGmUser("gm1", users), true);
  assert.equal(isGmUser("p1", users), false, "a player creating the item on their own actor");
  assert.equal(isGmUser("ghost", users), false);
  assert.equal(isGmUser(undefined, users), false, "no userId: no roll");
  assert.equal(isGmUser("gm1", [...users.values()]), true, "array of users works too");
  assert.equal(isGmUser("gm1", null), false);
});

test("the GM-picks whisper escapes item and actor names", () => {
  const html = pickWhisperHtml('<img src=x onerror="boom()">Ring', "A & <b>B</b>");
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("&lt;img src=x onerror=\"boom()\"&gt;Ring"));
  assert.ok(html.includes("A &amp; &lt;b&gt;B&lt;/b&gt;"));
  assert.ok(html.includes("<strong>Loot Ledger:</strong>"), "own markup stays");
});
