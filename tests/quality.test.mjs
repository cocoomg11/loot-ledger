/** Quality colours: resolution (explicit flag, rarity fallback for dnd5e 5 and 6 shapes), classes, flag updates. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Q from "../scripts/quality-model.mjs";
import { readFileSync } from "node:fs";
import { QUALITIES } from "../scripts/data.mjs";
import { QUALITY_KEYS, UI_CLASSES } from "../vendor/wanderers-core/index.mjs";

test("every quality Build stores has a colour class", () => {
  for (const q of QUALITIES) assert.equal(Q.normalizeQuality(q.key), q.key);
});

test("normalizeQuality accepts colour names and rejects junk", () => {
  assert.equal(Q.normalizeQuality("Purple"), "epic");
  assert.equal(Q.normalizeQuality("grey"), "poor");
  assert.equal(Q.normalizeQuality("gray"), "poor");
  assert.equal(Q.normalizeQuality("veryRare"), "epic");
  assert.equal(Q.normalizeQuality("heirloom"), "heirloom");
  assert.equal(Q.normalizeQuality(""), null);
  assert.equal(Q.normalizeQuality("none"), null);
  assert.equal(Q.normalizeQuality("mythic"), null);
  assert.equal(Q.normalizeQuality(undefined), null);
});

test("rarity fallback: dnd5e 5 (system.rarity) and dnd5e 6 (system.rarities) shapes", () => {
  const map = { common: "common", uncommon: "uncommon", rare: "rare", veryRare: "epic", legendary: "legendary", artifact: "artifact" };
  for (const [r, q] of Object.entries(map)) {
    assert.equal(Q.resolveQuality({ system: { rarity: r } }), q, `rarity ${r}`);
    assert.equal(Q.resolveQuality({ system: { rarities: [r] } }), q, `rarities [${r}]`);
    assert.equal(Q.resolveQuality({ system: { rarities: new Set([r]) } }), q, `rarities Set(${r})`);
  }
  assert.equal(Q.resolveQuality({ system: { rarity: "" } }), null, "mundane item: no colour");
  assert.equal(Q.resolveQuality({ system: {} }), null);
  assert.equal(Q.resolveQuality(null), null);
});

test("explicit quality always wins; fallback can be turned off", () => {
  const item = { system: { rarity: "legendary" }, flags: { "loot-ledger": { quality: "poor" } } };
  assert.equal(Q.resolveQuality(item), "poor");
  assert.equal(Q.resolveQuality(item, { rarityFallback: false }), "poor");
  assert.equal(Q.resolveQuality({ system: { rarity: "rare" } }, { rarityFallback: false }), null);
  assert.equal(Q.resolveQuality({ system: { rarity: "rare" }, flags: { "loot-ledger": { quality: "nonsense" } } }), "rare", "unknown flag falls back");
  // a compendium index entry with only the indexed fields
  assert.equal(Q.resolveQuality({ _id: "x", name: "y", flags: { "loot-ledger": { quality: "uncommon" } } }), "uncommon");
});

test("qualityClass and qualityUpdate", () => {
  assert.equal(Q.qualityClass("rare"), ["ll-q", "ll-q-rare", ...UI_CLASSES].join(" "));
  assert.equal(Q.qualityClass("Light Blue"), ["ll-q", "ll-q-heirloom", ...UI_CLASSES].join(" "));
  assert.equal(Q.qualityClass(null), "");
  assert.equal(Q.qualityClass("mythic"), "");
  assert.ok(Q.ALL_CLASSES.includes("ll-q-heirloom") && Q.ALL_CLASSES.includes("ll-q"));
  assert.deepEqual(Q.qualityUpdate("Blue"), { "flags.loot-ledger.quality": "rare" });
  assert.deepEqual(Q.qualityUpdate(null), { "flags.loot-ledger.-=quality": null });
  assert.deepEqual(Q.qualityUpdate("auto"), { "flags.loot-ledger.-=quality": null });
  assert.throws(() => Q.qualityUpdate("mythic"), /unknown quality/);
});

/* ---------------- one quality source: the normaliser over core ---------------- */

test("normaliser: core's seven keys plus heirloom, in core's order", () => {
  assert.deepEqual(Q.COLOUR_QUALITIES.map(q => q.key), [...QUALITY_KEYS, "heirloom"]);
  assert.deepEqual(Q.EXTRA_QUALITIES, ["heirloom"]);
  for (const k of QUALITY_KEYS) assert.equal(Q.normalizeQuality(k), k);
});

