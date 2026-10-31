/** Quality colours: resolution (explicit flag, rarity fallback for dnd5e 5 and 6 shapes), classes, flag updates. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Q from "../scripts/quality-model.mjs";
import { QUALITIES } from "../scripts/data.mjs";

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
  assert.equal(Q.qualityClass("rare"), "ll-q ll-q-rare");
  assert.equal(Q.qualityClass(null), "");
  assert.ok(Q.ALL_CLASSES.includes("ll-q-heirloom") && Q.ALL_CLASSES.includes("ll-q"));
  assert.deepEqual(Q.qualityUpdate("Blue"), { "flags.loot-ledger.quality": "rare" });
  assert.deepEqual(Q.qualityUpdate(null), { "flags.loot-ledger.-=quality": null });
  assert.deepEqual(Q.qualityUpdate("auto"), { "flags.loot-ledger.-=quality": null });
  assert.throws(() => Q.qualityUpdate("mythic"), /unknown quality/);
});
