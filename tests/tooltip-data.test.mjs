import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tierOf, excerpt, priceCopper, formatGsc, damageOf, acOf, magicalBonusOf, slotOf, equippedInSlot, compare, buildModel, renderModel, esc
} from "../scripts/tooltip-data.mjs";

/** Small slice of CONFIG.DND5E in the shapes dnd5e 6 uses. */
const DND5E = {
  itemRarity: { common: "Common", uncommon: "Uncommon", rare: "Rare", veryRare: "Very Rare", legendary: "Legendary", artifact: "Artifact" },
  weaponTypes: { simpleM: "Simple Melee", martialM: "Martial Melee", martialR: "Martial Ranged" },
  armorTypes: { light: "Light", medium: "Medium", heavy: "Heavy", shield: "Shield" },
  equipmentTypes: { light: "Light", heavy: "Heavy", shield: "Shield", ring: "Ring", wondrous: "Wondrous Item" },
  damageTypes: { slashing: { label: "Slashing" }, fire: { label: "Fire" } },
  itemProperties: { mgc: { label: "Magical" }, ver: { label: "Versatile" }, foc: { label: "Focus" } },
  attunementTypes: { required: "Requires Attunement", optional: "Optional Attunement" },
  limitedUsePeriods: { lr: { label: "Long Rest" } },
  weightUnits: { lb: { abbreviation: "lb" } },
  currencies: { gp: { conversion: 1 }, sp: { conversion: 100 }, cp: { conversion: 10000 } }
};

const sword = (over = {}) => ({
  type: "weapon", name: "Test Blade", flags: {},
  system: {
    type: { value: "martialM" }, properties: new Set(["ver"]), magicalBonus: "",
    damage: { base: { number: 1, denomination: 8, bonus: "", types: new Set(["slashing"]) }, versatile: { number: 1, denomination: 10 } },
    price: { value: 15, denomination: "gp" }, weight: { value: 3, units: "lb" }, equipped: false, ...over
  }
});
const armor = (value, over = {}) => ({
  type: "equipment", name: `Plate ${value}`, documentName: "Item", flags: {},
  system: { type: { value: "heavy" }, armor: { value, dex: null }, properties: new Set(), equipped: false, ...over }
});

test("tierOf: Loot Ledger quality wins, then dnd5e rarity, else mundane", () => {
  assert.equal(tierOf({ flags: { "loot-ledger": { quality: "poor" } }, system: { rarity: "common" } }), "mundane");
  assert.equal(tierOf({ flags: { "loot-ledger": { quality: "epic" } }, system: {} }), "veryRare");
  assert.equal(tierOf({ system: { rarities: new Set(["rare"]) } }), "rare");
  assert.equal(tierOf({ system: { rarity: "legendary" } }), "legendary");
  assert.equal(tierOf({ system: { rarity: "" } }), "mundane");
});

test("excerpt strips html, enrichers and the sell line, and cuts at a word", () => {
  const html = `<p>A <strong>fine</strong> blade &amp; hilt. See @UUID[Compendium.x.Item.abc]{Other Blade}.</p><script>alert(1)</script><p class="loot-ledger-sell"><em>Sells for 1g</em></p>`;
  assert.equal(excerpt(html), "A fine blade & hilt. See Other Blade.");
  const long = `<p>${"word ".repeat(100)}</p>`;
  const out = excerpt(long, 50);
  assert.ok(out.length <= 51 && out.endsWith("…"));
  assert.equal(excerpt(null), "");
});

test("priceCopper and formatGsc use the world's currency conversions", () => {
  assert.deepEqual(priceCopper({ value: 1.4672, denomination: "gp" }, DND5E.currencies), { copper: 14672, step: 100 });
  assert.equal(formatGsc(14672), "1g 46s 72c");
  assert.equal(formatGsc(priceCopper({ value: 47, denomination: "sp" }, DND5E.currencies).copper), "47s");
  const std = { gp: { conversion: 1 }, sp: { conversion: 10 }, cp: { conversion: 100 } };
  const p = priceCopper({ value: 2.5, denomination: "gp" }, std);
  assert.deepEqual(p, { copper: 250, step: 10 });
  assert.equal(formatGsc(p.copper, p.step), "2g 5s");
  assert.equal(formatGsc(0), "");
});

