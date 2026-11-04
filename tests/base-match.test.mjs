/**
 * Official-base matcher (scripts/base-match.mjs) and its wiring into the converter. Every base below is a made-up
 * fixture with a few Active Effect keys or one generic sentence; no official rules text. Rules that name an
 * official item (VARIANT_BASES) are exercised by reading the name from the table at runtime.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../scripts/base-match.mjs";
import { OFFICIAL_BASES, VARIANT_BASES } from "../scripts/rules.mjs";
import { convertItem, parseSource, classify, applyOfficial, bookItem, CONVERTER_VERSION, ROUTES } from "../scripts/convert.mjs";
import { srcItem } from "./_fixtures.mjs";

const ae = (...changes) => [{ name: "fx", transfer: true, changes: changes.map(([key, value]) => ({ key, mode: 2, value: String(value) })) }];
const entry = (id, name, o = {}) => ({
  _id: id, name, type: o.type ?? "equipment",
  system: { rarities: [o.rarity ?? "rare"], type: { value: o.t ?? "trinket", baseItem: o.family ?? "" }, attunement: o.attune ? "required" : "",
    source: { rules: o.rules ?? "2024" }, description: { value: o.text ?? "" } },
  effects: o.effects ?? [], _stats: { modifiedTime: o.mod ?? 1 }
});
const vb = kind => VARIANT_BASES.filter(r => r.kind === kind);
const item = (src, extra = {}) => {
  const p = parseSource(src);
  return { p, shape: classify(p), tier: { uncommon: 1, rare: 2, epic: 3, legendary: 4 }[p.quality] ?? 0, bonus: 0, riders: [], extras: {}, ...extra };
};

const FIXTURE_BASES = [
  entry("b1", "Fixture Ring of Warding", { t: "ring", rarity: "rare", attune: true, effects: ae(["system.traits.dr.value", "fire"]) }),
  entry("b2", "Fixture Ember Sword", { type: "weapon", t: "martialM", family: "longsword", rarity: "rare",
    text: "<p>While lit, the blade deals an extra 2d6 fire damage to any target it hits.</p>" }),
  entry("b3", "Fixture Wise Cap", { t: "clothing", rarity: "uncommon", effects: ae(["system.abilities.wis.bonuses.save", "+ 1"]) }),
  entry("b4", "Fixture Lucky Stone", { rarity: "uncommon", effects: ae(["system.bonuses.abilities.save", "+ 1"], ["system.bonuses.abilities.check", "+ 1"]) })
];
const fixtureIndex = () => M.indexBases([{ pack: "test.bases", entries: FIXTURE_BASES }]);

test("base signals: tags from Active Effect keys and a keyword pass; no text kept", () => {
  const ring = M.baseSignals(FIXTURE_BASES[0]);
  assert.ok(ring.tags.has("resist:fire"));
  const sword = M.baseSignals(FIXTURE_BASES[1]);
  assert.deepEqual(sword.damage, [{ type: "fire", avg: 7, freq: "always" }]);
  const crit = M.baseSignals(entry("c", "Fixture Crit Axe", { type: "weapon", text: "On a Critical Hit the target takes an extra 1d6 cold damage." }));
  assert.equal(crit.damage[0].freq, "crit");
  const score = M.baseSignals(entry("s", "Fixture Belt", { effects: ae(["system.abilities.str.value", 21]) }));
  assert.ok(score.tags.has("score:str")); assert.equal(score.scores.str, 21);
  const idx = fixtureIndex();
  assert.ok(!JSON.stringify(idx.entries, (k, v) => v instanceof Set ? [...v] : v).includes("While lit"), "rules text is not stored in the index");
  assert.equal(M.entrySlot(FIXTURE_BASES[0]), "Finger");
  assert.equal(M.entrySlot(entry("x", "Fixture Cloak of Fog", { t: "clothing" })), "Back");
  assert.equal(M.entryRarity({ system: { rarity: "veryRare" } }), 3);
});

test("index: priority order wins duplicates, 2024 first within a pack, exclusions, cursed skipped, fingerprint by modifiedTime", () => {
  const a = entry("a1", "Fixture Twin", { rarity: "uncommon" }), b = entry("b1", "Fixture Twin", { rarity: "rare" });
  const old = entry("o1", "Fixture Old", { rules: "2014" }), neu = entry("n1", "Fixture Old", { rules: "2024" });
  const cursed = entry("c1", "Fixture Bad Ring", { text: "This ring is cursed." });
  const idx = M.indexBases([{ pack: "first", entries: [a, old, neu, cursed] }, { pack: "second", entries: [b] }], { exclude: ["Fixture Banned"] });
  assert.equal(idx.byName.get("fixture twin").pack, "first");
  assert.equal(idx.byName.get("fixture old").id, "n1", "2024 version preferred");
  assert.equal(idx.byName.get("fixture bad ring"), undefined);
  assert.equal(M.indexBases([{ pack: "p", entries: [entry("z", "Fixture Banned")] }], { exclude: ["Fixture Banned"] }).entries.length, 0);
  const again = M.indexBases([{ pack: "first", entries: [{ ...a, _stats: { modifiedTime: 2 } }, old, neu, cursed] }, { pack: "second", entries: [b] }]);
  assert.notEqual(again.fingerprint, idx.fingerprint, "a base edit changes the fingerprint");
  assert.ok(OFFICIAL_BASES.exclude.length > 0);
});

test("needs: main stat needed, secondary not; full vs small resistance; proc frequency by ratio", () => {
  const n = M.itemNeeds(item(srcItem({ name: "Test Ember Band", quality: "epic", lines: ["Finger", "+25 Fire Resistance", "+5 Frost Resistance", "+12 Stamina", "+4 Spirit", "Item Level 60"] })));
  const by = k => n.find(x => x.key === k);
  assert.equal(by("stat:con").needed, true); assert.equal(by("stat:wis").needed, false);
  assert.equal(by("resist:fire").needed, true); assert.equal(by("resist:cold").small, true);
  const w = M.itemNeeds(item(srcItem({ name: "Test Coal Blade", quality: "rare", type: "weapon", lines: ["One-Hand", "Sword", "40 - 75 Damage", "Speed 2.60", "Chance on hit: Burns the target for 20 Fire damage.", "Item Level 40"] }), { bonus: 1 }));
  assert.equal(w.find(x => x.key === "plus").needed, true);
  assert.equal(w.find(x => x.key === "damage:fire").freq, "crit", "20 vs ~57 average is below the crit threshold");
  assert.equal(M.lineNeed({ text: "Restores 4 mana per 5 sec." }), "slotRecovery");
  assert.equal(M.lineNeed({ text: "Increased Defense +7." }), "ac");
});

test("candidates: same slot, rarity never above the item, weapon family must match", () => {
  const idx = fixtureIndex();
  const ring = item(srcItem({ name: "Test Band", quality: "rare", lines: ["Finger", "+25 Fire Resistance", "Item Level 50"] }));
  assert.deepEqual(M.candidates(ring, idx).map(e => e.id), ["b1"]);
  assert.deepEqual(M.candidates({ ...ring, tier: 1 }, idx), [], "a Rare base never goes on an Uncommon item");
  const sword = item(srcItem({ name: "Test Sword", quality: "rare", type: "weapon", lines: ["One-Hand", "Sword", "40 - 75 Damage", "Speed 2.60", "Item Level 40"] }), { extras: { base: "longsword" } });
  assert.deepEqual(M.candidates(sword, idx).map(e => e.id), ["b2"]);
  assert.deepEqual(M.candidates({ ...sword, extras: { base: "greataxe" } }, idx), []);
});

test("score and confidence follow the formula; decide thresholds; settings parsing", () => {
  const S = OFFICIAL_BASES.score, P = OFFICIAL_BASES.penalty, W = OFFICIAL_BASES.weights;
  const needs = [{ key: "resist:fire", tags: ["resist:fire"], weight: W.resist, needed: true }, { key: "stat:con", tags: ["stat:con"], weight: W.mainStat, needed: true }];
  const base = { tags: new Set(["resist:fire", "ac"]), rarity: 1, priority: 1 };
  const r = M.scoreBase(needs, base, { tier: 3 });
  const expScore = W.resist - S.gap * W.mainStat - S.excess * 1 - S.rarityStep * 2 - S.sourcePriority * 1;
  const expConf = W.resist / (W.resist + W.mainStat + P.excessShare * 1) * P.unfilledNeeded * P.farBelow;
  assert.equal(r.score, Math.round(expScore * 1000) / 1000);
  assert.equal(r.confidence, Math.round(expConf * 1000) / 1000);
  assert.deepEqual(r.covered, ["resist:fire"]); assert.deepEqual(r.gaps, ["stat:con"]); assert.equal(r.excess, 1);
  assert.equal(M.decide(0.6), "accept"); assert.equal(M.decide(0.59), "suggest"); assert.equal(M.decide(0.39), "none");
  assert.equal(M.decide(0.5, { accept: 0.5, suggest: 0.2 }), "accept");
  assert.deepEqual(M.parseConfidence("0.7, 0.5"), { accept: 0.7, suggest: 0.5 });
  assert.deepEqual(M.parseConfidence(""), OFFICIAL_BASES.confidence);
  assert.deepEqual(M.parseConfidence("0.5, 0.9"), { accept: 0.5, suggest: 0.4 }, "suggest never above accept");
  assert.deepEqual(M.parseList("A, b\nC;;"), ["A", "b", "C"]);
});

test("+N template: fixed confidence, lower with two or more open lines", () => {
  const T = OFFICIAL_BASES.template;
  const one = M.plusTemplate({ shape: "weapon", bonus: 1 }, [{ key: "plus", needed: true }, { key: "damage:fire", needed: true }]);
  assert.equal(one.confidence, T.confidence); assert.equal(one.name, "Weapon +1"); assert.equal(one.source, "template");
  const many = M.plusTemplate({ shape: "chest", bonus: 2 }, [{ key: "a", needed: true }, { key: "b", needed: true }]);
  assert.equal(many.confidence, T.manyGaps); assert.equal(many.name, "Armor +2");
  assert.equal(M.plusTemplate({ shape: "gear", bonus: 1 }, []), null);
});

test("strength guard: a small proc never becomes an always-on damage base", () => {
  const idx = fixtureIndex();
  const blade = item(srcItem({ name: "Test Coal Blade", quality: "rare", type: "weapon", lines: ["One-Hand", "Sword", "40 - 75 Damage", "Speed 2.60", "Chance on hit: Burns the target for 20 Fire damage.", "Item Level 40"] }), { bonus: 1, extras: { base: "longsword" } });
  const needs = M.itemNeeds(blade);
  assert.equal(M.strengthGuard(needs, idx.byName.get("fixture ember sword")), false);
  const m = M.matchBase(blade, idx);
  assert.equal(m.base.source, "template", "falls back to +N weapon + proc rider");
  assert.ok(!m.candidates.some(c => c.name === "Fixture Ember Sword"));
  assert.equal(M.strengthGuard([{ key: "damage:fire", freq: "perTurn", avg: 7 }], { damage: [{ type: "fire", avg: 7, freq: "perTurn" }] }), true);
});

test("decided table: stealth variant, protection, school wand, armour by name", () => {
  const [cloakRule] = vb("variant").filter(r => r.slot === "Back");
  const [protRing] = vb("protection").filter(r => r.slot === "Finger");
  const arcane = vb("wand").find(r => r.school === "Arcane"), fire = vb("wand").find(r => r.school === "Fire");
  const idx = M.indexBases([{ pack: "t", entries: [
    entry("v1", cloakRule.name, { t: "clothing", rarity: "uncommon", effects: ae(["system.skills.ste.bonuses.check", "+ 5"]) }),
    entry("v2", protRing.name, { t: "ring", rarity: "rare", effects: ae(["system.attributes.ac.bonus", "+ 1"], ["system.bonuses.abilities.save", "+ 1"]) }),
    entry("v3", arcane.name, { t: "wand", rarity: "uncommon" }),
    entry("v4", fire.name, { t: "wand", rarity: "rare" })
  ] }]);
  const cloak = item(srcItem({ name: "Test Shade Cloak", quality: "uncommon", lines: ["Back", "+6 Agility", "Item Level 30"] }));
  assert.equal(M.tableBase(cloak, idx), null, "no stealth variant yet: no table hit");
  assert.equal(M.tableBase(cloak, idx, { variant: "stealth" }).entry.id, "v1");
  const ring = item(srcItem({ name: "Test Prism Ring", quality: "rare", lines: ["Finger", "+5 Fire Resistance", "+5 Frost Resistance", "+5 Shadow Resistance", "Item Level 40"] }));
  assert.equal(M.matchBase(ring, idx).base.name, protRing.name);
  assert.equal(M.matchBase(ring, idx).status, "accept");
  const wandA = item(srcItem({ name: "Test Spark Wand", quality: "uncommon", type: "weapon", lines: ["Ranged", "Wand", "10 - 20 Arcane Damage", "Speed 1.50", "Item Level 20"] }));
  assert.equal(M.tableBase(wandA, idx).entry.id, "v3");
  const wandF = item(srcItem({ name: "Test Cinder Wand", quality: "uncommon", type: "weapon", lines: ["Ranged", "Wand", "10 - 20 Fire Damage", "Speed 1.50", "Item Level 20"] }));
  assert.equal(M.tableBase(wandF, idx), null, "a Rare wand never goes on an Uncommon item; the cantrip fallback stays");
  const plate = item(srcItem({ name: "Test Warden Breastplate", quality: "rare", lines: ["Chest", "Plate", "400 Armor", "Item Level 50"] }), { bonus: 1 });
  const m = M.matchBase(plate, idx);
  assert.equal(m.armorBase, vb("armorName")[0].armorBase);
  assert.equal(m.base.source, "template");
});

test("ability-score bases: big main stat only, one rarity step up, belt by tier, setting off", () => {
  const gauntlets = vb("score").find(r => r.slot === "Hands"), belt = vb("score").find(r => r.belt);
  const idx = M.indexBases([{ pack: "t", entries: [
    entry("g1", gauntlets.name, { t: "clothing", rarity: "uncommon", attune: true, effects: ae(["system.abilities.str.value", 19]) }),
    entry("bh", `${belt.name} (Fixture Hill)`, { t: "clothing", rarity: "rare", effects: ae(["system.abilities.str.value", 21]) }),
    entry("bf", `${belt.name} (Fixture Fire)`, { t: "clothing", rarity: "veryRare", effects: ae(["system.abilities.str.value", 23]) }),
    entry("bc", `${belt.name} (Fixture Cloud)`, { t: "clothing", rarity: "legendary", effects: ae(["system.abilities.str.value", 27]) })
  ] }]);
  const gloves = q => item(srcItem({ name: "Test Grip", quality: q, lines: ["Hands", "Plate", "+15 Strength", "Item Level 50"] }));
  assert.equal(M.tableBase(gloves("rare"), idx).entry.id, "g1");
  assert.equal(M.tableBase(gloves("uncommon"), idx), null, "an Uncommon base needs a Rare item");
  assert.equal(M.tableBase(gloves("rare"), idx, { scoreItems: false }), null);
  const small = item(srcItem({ name: "Test Grip", quality: "rare", lines: ["Hands", "Plate", "+6 Strength", "Item Level 50"] }));
  assert.equal(M.tableBase(small, idx), null, "below the score threshold");
  const girdle = q => item(srcItem({ name: "Test Girdle", quality: q, lines: ["Waist", "Plate", "+20 Strength", "Item Level 60"] }));
  assert.equal(M.tableBase(girdle("epic"), idx).entry.id, "bf", "purple uses the 23 belt");
  assert.equal(M.tableBase(girdle("legendary"), idx), null, "no 25 belt in this index");
  assert.equal(M.tableBase(girdle("rare"), idx), null, "no belt tier for blue");
  assert.deepEqual(OFFICIAL_BASES.beltScore, { 3: 23, 4: 25 });
});

test("baseline and pattern rules never re-base", () => {
  const grey = item(srcItem({ name: "Test Grey Ring", quality: "poor", lines: ["Finger", "+3 Stamina", "Item Level 5"] }));
  assert.equal(M.matchBase(grey, fixtureIndex()).status, "none");
  const regen = item(srcItem({ name: "Test Troll Charm", quality: "epic", lines: ["Neck", "Equip: Restores 10 health per 5 sec.", "Item Level 60"] }));
  const m = M.matchBase(regen, fixtureIndex());
  assert.equal(m.status, "none"); assert.ok(m.pattern, "follows the regeneration pattern instead");
});

test("convertItem: accepted base -> route base, base flag, ONE gap-fill effect; unmatched -> one item effect", () => {
  const idx = fixtureIndex();
  const src = srcItem({ name: "Test Ember Band", quality: "epic", lines: ["Finger", "+25 Fire Resistance", "Item Level 60"] });
  const c = convertItem(src, { dnd5eMajor: 6, bases: idx });
  const f = c.data.flags["loot-ledger"];
  assert.equal(c.match.status, "accept");
  assert.equal(f.converted.route, "base");
  assert.equal(f.base.name, "Fixture Ring of Warding"); assert.equal(f.base.status, "accept");
  assert.equal(f.base.matcherVersion, M.MATCHER_VERSION);
  assert.ok(f.base.confidence >= OFFICIAL_BASES.confidence.accept);
  assert.equal(c.basedOn.name, "Fixture Ring of Warding");
  assert.deepEqual(c.data.effects, [], "the base covers the resistance: no gap-fill");
  assert.ok(ROUTES.includes(f.converted.route));
  assert.equal(f.converted.version, CONVERTER_VERSION);

  const two = srcItem({ name: "Test Ember Band", quality: "epic", lines: ["Finger", "+25 Fire Resistance", "Equip: Increased Defense +10.", "Item Level 60"] });
  const c2 = convertItem(two, { dnd5eMajor: 6, bases: idx, baseConfidence: { accept: 0.3, suggest: 0.2 } });
  const saves = srcItem({ name: "Test Sage Band", quality: "epic", lines: ["Finger", "+25 Fire Resistance", "+14 Spirit", "Item Level 60"] });
  const c3 = convertItem(saves, { dnd5eMajor: 6, bases: idx, baseConfidence: { accept: 0.3, suggest: 0.2 } });
  assert.equal(c3.match.status, "accept");
  const gf = c3.data.effects.filter(e => e.flags["loot-ledger"].gapFill);
  assert.ok(c3.data.flags["loot-ledger"].gapFills.length >= 1);
  assert.ok(gf.length <= 1, "at most one gap-fill effect");
  assert.ok(c2.data.effects.length <= 1);

  const plain = convertItem(srcItem({ name: "Test Quick Charm", quality: "rare", lines: ["Neck", "+12 Agility", "Item Level 50"] }), { dnd5eMajor: 6, bases: idx });
  assert.notEqual(plain.match?.status, "accept");
  assert.equal(plain.data.effects.length, 1);
  assert.equal(plain.data.effects[0].name, "Test Quick Charm (Loot Ledger)");
  assert.equal(plain.data.effects[0].flags["loot-ledger"].gapFill, undefined);
  assert.ok(!plain.data.effects[0].changes.some(ch => ch.key === "system.attributes.ac.bonus"), "no AC rider effect");
});

test("convertItem options: officialBases off, gapFills off, suggest keeps the tooltip conversion", () => {
  const idx = fixtureIndex();
  const src = srcItem({ name: "Test Sage Band", quality: "epic", lines: ["Finger", "+25 Fire Resistance", "+14 Spirit", "Item Level 60"] });
  const off = convertItem(src, { dnd5eMajor: 6, bases: idx, officialBases: false });
  assert.equal(off.match, null); assert.equal(off.data.flags["loot-ledger"].base, undefined);
  assert.equal(off.data.flags["loot-ledger"].converted.route, "convert-auto");
  const noGap = convertItem(src, { dnd5eMajor: 6, bases: idx, gapFills: false, baseConfidence: { accept: 0.3, suggest: 0.2 } });
  assert.deepEqual(noGap.data.effects, []); assert.deepEqual(noGap.data.flags["loot-ledger"].gapFills, []);
  const sug = convertItem(src, { dnd5eMajor: 6, bases: idx, baseConfidence: { accept: 0.95, suggest: 0.2 } });
  assert.equal(sug.match.status, "suggest");
  assert.equal(sug.basedOn, null, "a suggestion is not applied");
  assert.equal(sug.data.flags["loot-ledger"].base.status, "suggest");
  assert.equal(sug.data.flags["loot-ledger"].converted.route, "convert-review");
  const grey = convertItem(srcItem({ name: "Test Grey Ring", quality: "poor", lines: ["Finger", "+3 Stamina", "Item Level 5"] }), { dnd5eMajor: 6, bases: idx });
  assert.equal(grey.data.flags["loot-ledger"].converted.route, "baseline");
});

test("source hand-written text wins: kept as is, flagged, never re-based", () => {
  const hand = srcItem({ name: "Test Frost Kris", quality: "rare", type: "weapon",
    pre: "<p><strong>Rime.</strong> When you hit, the target takes an extra 1d6 cold damage.</p>",
    lines: ["One-Hand", "Dagger", "30 - 55 Damage", "Speed 1.80", "Chance on hit: Strikes the target for 60 Frost damage.", "Item Level 42"] });
  hand.type = "weapon"; hand.system.type = { value: "simpleM", baseItem: "dagger" };
  const c = convertItem(hand, { dnd5eMajor: 6, bases: fixtureIndex() });
  const f = c.data.flags["loot-ledger"];
  assert.equal(f.converted.handAuthoredKept, true);
  assert.equal(f.converted.sourceText, true);
  assert.equal(f.converted.route, "convert-review");
  assert.equal(c.match, null);
  assert.equal(c.data.system.magicalBonus, 1, "the +N backbone is added when the hand text has none");
});

test("applyOfficial: keeps name, icon, price and rarity; base effects plus the one gap-fill; basedOn alias", () => {
  const idx = fixtureIndex();
  const src = srcItem({ name: "Test Sage Band", quality: "epic", lines: ["Finger", "+25 Fire Resistance", "+14 Agility", "Item Level 60"] });
  const conv = convertItem(src, { dnd5eMajor: 6, bases: idx, baseConfidence: { accept: 0.3, suggest: 0.2 } });
  const price = conv.data.system.price;
  const doc = { ...structuredClone(FIXTURE_BASES[0]), uuid: "Compendium.test.bases.Item.b1", effects: ae(["system.traits.dr.value", "fire"]) };
  applyOfficial(conv, doc);
  const d = conv.data;
  assert.equal(d.name, "Test Sage Band"); assert.equal(d.img, src.img);
  assert.equal(conv.match.status, "accept");
  assert.deepEqual(d.system.price, price);
  assert.deepEqual(d.system.rarities, ["veryRare"], "quality rarity kept even when the base is lower");
  assert.equal(d.effects.filter(e => e.flags?.["loot-ledger"]?.gapFill).length, 1);
  assert.equal(d.effects.length, 2, "base's own effect + one gap-fill");
  assert.equal(d.flags["loot-ledger"].basedOn.uuid, "Compendium.test.bases.Item.b1");
  assert.equal(d.flags["loot-ledger"].base.uuid, "Compendium.test.bases.Item.b1");
  assert.match(d.system.description.value, /Based on: Fixture Ring of Warding/);
});

test("book route: used as is, only price, quality and focus added", () => {
  const src = srcItem({ name: "Test Gloom Staff", quality: "epic", type: "weapon", sell: 5000, lines: ["Two-Hand", "Staff", "50 - 90 Damage", "Speed 3.00", "Item Level 60"] });
  const book = { _id: "bk1", uuid: "Compendium.test.book.Item.bk1", name: "Test Gloom Staff", type: "weapon",
    system: { description: { value: "<p>Fixture book text.</p>" }, properties: ["mgc"], price: { value: 999, denomination: "gp" }, magicalBonus: 2 },
    effects: [{ name: "book fx" }], flags: {} };
  const d = bookItem(src, book, { ratio: "100" });
  assert.equal(d._id, src._id);
  assert.deepEqual(d.system.price, { value: 1, denomination: "gp" }, "2x vendor sell, never the book price");
  assert.equal(d.system.magicalBonus, 2); assert.equal(d.system.description.value, "<p>Fixture book text.</p>");
  assert.deepEqual(d.effects, [{ name: "book fx" }]);
  assert.ok(d.system.properties.includes("foc"));
  const f = d.flags["loot-ledger"];
  assert.equal(f.converted.route, "book"); assert.equal(f.base.status, "exact"); assert.equal(f.base.source, "book");
  assert.equal(f.quality, "epic");
  assert.equal(M.bookEntry([{ name: " test gloom staff " }], "Test Gloom Staff").name, " test gloom staff ");
  assert.equal(M.bookEntry([{ name: "Test Gloom Staff of Doom" }], "Test Gloom Staff"), null, "exact name only");
});

test("hand-made items: flag or list (name / uuid / id)", () => {
  assert.equal(M.isHandmade({ name: "X", flags: { "loot-ledger": { handmade: true } } }), true);
  assert.equal(M.isHandmade({ name: "Test Signet", _id: "abc" }, ["test signet"]), true);
  assert.equal(M.isHandmade({ name: "Y", uuid: "Compendium.a.Item.q" }, ["Compendium.a.Item.q"]), true);
  assert.equal(M.isHandmade({ name: "Y", _id: "q" }, []), false);
});

test("phase-2 hook passes the match through unchanged", () => {
  const m = { status: "none", base: null };
  assert.equal(M.variantStep(m, {}, {}), m);
});
