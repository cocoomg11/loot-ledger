import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tierOf, qualityOf, ratioOf, excerpt, priceCopper, formatPrice, damageOf, acOf, magicalBonusOf, slotOf, equippedInSlot, compare, buildModel, renderModel, esc, worldStep
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

test("priceCopper and formatPrice use the world's conversions and core formatCoins with the coin ratio", () => {
  assert.deepEqual(priceCopper({ value: 1.4672, denomination: "gp" }, DND5E.currencies), { copper: 14672, step: 100 });
  assert.equal(formatPrice(14672), "1g 46s 72c");
  assert.equal(formatPrice(priceCopper({ value: 47, denomination: "sp" }, DND5E.currencies).copper), "47s");
  const std = { gp: { conversion: 1 }, sp: { conversion: 10 }, cp: { conversion: 100 } };
  const p = priceCopper({ value: 2.5, denomination: "gp" }, std, "10");
  assert.deepEqual(p, { copper: 250, step: 10 });
  assert.equal(formatPrice(p.copper, p.step), "2g 5s");
  // No conversions in the world: the ratio's own.
  assert.deepEqual(priceCopper({ value: 3, denomination: "sp" }, undefined, "10"), { copper: 30, step: 10 });
  assert.deepEqual(priceCopper({ value: 3, denomination: "sp" }, undefined), { copper: 300, step: 100 });
  assert.equal(formatPrice(0), "");
  assert.equal(formatPrice(-5), "");
  assert.equal(ratioOf("10"), 10);
  assert.equal(ratioOf("100"), 100);
  assert.equal(ratioOf("bogus"), 100);
});

test("qualityOf: Loot Ledger quality key, else core quality() of the dnd5e rarity", () => {
  assert.equal(qualityOf({ flags: { "loot-ledger": { quality: "poor" } }, system: { rarity: "rare" } }), "poor");
  assert.equal(qualityOf({ flags: { "loot-ledger": { quality: "epic" } }, system: {} }), "epic");
  assert.equal(qualityOf({ system: { rarity: "veryRare" } }), "epic");
  assert.equal(qualityOf({ system: { rarities: new Set(["legendary"]) } }), "legendary");
  assert.equal(qualityOf({ system: {} }), "poor");
  assert.equal(qualityOf({ flags: { "loot-ledger": { quality: "nonsense" } }, system: { rarity: "uncommon" } }), "uncommon");
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
  assert.equal(slotOf(armor(16)), "body");
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
  assert.equal(m.quality, "rare");
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
  assert.match(html, /class="ll-tt-name wc-q-text wc-q-rare" data-quality="rare"/);
  assert.ok(!html.includes("ll-tier-"));
  assert.match(html, /Old &amp; sharp\./);
  assert.match(html, /ll-cmp-up/);
});