test("damage, AC and magical bonus", () => {
  const plain = sword();
  assert.equal(damageOf(plain, DND5E).formula, "1d8");
  assert.equal(damageOf(plain, DND5E).average, 4.5);
  const magic = sword({ properties: new Set(["mgc"]), magicalBonus: "2" });
  assert.equal(magicalBonusOf(magic), 2);
  assert.equal(damageOf(magic, DND5E).formula, "1d8 + 2");
  // Bonus without the Magical property is ignored, as dnd5e does.
  assert.equal(magicalBonusOf(sword({ magicalBonus: "2" })), 0);
  // Prepared documents already include the bonus; plain data gets it added.
  assert.equal(acOf(armor(19, { properties: new Set(["mgc"]), armor: { value: 19, magicalBonus: "1" } })), 19);
  const raw = { ...armor(18, { properties: new Set(["mgc"]), armor: { value: 18, magicalBonus: "1" } }), documentName: undefined };
  assert.equal(acOf(raw), 19);
  assert.equal(acOf(sword()), null);
});

test("slots and equipped lookup", () => {
  assert.equal(slotOf(sword()), "weapon-melee");
  assert.equal(slotOf(sword({ type: { value: "martialR" } })), "weapon-ranged");
  assert.equal(slotOf(armor(16)), "armor");
  assert.equal(slotOf({ type: "equipment", system: { type: { value: "wondrous" } }, flags: {} }), null);
  assert.equal(slotOf({ type: "equipment", system: { type: { value: "wondrous" } }, flags: { "loot-ledger": { slot: "Neck" } } }), "ll:neck");
  const worn = armor(16, { equipped: true });
  const spare = armor(14);
  const hovered = armor(18);
  assert.equal(equippedInSlot(hovered, [spare, worn, sword({ equipped: true })]), worn);
  assert.equal(equippedInSlot(worn, [worn]), null);
});

test("compare gives signed deltas", () => {
  const rows = compare(armor(18), armor(16));
  assert.deepEqual(rows.map(r => [r.key, r.delta]), [["ac", 2]]);
  const w = compare(sword(), sword({ properties: new Set(["mgc"]), magicalBonus: "1" }));
  assert.deepEqual(w.map(r => [r.key, r.delta]), [["bonus", -1], ["damage", -1]]);
});

test("buildModel and renderModel: full weapon", () => {
  const item = sword({ properties: new Set(["mgc", "ver"]), magicalBonus: "1", attunement: "required", rarities: new Set(["rare"]),
    uses: { max: "3", spent: 1, recovery: [{ period: "lr" }] },
    description: { value: "<p>Old & <em>sharp</em>.</p>" } });
  item.flags = { "loot-ledger": { vendorSell: "7s 50c", coinRatio: "100" } };
  const m = buildModel(item, { dnd5e: DND5E, equipped: sword({ equipped: true }) });
  assert.equal(m.tier, "rare");
  assert.equal(m.type.left, "Martial Melee");
  assert.equal(m.stats[0].text, "1d8 + 1 Slashing");
  assert.ok(m.properties[0] === "Magical" && m.properties.includes("Versatile"));
  assert.ok(m.lines.some(l => l.text === "Requires Attunement"));
  assert.ok(m.lines.some(l => l.text.endsWith("2/3 (Long Rest)")));
  assert.equal(m.price, "15g");
  assert.equal(m.sell, "7s 50c");
  assert.equal(m.weight, "3 lb");
  assert.equal(m.description, "Old & sharp.");
  assert.deepEqual(m.compare.map(c => [c.key, c.delta]), [["bonus", 1], ["damage", 1]]);
  const html = renderModel(m);
  assert.match(html, /ll-tier-rare/);
  assert.match(html, /Old &amp; sharp\./);
  assert.match(html, /ll-cmp-up/);
});

test("unidentified items hide details from players, not from the GM", () => {
  const item = sword({ identified: false, unidentified: { name: "Strange Blade", description: "<p>Odd.</p>" }, rarities: new Set(["legendary"]) });
  const player = buildModel(item, { dnd5e: DND5E });
  assert.equal(player.name, "Strange Blade");
  assert.equal(player.tier, "mundane");
  assert.equal(player.stats.length, 0);
  assert.equal(player.description, "Odd.");
  const gm = buildModel(item, { dnd5e: DND5E, isGM: true });
  assert.equal(gm.name, "Test Blade");
  assert.equal(gm.tier, "legendary");
});

test("renderModel escapes item text", () => {
  const item = { type: "loot", name: `<img src=x onerror="alert(1)">`, flags: {}, system: { description: { value: "&lt;b&gt;x" } } };
  const html = renderModel(buildModel(item, { dnd5e: DND5E }));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<b>"));
  assert.equal(esc(`a"b'`), "a&quot;b&#39;");
});