test("normaliser: aliases (colour words, rarity spellings, case and punctuation)", () => {
  const cases = {
    Grey: "poor", GRAY: "poor", junk: "poor", trash: "poor", white: "common", normal: "common", Green: "uncommon",
    blue: "rare", purple: "epic", "Very Rare": "epic", very_rare: "epic", "very-rare": "epic", veryRare: "epic",
    orange: "legendary", gold: "artifact", golden: "artifact", " Legendary ": "legendary", Artifact: "artifact"
  };
  for (const [input, key] of Object.entries(cases)) assert.equal(Q.normalizeQuality(input), key, input);
});

test("normaliser: heirloom and its aliases", () => {
  for (const s of ["heirloom", "Heirloom", "light blue", "Light-Blue", "lightblue", "account"]) assert.equal(Q.normalizeQuality(s), "heirloom", s);
  assert.equal(Q.resolveQuality({ flags: { "loot-ledger": { quality: "heirloom" } }, system: { rarity: "rare" } }), "heirloom");
  assert.deepEqual(Q.qualityUpdate("light blue"), { "flags.loot-ledger.quality": "heirloom" });
});

test("normaliser: no rarity means no colour (where core's quality() would say poor)", () => {
  for (const s of [null, undefined, "", "   ", "none", "None", "auto", "mundane", "Mundane"]) assert.equal(Q.normalizeQuality(s), null, String(s));
  assert.equal(Q.resolveQuality({ system: { rarity: "mundane" } }), null);
  assert.equal(Q.resolveQuality({ system: { rarities: [] } }), null);
  assert.equal(Q.resolveQuality({ flags: { "loot-ledger": { quality: "" } }, system: {} }), null);
});

test("normaliser: unknown values are null, never core's 'common' default, and never throw", () => {
  for (const s of ["mythic", "rare-ish", "123", "<b>", {}, 7, true]) assert.equal(Q.normalizeQuality(s), null, String(s));
  assert.equal(Q.resolveQuality({ system: { rarity: "homebrew" } }), null);
  assert.equal(Q.resolveQuality({ flags: { "loot-ledger": { quality: "mythic" } }, system: { rarity: "rare" } }), "rare");
});

test("syncTheme: copies a window's theme, ignores the body, undoes only its own class", () => {
  const node = (cls, parent = null, tagName = "DIV") => {
    const set = new Set(cls);
    const n = {
      tagName, parentElement: parent, dataset: {},
      classList: { add: c => set.add(c), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) },
      closest: sel => {
        const wanted = sel.split(",").map(x => x.trim().slice(1));
        for (let e = n; e; e = e.parentElement) if (wanted.some(w => e.classList.contains(w))) return e;
        return null;
      },
      has: c => set.has(c)
    };
    return n;
  };
  const body = node(["theme-dark"], null, "BODY");
  const win = node(["themed", "theme-light"], body);
  const name = node(["ll-q", "ll-q-rare"], win);
  Q.syncTheme(name);
  assert.ok(name.has("theme-light"));
  win.classList.remove("theme-light"); win.classList.add("theme-dark");
  Q.syncTheme(name);
  assert.ok(name.has("theme-dark") && !name.has("theme-light"));
  const plain = node(["ll-q", "ll-q-epic"], node([], body));
  Q.syncTheme(plain);
  assert.ok(!plain.has("theme-dark"), "body theme is left to core's body.theme-* rules");
  const own = node(["ll-q", "theme-light"], win);
  Q.syncTheme(own);
  Q.syncTheme(own);
  assert.ok(own.has("theme-light") && own.has("theme-dark"));
  own.classList.remove("ll-q");
  Q.syncTheme(own);
  assert.ok(own.has("theme-light") && !own.has("theme-dark"), "unpainted: our class removed, the element's own kept");
});

test("one colour system: module CSS has no hex colour tokens of its own, every tier reads core's tokens", () => {
  const css = readFileSync(new URL("../styles/loot-ledger.css", import.meta.url), "utf8");
  assert.ok(!/--ll-q-/.test(css), "no --ll-q-* tokens");
  for (const q of Q.COLOUR_QUALITIES) assert.match(css, new RegExp(`\\.ll-q\\.ll-q-${q.key} \\{ color: var\\(--wc-q-${q.key}\\)`), q.key);
  assert.ok(!/wc-r\d/.test(css), "no literal stylesheet revision");
  for (const f of ["quality.mjs", "quality-model.mjs", "review.mjs"]) {
    const src = readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");
    assert.ok(!/wc-r\d/.test(src), `${f}: no literal stylesheet revision`);
    assert.ok(!/class="ll-q /.test(src), `${f}: quality classes come from qualityClass()`);
  }
});