test("unidentified items hide details from players, not from the GM", () => {
  const item = sword({ identified: false, unidentified: { name: "Strange Blade", description: "<p>Odd.</p>" }, rarities: new Set(["legendary"]) });
  const player = buildModel(item, { dnd5e: DND5E });
  assert.equal(player.name, "Strange Blade");
  assert.equal(player.tier, "mundane");
  assert.equal(player.quality, "poor");
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

test("priceCopper follows the world's conversions, whatever the coinRatio setting says", () => {
  const std = { gp: { conversion: 1 }, sp: { conversion: 10 }, cp: { conversion: 100 } };
  const wide = { gp: { conversion: 1 }, sp: { conversion: 100 }, cp: { conversion: 10000 } };
  const show = (price, cfg, setting) => { const p = priceCopper(price, cfg, setting); return formatPrice(p.copper, p.step); };
  for (const setting of ["10", "100"]) {
    // 100:1 world (three-coin system), setting at either value
    assert.equal(show({ value: 2, denomination: "sp" }, wide, setting), "2s", `2 sp, wide, ${setting}`);
    assert.equal(show({ value: 1, denomination: "cp" }, wide, setting), "1c", `1 cp, wide, ${setting}`);
    assert.equal(show({ value: 15, denomination: "sp" }, wide, setting), "15s", `15 sp, wide, ${setting}`);
    assert.equal(show({ value: 123, denomination: "cp" }, wide, setting), "1s 23c", `123 cp, wide, ${setting}`);
    assert.equal(show({ value: 1.4672, denomination: "gp" }, wide, setting), "1g 46s 72c");
    // 10:1 world (standard 5e), setting at either value
    assert.equal(show({ value: 2, denomination: "sp" }, std, setting), "2s", `2 sp, std, ${setting}`);
    assert.equal(show({ value: 1, denomination: "cp" }, std, setting), "1c", `1 cp, std, ${setting}`);
    assert.equal(show({ value: 15, denomination: "sp" }, std, setting), "1g 5s", `15 sp, std, ${setting}`);
    assert.equal(show({ value: 123, denomination: "cp" }, std, setting), "1g 2s 3c", `123 cp, std, ${setting}`);
  }
  // the reported repro
  assert.deepEqual(priceCopper({ value: 2, denomination: "sp" }, wide, "10"), { copper: 200, step: 100 });
  // no usable conversions: the setting decides
  assert.deepEqual(priceCopper({ value: 2, denomination: "sp" }, {}, "10"), { copper: 20, step: 10 });
  assert.deepEqual(priceCopper({ value: 2, denomination: "sp" }, { sp: { conversion: 7 } }, "100"), { copper: 200, step: 100 });
  assert.equal(worldStep(wide), 100);
  assert.equal(worldStep(std), 10);
  assert.equal(worldStep({ sp: { conversion: 10 }, cp: { conversion: 10000 } }), null);
  assert.equal(worldStep(undefined), null);
});

test("buildModel price follows the world's conversions over the setting and the item flag", () => {
  const wide = { gp: { conversion: 1 }, sp: { conversion: 100 }, cp: { conversion: 10000 } };
  const item = { type: "loot", name: "X", system: { price: { value: 15, denomination: "sp" } }, flags: { "loot-ledger": { coinRatio: "10" } } };
  assert.equal(buildModel(item, { dnd5e: { currencies: wide }, ratio: "10" }).price, "15s");
  assert.equal(buildModel(item, { dnd5e: {}, ratio: "10" }).price, "1g 5s");
});

import { stripSellPrice } from "../scripts/tooltip-data.mjs";
import { shouldShowHint } from "../scripts/hint-model.mjs";

test("description drops a trailing source sell-price line but keeps other text", () => {
  assert.equal(excerpt("<div>Thick and warm.</div><div>Sell Price: 1s</div>"), "Thick and warm.");
  assert.equal(excerpt("<p>Soft.</p><p>Sell Price: <span>1</span> <span>g</span> <span>46</span> s 72c</p>"), "Soft.");
  assert.equal(excerpt(`<p>Soft.</p><p>Sell Price: 5g</p><p class="loot-ledger-sell"><em>Sells for 5g</em></p>`), "Soft.");
  assert.equal(excerpt("<p>Sell Price: 1s</p>"), "");
  assert.equal(stripSellPrice("Sell Price: 2 Silver 5 Copper"), "");
  // Not at the end, or followed by more text: left alone.
  assert.equal(stripSellPrice("Sell Price: 1s Use: heals."), "Sell Price: 1s Use: heals.");
  assert.equal(stripSellPrice("Worth the Sell Price of nothing"), "Worth the Sell Price of nothing");
  const m = buildModel({ ...sword(), system: { ...sword().system, description: { value: "<p>Sharp.</p><p>Sell Price: 1s</p>" } },
    flags: { "loot-ledger": { vendorSell: "1s" } } }, { dnd5e: DND5E });
  assert.equal(m.description, "Sharp.");
  assert.equal(m.sell, "1s");
  assert.ok(m.price);
});

const piece = (type, slot, over = {}) => ({
  type: "equipment", name: `${type}-${slot ?? "none"}`, documentName: "Item",
  flags: slot ? { "loot-ledger": { slot } } : {},
  system: { type: { value: type }, armor: {}, properties: new Set(), equipped: false, ...over }
});

test("chest armour, clothes and flagged chest pieces share the body slot", () => {
  const vest = piece("clothing", "Chest");
  for (const worn of [piece("light", null), piece("medium", null), piece("heavy", null), piece("natural", null), piece("clothing", null), piece("light", "Chest"), piece("clothing", "Chest")]) {
    assert.equal(slotOf(worn), "body");
    assert.equal(equippedInSlot(vest, [{ ...worn, system: { ...worn.system, equipped: true } }])?.name, worn.name);
  }
  assert.equal(slotOf(piece("heavy", "Chest")), "body");
  assert.equal(slotOf(piece("wondrous", "Chest")), "body");
});

test("other slots stay apart and match through their flag or type", () => {
  assert.equal(slotOf(piece("clothing", "Head")), "ll:head");
  assert.notEqual(slotOf(piece("clothing", "Head")), slotOf(piece("clothing", null)));
  assert.equal(slotOf(piece("clothing", "Legs")), "ll:legs");
  assert.equal(slotOf(piece("trinket", "Finger")), "ring");
  assert.equal(slotOf(piece("ring", null)), "ring");
  assert.equal(slotOf(piece("ring", "Finger")), "ring");
  assert.equal(slotOf(piece("shield", "Off Hand")), "shield");
  assert.equal(slotOf(piece("wondrous", null)), null);
  assert.equal(slotOf(piece("trinket", "Trinket")), "ll:trinket");
});

test("a vest compares with equipped leather armour", () => {
  const leather = piece("light", null, { armor: { value: 11, dex: null }, equipped: true });
  const vest = piece("clothing", "Chest");
  const m = buildModel(vest, { dnd5e: DND5E, equipped: equippedInSlot(vest, [leather]) });
  assert.deepEqual(m.compare.map(c => [c.key, c.delta]), [["ac", -11]]);
});

test("price and sells-for are hidden on unidentified items for players, shown to the GM", () => {
  const item = { ...sword(), flags: { "loot-ledger": { vendorSell: "1s" } } };
  item.system = { ...item.system, identified: false, unidentified: { name: "Strange Blade" } };
  const player = buildModel(item, { dnd5e: DND5E });
  assert.equal(player.price, "");
  assert.equal(player.sell, "");
  assert.equal(player.name, "Strange Blade");
  const gm = buildModel(item, { dnd5e: DND5E, isGM: true });
  assert.equal(gm.price, "15g");
  assert.equal(gm.sell, "1s");
  const known = buildModel({ ...item, system: { ...item.system, identified: true } }, { dnd5e: DND5E });
  assert.equal(known.price, "15g");
});

test("tooltip hint shows once, only with the world setting on and the tooltip off", () => {
  assert.equal(shouldShowHint({ worldOn: true, tooltipOn: false, seen: false }), true);
  assert.equal(shouldShowHint({ worldOn: false, tooltipOn: false, seen: false }), false);
  assert.equal(shouldShowHint({ worldOn: true, tooltipOn: true, seen: false }), false);
  assert.equal(shouldShowHint({ worldOn: true, tooltipOn: false, seen: true }), false);
  assert.equal(shouldShowHint(), false);
});
