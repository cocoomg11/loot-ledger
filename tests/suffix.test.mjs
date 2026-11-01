/**
 * Random suffix enchantments (scripts/suffix.mjs): pick weighting by group, power scaling, effects, naming,
 * no double roll, price bump, build wiring and the dry-run guards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../scripts/suffix.mjs";
import { SUFFIXES, SUFFIX_RULE, SUFFIX_WEIGHTS, STAT_PASSIVE } from "../scripts/rules.mjs";
import { convertItem, parseSource, classify } from "../scripts/convert.mjs";
import { activeGMId } from "../scripts/suffix-hooks.mjs";
import { srcItem, FIXTURES } from "./_fixtures.mjs";
import { install } from "./_foundry.mjs";

const RND = "&lt;Random enchantment&gt;";
const lcg = (seed = 7) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const counts = (group, n = 20000) => {
  const rng = lcg(42), c = {};
  for (let i = 0; i < n; i++) { const s = S.pickSuffix(group, rng); c[s.id] = (c[s.id] ?? 0) + 1; }
  return c;
};

test("suffix table: unique ids, generic names, every weight key is a real suffix, every group can roll", () => {
  const ids = SUFFIXES.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(SUFFIXES.length >= 25);
  for (const s of SUFFIXES) assert.match(s.label, /^of /);
  for (const [g, w] of Object.entries(SUFFIX_WEIGHTS)) {
    for (const k of Object.keys(w)) assert.ok(ids.includes(k), `${g}.${k}`);
    assert.ok(S.suffixWeights(g).length > 10, g);
  }
});

test("pick weighting by group: cloth favours Owl / Intellect, plate favours Bear / Strength / Defense", () => {
  const cloth = counts("cloth"), plate = counts("plate");
  assert.ok(cloth.owl > 3 * (cloth.bear ?? 0), "owl >> bear on cloth");
  assert.ok(cloth.intellect > 3 * (cloth.strength ?? 0));
  assert.ok(plate.bear > 3 * (plate.owl ?? 0), "bear >> owl on plate");
  assert.ok(plate.strength > 3 * (plate.intellect ?? 0));
  assert.ok(plate.defense > plate.arcaneres);
  // slot-only suffixes
  assert.equal(counts("melee").blocking, undefined, "blocking only on shields");
  assert.equal(counts("plate").marksmanship, undefined, "marksmanship only on ranged");
  assert.ok(counts("shield").blocking > 0);
  assert.ok(counts("ranged").marksmanship > counts("ranged").strength);
});

test("pickSuffix walks the cumulative weights", () => {
  const list = S.suffixWeights("plate");
  assert.equal(S.pickSuffix("plate", () => 0).id, list[0].suffix.id);
  assert.equal(S.pickSuffix("plate", () => 0.999999).id, list.at(-1).suffix.id);
});

test("group from item shape", () => {
  const g = lines => { const p = parseSource(srcItem({ name: "X", lines, type: lines.includes("Bow") || lines.includes("Sword") || lines.includes("Staff") ? "weapon" : "equipment" })); return S.suffixGroup(p, classify(p)); };
  assert.equal(g(["Chest", "Cloth", "40 Armor"]), "cloth");
  assert.equal(g(["Waist", "Plate", "200 Armor"]), "plate");
  assert.equal(g(["Feet", "Leather", "60 Armor"]), "leather");
  assert.equal(g(["One-Hand", "Sword", "10 - 20 Damage", "Speed 2.50"]), "melee");
  assert.equal(g(["Ranged", "Bow", "10 - 20 Damage", "Speed 2.50"]), "ranged");
  assert.equal(g(["Two-Hand", "Staff", "10 - 20 Damage", "Speed 3.00"]), "caster");
  assert.equal(g(["Finger"]), "jewelry");
  assert.equal(g(["Back"]), "jewelry");
});

test("power scales with quality and level band", () => {
  assert.equal(S.suffixPower({ quality: "common", band: 1 }), 1);
  assert.equal(S.suffixPower({ quality: "uncommon", band: 2 }), 1);
  assert.equal(S.suffixPower({ quality: "uncommon", band: 5 }), 2, "band boost");
  assert.equal(S.suffixPower({ quality: "rare", band: 3 }), 2);
  assert.equal(S.suffixPower({ quality: "epic", band: 7 }), 4);
  assert.equal(S.suffixPower({ quality: "legendary", band: 7 }), 4, "capped");
});

test("effects scale: single stat full size, two-stat suffix two smaller effects, resistances, others", () => {
  const ag = id => S.suffixById(id);
  const agi4 = S.suffixEffects(ag("agility"), 4);
  assert.match(agi4.features[0].text, new RegExp(`\\+${STAT_PASSIVE.dex.initiative[4]} bonus to Initiative`));
  const monkey4 = S.suffixEffects(ag("monkey"), 4);
  assert.equal(monkey4.features.length, 2, "two effects");
  assert.match(monkey4.features[0].text, new RegExp(`\\+${STAT_PASSIVE.dex.initiative[4 - SUFFIX_RULE.comboDrop]} bonus`), "each one tier smaller");
  assert.equal(S.suffixEffects(ag("bear"), 1).features.length, 2, "power 1 combo still has both (at size 1)");
  const fireLo = S.suffixEffects(ag("fireres"), 1), fireHi = S.suffixEffects(ag("fireres"), SUFFIX_RULE.resistFrom);
  assert.match(fireLo.features[0].text, /Advantage on saving throws against effects that deal Fire damage/);
  assert.equal(fireLo.changes.length, 0);
  assert.match(fireHi.features[0].text, /Resistance to Fire damage/);
  assert.deepEqual(fireHi.changes[0], { key: "system.traits.dr.value", mode: 2, value: "fire" });
  assert.match(S.suffixEffects(ag("frostres"), 4).features[0].text, /Cold/, "school map");
  assert.match(S.suffixEffects(ag("power"), 1).features[0].text, /Critical Hit/);
  assert.match(S.suffixEffects(ag("power"), 4).features[0].text, /once per turn/);
  assert.match(S.suffixEffects(ag("defense"), 1).features[0].text, /Reaction/);
  assert.equal(S.suffixEffects(ag("defense"), 3).changes[0].key, "system.attributes.ac.bonus");
  assert.match(S.suffixEffects(ag("marksmanship"), 4).features[0].text, /Three-Quarters Cover/);
  // modest: never an ability score, AC at most +1, no resistance below resistFrom
  for (const s of SUFFIXES) for (const p of [1, 2, 3, 4]) {
    const e = S.suffixEffects(s, p);
    assert.ok(e.features.length >= 1, `${s.id}@${p}`);
    assert.ok(!e.changes.some(c => /abilities\.\w+\.value/.test(c.key)), "no ability score");
    assert.ok(!e.features.some(f => /ability score/i.test(f.text)), "no score wording");
    for (const c of e.changes.filter(c => c.key.endsWith("ac.bonus"))) assert.ok(Number(c.value.replace(/\D/g, "")) <= 1);
    if (p < SUFFIX_RULE.resistFrom) assert.ok(!e.riders.some(r => r.type === "resistance"));
  }
});

test("naming: appended once", () => {
  const bear = S.suffixById("bear");
  assert.equal(S.suffixName("Banded Girdle", bear), "Banded Girdle of the Bear");
  assert.equal(S.suffixName("Banded Girdle of the Bear", bear), "Banded Girdle of the Bear");
});

test("price bump by power", () => {
  assert.deepEqual(S.suffixPrice({ value: 10, denomination: "gp" }, 1), { value: 12, denomination: "gp" });
  assert.deepEqual(S.suffixPrice({ value: 10, denomination: "gp" }, 4), { value: 15, denomination: "gp" });
  assert.deepEqual(S.suffixPrice({ value: 0, denomination: "gp" }, 4), { value: 0, denomination: "gp" });
});

const girdle = () => srcItem({ name: "Test Banded Girdle", quality: "uncommon", lines: ["Waist", "Plate", "180 Armor", RND, "Item Level 44"] });

test("converter flags random-line items with their group; others unflagged", () => {
  const d = convertItem(girdle(), { dnd5eMajor: 6 }).data;
  assert.equal(d.flags["loot-ledger"].randomSuffix, true);
  assert.equal(d.flags["loot-ledger"].suffixGroup, "plate");
  const plain = convertItem(FIXTURES[0], { dnd5eMajor: 6 }).data;
  assert.equal(plain.flags["loot-ledger"].randomSuffix, undefined);
  assert.equal(S.suffixUpdate(plain), null, "no random line: nothing to roll");
});

test("suffixUpdate: rename, effects, riders, price, rolled flag; never rolls twice; reroll starts from the base", () => {
  const d = convertItem(girdle(), { dnd5eMajor: 6 }).data;
  const res = S.suffixUpdate(d, { suffixId: "bear", now: 123 });
  assert.equal(res.update.name, "Test Banded Girdle of the Bear");
  assert.equal(res.power, 2, "uncommon in band 5");
  const f = res.update["flags.loot-ledger.suffix"];
  assert.equal(f.id, "bear"); assert.equal(f.rolledAt, 123); assert.equal(f.base.name, "Test Banded Girdle");
  assert.equal(res.update["system.price"].value, Number((d.system.price.value * SUFFIX_RULE.priceMultiplier[2]).toFixed(4)));
  assert.ok(res.update["flags.loot-ledger.riders"].filter(r => r.source === "suffix").length === 2);
  assert.match(res.update["system.description.value"], /Random suffix: of the Bear/);
  assert.equal(res.effects.length, 1, "Constitution part is an Active Effect");
  assert.equal(res.effects[0].transfer, true);

  // apply the update as Foundry would, then try again
  const after = structuredClone(d);
  after.name = res.update.name;
  after.system.price = res.update["system.price"];
  after.system.description.value = res.update["system.description.value"];
  after.flags["loot-ledger"].suffix = f;
  after.flags["loot-ledger"].riders = res.update["flags.loot-ledger.riders"];
  after.effects = res.effects.map((e, i) => ({ ...e, _id: `ae${i}` }));
  assert.equal(S.isRolled(after), true);
  assert.equal(S.suffixUpdate(after), null, "no double roll");
  assert.equal(S.suffixUpdate(after, { suffixId: "owl" }), null, "even with an id, unless reroll");

  const re = S.suffixUpdate(after, { suffixId: "owl", reroll: true });
  assert.equal(re.update.name, "Test Banded Girdle of the Owl", "not '... of the Bear of the Owl'");
  assert.equal(re.update["system.price"].value, res.update["system.price"].value, "price not bumped twice");
  assert.ok(!re.update["system.description.value"].includes("of the Bear"));
  assert.deepEqual(re.removeEffects, ["ae0"]);
  assert.equal(re.update["flags.loot-ledger.riders"].filter(r => r.suffix === "bear").length, 0);
  assert.equal(re.update["system.attunement"], d.system.attunement ?? "", "owl does not attune");
  assert.throws(() => S.suffixUpdate(d, { suffixId: "nope" }), /unknown suffix/);
  const epic = structuredClone(d); epic.flags["loot-ledger"].quality = "epic";
  assert.equal(S.suffixUpdate(epic, { suffixId: "fireres" }).update["system.attunement"], "required", "resistance attunes");
});

test("suffix table rows and report page", () => {
  const rows = S.suffixTable();
  assert.equal(rows.length, SUFFIXES.length);
  assert.ok(rows.every(r => r.low && r.high && r.groups.length));
  assert.deepEqual(rows.find(r => r.id === "blocking").groups, ["shield"]);
  const html = S.suffixPageHtml({ sourceCount: 2 });
  assert.match(html, /<strong>2<\/strong> source items carry/);
  assert.ok(!html.includes("<script"));
});

test("bundled samples carry the random line (count reported by the calibration data)", () => {
  const samples = JSON.parse(readFileSync(new URL("../tools/fixtures/sample-items.json", import.meta.url), "utf8"));
  assert.equal(samples.filter(e => (e.lines ?? []).some(l => S.hasRandomLine(l))).length, 2);
});

test("public wording: no publisher names in suffix rules or code", () => {
  for (const f of ["../scripts/suffix.mjs", "../scripts/suffix-hooks.mjs"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /blizzard|warcraft|\bwow\b/i, f);
  }
  assert.doesNotMatch(JSON.stringify(SUFFIXES), /blizzard|warcraft|\bwow\b/i);
});

test("active-GM pick is the lowest active GM id", () => {
  assert.equal(activeGMId([{ id: "b", isGM: true, active: true }, { id: "a", isGM: true, active: false }, { id: "c", isGM: true, active: true }, { id: "0", isGM: false, active: true }]), "b");
  assert.equal(activeGMId([]), null);
});

test("build: counts random lines, adds the report page; dry run still writes nothing", async () => {
  const { build } = await import("../scripts/build.mjs");
  const env = install({ sourceItems: [...FIXTURES, girdle()], settings: { convertOnBuild: true } });
  const before = { journal: env.journal.length, chat: env.chat.length };
  const dry = await build({ dryRun: true });
  assert.equal(dry.randomSuffixLines, 1);
  assert.equal(env.journal.length, before.journal); assert.equal(env.chat.length, before.chat);
  assert.match(dry.report.pages.at(-1).name, /^Random suffixes \(1\)$/);
  const s = await build({ confirm: false });
  assert.equal(s.randomSuffixLines, 1);
  const conv = [...env.packs.get("world.loot-ledger-converted-items").docs.values()].find(d => d.name === "Test Banded Girdle");
  assert.equal(conv.flags["loot-ledger"].randomSuffix, true);
  assert.equal(conv.flags["loot-ledger"].suffix, undefined, "build never rolls; rolling happens on drop");
  assert.match(env.journal[0]._pages.at(-1).text.content, /source item carry|source items carry/);
  // conversion off: no suffix page
  const env2 = install({ sourceItems: [...FIXTURES, girdle()] });
  const off = await build({ dryRun: true });
  assert.ok(!off.report.pages.some(p => /Random suffixes/.test(p.name)));
  assert.ok(env2);
});
