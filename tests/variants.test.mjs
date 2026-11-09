/**
 * Phase 2 of the conversion rework: stat variants (variants.mjs), the line budget and the line rules in convert.mjs.
 * Every item is a made-up fixture (invented names; stats and lines in the classic tooltip shape).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as V from "../scripts/variants.mjs";
import * as R from "../scripts/rules.mjs";
import { convertItem, parseSource, classify } from "../scripts/convert.mjs";
import * as M from "../scripts/base-match.mjs";
import { srcItem } from "./_fixtures.mjs";

const conv = (o, opts = {}) => convertItem(srcItem(o), { dnd5eMajor: 6, ...opts });
const riders = c => c.data.flags["loot-ledger"].riders;
const rider = (c, type) => riders(c).find(r => r.type === type);
const keys = c => c.data.effects.flatMap(e => (e.system?.changes ?? e.changes).map(x => `${x.key}=${x.value}`));
const variantOf = c => rider(c, "variant")?.variant ?? null;
const attuned = c => c.data.system.attunement === "required";
const facts = (slot, armor, shape = "gear") => V.slotFacts({ slot, wowType: armor }, shape);

test("slot table: one variant per main stat, deterministic, fallbacks", () => {
  const v = (ab, f, tier = 2) => V.slotRule(ab, f, tier).variant;
  assert.equal(v("str", facts("Hands")), "grapple");
  assert.equal(v("str", facts("Feet")), "athletics");
  assert.equal(v("str", facts("Chest", "Plate")), "moveSaves");
  assert.equal(v("str", facts("Waist", "Leather")), "moveSaves");
  assert.equal(v("str", facts("Head", "Leather")), "athletics", "no rule-slot -> Athletics");
  assert.equal(v("dex", facts("Legs")), "acrobatics");
  assert.equal(v("dex", facts("Back")), "stealth");
  assert.equal(v("dex", facts("Chest", "Leather")), "stealth");
  assert.equal(v("dex", facts("Finger")), "initiative");
  assert.equal(v("con", facts("Chest", "Mail")), "hpMax");
  assert.equal(v("con", facts("Head", "Mail")), "conSaves");
  assert.equal(v("con", facts("Wrist", "Cloth")), "conSaves", "worn cloth keeps Con saves");
  assert.equal(v("con", facts("Held In Off-hand", null)), "concentration", "held caster gear");
  assert.equal(v("int", facts("Wrist", "Cloth")), "spellDC");
  assert.equal(v("int", facts("Head", "Cloth")), "arcana");
  assert.equal(v("int", facts("Finger")), "investigation");
  assert.equal(v("int", facts("Finger"), 3), "spellDC", "purple jewellery with a caster stat");
  assert.equal(v("wis", facts("Chest", "Cloth")), "hitDice");
  assert.equal(v("wis", facts("Neck")), "wisSaves");
  assert.equal(v("wis", facts("Finger")), "perception");
  assert.equal(v("wis", V.slotFacts({ slot: "Main Hand", wowType: "Mace" }, "weapon")), "wisSaves", "held items");
  for (const ab of V.STAT_ORDER) assert.ok(R.VARIANT_SLOTS[ab].at(-1).fallback, `${ab} has a fallback`);
});

test("main stat tie-break: slot rule, then armour type, then stat order", () => {
  const p = stats => ({ stats, statLines: {}, itemLevel: 30 });
  assert.equal(V.mainStat(p({ str: 8, int: 8 }), facts("Head", "Cloth"), 2).ability, "int", "Int has a head rule, Str only the fallback");
  assert.equal(V.mainStat(p({ str: 8, dex: 8 }), facts("Chest", "Leather"), 2).ability, "dex", "both have rules there? Str no, Dex stealth");
  assert.equal(V.mainStat(p({ int: 8, wis: 8 }), facts("Neck"), 2).ability, "int", "both have neck rules: stat order");
  assert.equal(V.mainStat(p({ str: 8, wis: 8 }), facts("Neck"), 2).ability, "wis", "Str has only its fallback on a neck");
  assert.equal(V.mainStat(p({ con: 8, str: 8 }), facts("Trinket"), 2).ability, "str", "no slot rules, no armour: stat order");
  assert.equal(V.mainStat(p({ dex: 9, str: 8 }), facts("Hands"), 2).ability, "dex", "highest value first");
  assert.equal(V.mainStat(p({ str: 3 }), facts("Hands"), 2).sub, true);
});

test("variant sizes: checks/saves +1/+1/+2/+2, Initiative +1/+2/+2/+3, HP per level, Hit Dice", () => {
  assert.deepEqual(R.VARIANT_RULE.bonus, { 1: 1, 2: 1, 3: 2, 4: 2 });
  assert.deepEqual(R.VARIANT_RULE.initiative, { 1: 1, 2: 2, 3: 2, 4: 3 });
  assert.equal(V.variantFeature("hpMax", "con", 2).rider.formula, "floor(@details.level / 2)");
  assert.equal(V.variantFeature("hpMax", "con", 3).rider.formula, "@details.level");
  assert.equal(V.variantFeature("hitDice", "wis", 4).rider.formula, "@prof");
  assert.equal(V.variantFeature("initiative", "dex", 4).rider.value, 3);
  const dc = V.variantFeature("spellDC", "int", 3);
  assert.equal(dc.rider.attune, true);
  assert.match(dc.text, /doesn't stack with other items that raise your spell save DC/);
  assert.equal(dc.rider.uses, undefined, "passive, not limited uses");
});

test("Advantage swap: never by default; only with the opt-in override and from purple", () => {
  const src = { name: "Test Swift Ring", quality: "epic", lines: ["Finger", "+20 Agility", "Item Level 60"] };
  assert.ok(keys(conv(src)).includes("system.attributes.init.roll.bonus=+ 2"));
  const opt = conv(src, { overrides: { advantage: true } });
  assert.ok(keys(opt).includes("system.attributes.init.roll.mode=1"));
  assert.equal(rider(opt, "variant").advantage, true);
  const blue = conv({ ...src, quality: "rare" }, { overrides: { advantage: true } });
  assert.ok(!rider(blue, "variant").advantage, "not below purple");
});

test("AE keys: dnd5e keys per variant; grapple and Hit Dice are text only", () => {
  const k = (lines, q = "rare") => keys(conv({ name: "Test Gear", quality: q, lines: [...lines, "Item Level 40"] }));
  assert.deepEqual(k(["Feet", "Leather", "+10 Strength"]), ["system.skills.ath.roll.bonus=+ 1"]);
  assert.deepEqual(k(["Chest", "Mail", "300 Armor", "+10 Stamina"]), ["system.attributes.hp.bonuses.overall=+ floor(@details.level / 2)"]);
  assert.deepEqual(k(["Wrist", "Cloth", "+10 Intellect"]), ["system.bonuses.spell.dc=1"]);
  assert.deepEqual(k(["Held In Off-hand", "+10 Stamina"]), ["system.attributes.concentration.roll.bonus=+ 1"]);
  assert.deepEqual(k(["Hands", "Plate", "+10 Strength"]), [], "grapple DC: text only");
  assert.deepEqual(k(["Legs", "Cloth", "+10 Spirit"]), [], "Hit Dice healing: text only");
});

test("green / blue items whose only benefit is the variant need no attunement; the spell-DC variant on purple does", () => {
  const cuffs = conv({ name: "Test Plain Cuffs", quality: "uncommon", lines: ["Wrist", "Cloth", "+6 Intellect", "Item Level 25"] });
  assert.equal(variantOf(cuffs), "spellDC"); assert.equal(attuned(cuffs), false);
  const blue = conv({ name: "Test Plain Cuffs", quality: "rare", lines: ["Wrist", "Cloth", "+8 Intellect", "Item Level 40"] });
  assert.equal(attuned(blue), false);
  const purple = conv({ name: "Test Plain Cuffs", quality: "epic", lines: ["Wrist", "Cloth", "+14 Intellect", "Item Level 60"] });
  assert.equal(attuned(purple), true);
});

test("sub-threshold main stat: variant only when the item would otherwise be blank", () => {
  const blank = conv({ name: "Test Thin Band", quality: "rare", lines: ["Finger", "+3 Agility", "Item Level 40"] });
  assert.equal(variantOf(blank), "initiative");
  const wand = conv({ name: "Test Ember Wand", quality: "uncommon", type: "weapon", lines: ["Ranged", "Wand", "20 - 30 Fire Damage", "Speed 1.50", "+2 Intellect", "Item Level 20"] });
  assert.equal(variantOf(wand), null, "the wand already has its cantrip: no sub-threshold gap-fill");
  assert.ok(wand.data.system.properties.includes("foc"));
});

test("line budget: green 1, blue 2, purple/orange 3; weakest dropped to Not converted; flavour is free", () => {
  assert.deepEqual(R.LINE_BUDGET, { 1: 1, 2: 2, 3: 3, 4: 3 });
  assert.deepEqual(V.overBudget([{ key: "v", variant: true, weight: 1 }, { key: "a", weight: 2 }], 1), ["a"], "green: the variant is the one benefit");
  assert.deepEqual(V.overBudget([{ key: "v", variant: true, weight: 1 }, { key: "a", weight: 2 }], 1, { weapon: true }), ["v"], "weapons keep their line");
  assert.deepEqual(V.overBudget([{ key: "v", variant: true, weight: 1 }, { key: "a", weight: 3 }, { key: "b", weight: 3 }, { key: "c", weight: 3 }], 3), ["c"], "ties: the later line goes");
  assert.deepEqual(V.overBudget([{ key: "f", free: true, weight: 1 }, { key: "v", variant: true, weight: 1 }], 1), []);
  const green = conv({ name: "Test Lucky Gloves", quality: "uncommon", lines: ["Hands", "Leather", "+6 Agility", "Equip: Improves your chance to get a critical strike by 1%.", "Item Level 25"] });
  assert.equal(variantOf(green), "initiative");
  assert.equal(rider(green, "critDice"), undefined);
  assert.ok(green.data.flags["loot-ledger"].converted.notConverted.some(l => /critical strike/.test(l)));
});

test("chest armour curve: the +0/+0/+1/+2 'feature' is a converted line, not a variant", () => {
  const c = conv({ name: "Test Dragon Plate", quality: "epic", lines: ["Chest", "Mail", "500 Armor", "+20 Stamina", "Item Level 70"] });
  assert.equal(c.result.bonus, R.ARMOR_BONUS[3].withEffect);
  assert.equal(variantOf(c), "hpMax");
});

test("crit dice: +1d6/+1d6/+2d6/+3d6, not doubled; spell crit; setting off", () => {
  assert.deepEqual(R.CRIT_RULE.dice, { 1: "1d6", 2: "1d6", 3: "2d6", 4: "3d6" });
  const line = "Equip: Improves your chance to get a critical strike by 1%.";
  const c = conv({ name: "Test Keen Band", quality: "epic", lines: ["Finger", line, "Item Level 60"] });
  assert.equal(rider(c, "critDice").formula, "2d6");
  assert.match(c.result.features.find(f => /Keen Edge/.test(f.text)).text, /isn't doubled/);
  const s = conv({ name: "Test Keen Band", quality: "epic", lines: ["Finger", "Equip: Improves your chance to get a critical strike with spells by 1%.", "Item Level 60"] });
  assert.equal(rider(s, "critDice").scope, "spell");
  const off = conv({ name: "Test Keen Band", quality: "epic", lines: ["Finger", line, "Item Level 60"] }, { rules: { critDice: false } });
  assert.equal(rider(off, "critDice"), undefined);
});

test("+hit on non-weapons: purple+ with attunement only; weapons covered by +N", () => {
  const line = "Equip: Improves your chance to hit by 1%.";
  const blue = conv({ name: "Test Aim Ring", quality: "rare", lines: ["Finger", line, "Item Level 40"] });
  assert.equal(rider(blue, "attackBonus"), undefined);
  const purple = conv({ name: "Test Aim Ring", quality: "epic", lines: ["Finger", line, "Item Level 60"] });
  assert.equal(rider(purple, "attackBonus").value, 1); assert.equal(attuned(purple), true);
  assert.ok(keys(purple).includes("system.rolls.attack.mwak.bonus=+ 1"));
});

test("+Defense: +1 AC on trinkets, applied by the effect (attuned); elsewhere not converted", () => {
  const t = conv({ name: "Test Guard Charm", quality: "rare", lines: ["Trinket", "Equip: Increased Defense +7.", "Item Level 40"] });
  assert.ok(keys(t).includes("system.attributes.ac.bonus=+ 1")); assert.equal(attuned(t), true);
  const r = conv({ name: "Test Guard Ring", quality: "rare", lines: ["Finger", "Equip: Increased Defense +7.", "Item Level 40"] });
  assert.ok(!keys(r).some(k => k.includes("ac.bonus")));
  assert.ok(r.result.notConverted.some(l => /Defense/.test(l)));
});

test("parry / dodge: Reaction +2 AC (green/blue), +PB (purple/orange), 1 per Short Rest; setting off", () => {
  const line = "Equip: Increases your chance to parry an attack by 1%.";
  const b = rider(conv({ name: "Test Guard Band", quality: "rare", lines: ["Finger", line, "Item Level 40"] }), "parry");
  assert.deepEqual([b.value, b.uses, b.recovery], [2, 1, "sr"]);
  assert.equal(rider(conv({ name: "Test Guard Band", quality: "epic", lines: ["Finger", line, "Item Level 60"] }), "parry").value, "@prof");
  assert.equal(rider(conv({ name: "Test Guard Band", quality: "rare", lines: ["Finger", line, "Item Level 40"] }, { rules: { parryReaction: false } }), "parry"), undefined);
});

test("mana regen: slot recovery 1/3/4/5 by slot, Concentration elsewhere, uses on the item; setting off", () => {
  assert.deepEqual(R.MANA_REGEN.slotLevel, { 1: 1, 2: 3, 3: 4, 4: 5 });
  const line = "Equip: Restores 4 mana per 5 sec.";
  const hat = conv({ name: "Test Wise Hood", quality: "epic", lines: ["Head", "Cloth", line, "Item Level 60"] });
  assert.equal(rider(hat, "slotRecovery").level, 4); assert.equal(attuned(hat), true);
  assert.deepEqual(hat.data.system.uses.recovery, [{ period: "lr", type: "recoverAll" }]);
  const boots = conv({ name: "Test Calm Boots", quality: "rare", lines: ["Feet", "Cloth", line, "Item Level 40"] });
  assert.equal(rider(boots, "concentration").value, 1);
  assert.ok(keys(boots).includes("system.attributes.concentration.roll.bonus=+ 1"));
  assert.equal(rider(conv({ name: "Test Wise Hood", quality: "epic", lines: ["Head", "Cloth", line, "Item Level 60"] }, { rules: { manaRegen: false } }), "slotRecovery"), undefined);
});

test("health regen: regeneration pattern at purple/orange; green/blue without a base -> review", () => {
  const line = "Equip: Restores 8 health per 5 sec.";
  const p = conv({ name: "Test Troll Band", quality: "epic", lines: ["Finger", line, "Item Level 60"] });
  assert.deepEqual([rider(p, "regeneration").formula, rider(p, "regeneration").minutes], ["1d6", 10]);
  assert.equal(p.data.flags["loot-ledger"].converted.pattern, R.VARIANT_BASES.find(r => r.pattern).name);
  const g = conv({ name: "Test Troll Band", quality: "rare", lines: ["Finger", line, "Item Level 40"] });
  assert.equal(g.result.needsReview, true);
});

test("resistance: identity test on blue+ jewellery/cloaks, biggest school, two only on orange, never doubled", () => {
  const cloak = conv({ name: "Test Ember Cloak", quality: "epic", lines: ["Back", "+10 Stamina", "+12 Fire Resistance", "Item Level 70"] });
  assert.equal(rider(cloak, "resistance").damageType, "fire", "largest line on a cloak");
  const notLargest = conv({ name: "Test Ember Cloak", quality: "epic", lines: ["Back", "+14 Stamina", "+12 Fire Resistance", "Item Level 70"] });
  assert.equal(rider(notLargest, "resistance"), undefined, "not the largest number: no resistance");
  const tie = conv({ name: "Test Twin Ring", quality: "rare", lines: ["Finger", "+10 Frost Resistance", "+10 Fire Resistance", "Item Level 40"] });
  assert.equal(riders(tie).filter(r => r.type === "resistance").length, 1);
  assert.equal(rider(tie, "resistance").damageType, "cold", "tie: first listed");
  const orange = conv({ name: "Test Twin Talisman", quality: "legendary", lines: ["Neck", "+25 Fire Resistance", "+25 Nature Resistance", "Item Level 70"] });
  assert.equal(riders(orange).filter(r => r.type === "resistance").length, 2, "orange with two full-size lines: both");
  const purple = conv({ name: "Test Twin Talisman", quality: "epic", lines: ["Neck", "+25 Fire Resistance", "+25 Nature Resistance", "Item Level 70"] });
  assert.equal(riders(purple).filter(r => r.type === "resistance").length, 1);
  const green = conv({ name: "Test Ember Ring", quality: "uncommon", lines: ["Finger", "+10 Fire Resistance", "Item Level 30"] });
  assert.equal(rider(green, "resistance"), undefined, "identity test from blue");
});

test("3+ small resistances on a ring or cloak: protection base, else review", () => {
  const src = srcItem({ name: "Test Warding Band", quality: "epic", lines: ["Finger", "+5 Fire Resistance", "+5 Frost Resistance", "+5 Shadow Resistance", "Item Level 60"] });
  const none = convertItem(src, { dnd5eMajor: 6 });
  assert.equal(none.result.needsReview, true);
  const name = R.VARIANT_BASES.find(r => r.kind === "protection" && r.slot === "Finger").name;
  const idx = M.indexBases([{ pack: "t", entries: [{ _id: "p1", name, type: "equipment", system: { rarities: ["rare"], type: { value: "ring" } }, effects: [], _stats: {} }] }]);
  const hit = convertItem(src, { dnd5eMajor: 6, bases: idx });
  assert.equal(hit.match.base.name, name); assert.equal(hit.match.status, "accept"); assert.equal(hit.result.needsReview, false);
});

test("when-struck lines: passive thorns rider (no uses); flavour lines: free small bonus; setting off", () => {
  const t = conv({ name: "Test Spiked Charm", quality: "rare", lines: ["Neck", "Equip: When struck in combat inflicts 3 Nature damage to the attacker.", "Item Level 40"] });
  const r = rider(t, "thorns");
  assert.deepEqual([r.formula, r.damageType, r.uses], ["1d4", "poison", undefined]);
  const hat = conv({ name: "Test Digger Hat", quality: "uncommon", lines: ["Head", "Leather", "+5 Intellect", "Equip: Mining +5.", "Item Level 20"] });
  assert.equal(rider(hat, "flavour").value, 2);
  assert.equal(variantOf(hat), "arcana", "still gets its variant (flavour is free)");
  assert.equal(rider(conv({ name: "Test Digger Hat", quality: "uncommon", lines: ["Head", "Leather", "Equip: Mining +5.", "Item Level 20"] }, { rules: { flavourBonuses: false } }), "flavour"), undefined);
});

test("weapons: +1 always wins at green, caster staves keep the variant too, spell line -> Concentration", () => {
  assert.deepEqual(R.WEAPON_BONUS, { 0: 0, 1: 1, 2: 1, 3: 2, 4: 3 });
  const axe = conv({ name: "Test Keen Axe", quality: "uncommon", type: "weapon", lines: ["Two-Hand", "Axe", "30 - 50 Damage", "Speed 3.50", "Equip: Improves your chance to get a critical strike by 1%.", "Item Level 30"] });
  assert.equal(axe.result.bonus, 1); assert.equal(rider(axe, "critDice").formula, "1d6");
  const staff = conv({ name: "Test Apprentice Staff", quality: "uncommon", type: "weapon", lines: ["Two-Hand", "Staff", "30 - 50 Damage", "Speed 3.00", "+8 Intellect", "Item Level 25"] });
  assert.equal(staff.result.bonus, 1); assert.equal(variantOf(staff), "spellDC");
  assert.ok(staff.data.system.properties.includes("foc"));
  const sage = conv({ name: "Test Sage Staff", quality: "epic", type: "weapon", lines: ["Two-Hand", "Staff", "60 - 90 Damage", "Speed 3.00", "+20 Intellect", "Equip: Increases damage and healing done by magical spells and effects by up to 30.", "Item Level 60"] });
  assert.equal(variantOf(sage), "concentration"); assert.equal(rider(sage, "spellBonus").scope, "attackAndDC");
});

test("weapons: school damage dice, proc classes with the 2.0 blast threshold setting, endgame raise override", () => {
  const edge = conv({ name: "Test Frost Blade", quality: "rare", type: "weapon", lines: ["One-Hand", "Sword", "30 - 50 Damage", "Speed 2.60", "+ 5 - 10 Frost Damage", "Item Level 40"] });
  assert.equal(rider(edge, "extraDamage").formula, "1d6");
  const proc = n => ({ name: "Test Saw", quality: "rare", type: "weapon", lines: ["Two-Hand", "Axe", "40 - 60 Damage", "Speed 3.50", `Chance on hit: Blasts the enemy for ${n} Fire damage.`, "Item Level 50"] });
  const blast = conv(proc(115));
  assert.deepEqual([rider(blast, "burstDamage").formula, rider(blast, "burstDamage").uses], ["4d6", 1], "ratio 2.3 -> blast");
  assert.equal(rider(conv(proc(115), { rules: { blastThreshold: 2.5 } }), "extraDamage").trigger, "hit", "threshold setting");
  assert.equal(rider(conv(proc(30)), "extraDamage").trigger, "critical", "ratio < 1 -> crit dice");
  assert.equal(conv(proc(115), { overrides: { raise: true } }).result.bonus, 2, "+1 step only by override");
});

test("weapon names: machete / cutlass / scimitar -> Scimitar; heavy crossbow and fist stand-in unchanged", () => {
  const base = (name, type, hands = "One-Hand", speed = "2.60") => conv({ name, quality: "uncommon", type: "weapon", lines: [hands, type, "10 - 20 Damage", `Speed ${speed}`, "Item Level 20"] }).result.base;
  assert.equal(base("Test Jungle Machete", "Sword", "One-Hand", "1.60"), "scimitar");
  assert.equal(base("Test Pirate Cutlass", "Sword"), "scimitar");
  assert.equal(base("Test Heavy Crossbow", "Crossbow", "Ranged", "3.20"), "heavycrossbow");
  assert.equal(base("Test Claw", "Fist Weapon"), "fist", "custom stand-in kept");
});

test("matcher: variants and new riders map to base tags; gap-fill signature is sorted", () => {
  assert.deepEqual(M.riderTags({ type: "variant", variant: "stealth" }), ["stealth"]);
  assert.deepEqual(M.riderTags({ type: "regeneration" }), ["hpRegen"]);
  assert.equal(V.gapFillSignature([{ kind: "variant", detail: "stealth" }, { kind: "critDice" }]), "critDice,variant:stealth");
  const p = parseSource(srcItem({ name: "Test Shadow Cape", quality: "rare", lines: ["Back", "+10 Agility", "Item Level 40"] }));
  assert.equal(classify(p), "gear");
});

/* -------------------------------------------- */
/*  Per-item expectations (anonymous fixtures)  */
/* -------------------------------------------- */

test("sample expectations (non-weapons), recast as made-up fixtures", () => {
  const miner = conv({ name: "Test Prospector Cap", quality: "uncommon", lines: ["Head", "Leather", "+5 Intellect", "Equip: Mining +5.", "Item Level 20"] });
  assert.equal(rider(miner, "flavour").value, 2);
  const eye = conv({ name: "Test Seer Eye", quality: "rare", lines: ["Head", "Leather", "+10 Strength", "Equip: Improves your chance to get a critical strike by 1%.", "Item Level 45"] });
  assert.equal(variantOf(eye), "athletics"); assert.equal(rider(eye, "critDice").formula, "1d6");
  const crown = conv({ name: "Test Storm Crown", quality: "epic", lines: ["Head", "Cloth", "+20 Intellect", "Equip: Increases damage and healing done by magical spells and effects by up to 25.", "Equip: Restores 4 mana per 5 sec.", "Item Level 76"] });
  assert.equal(rider(crown, "spellBonus").value, 2); assert.equal(rider(crown, "slotRecovery").level, 4);
  const collar = conv({ name: "Test Wolf Collar", quality: "epic", lines: ["Neck", "+15 Stamina", "Equip: Increases your chance to parry an attack by 1%.", "Equip: Improves your chance to get a critical strike by 2%.", "Item Level 60"] });
  assert.equal(variantOf(collar), "conSaves"); assert.equal(rider(collar, "parry").value, "@prof"); assert.equal(rider(collar, "critDice").formula, "2d6");
  const tooth = conv({ name: "Test Drake Tooth", quality: "epic", lines: ["Neck", "+12 Agility", "+10 Fire Resistance", "Equip: Improves your chance to hit by 1%.", "Equip: Improves your chance to get a critical strike by 1%.", "Item Level 70"] });
  assert.equal(variantOf(tooth), "initiative"); assert.equal(rider(tooth, "attackBonus").value, 1);
  assert.equal(rider(tooth, "critDice").formula, "2d6"); assert.equal(rider(tooth, "resistance"), undefined, "no fire res");
  const shard = conv({ name: "Test Binding Shard", quality: "legendary", lines: ["Neck", "+8 Strength", "+25 Fire Resistance", "+25 Nature Resistance", "Equip: When struck in combat inflicts 3 Nature damage to the attacker.", "Item Level 70"] });
  assert.equal(riders(shard).filter(r => r.type === "resistance").length, 2); assert.equal(rider(shard, "thorns").formula, "1d6");
  const scale = conv({ name: "Test Scale Cloak", quality: "epic", lines: ["Back", "+10 Stamina", "+15 Fire Resistance", "Item Level 70"] });
  assert.equal(rider(scale, "resistance").damageType, "fire"); assert.equal(variantOf(scale), "conSaves");
  for (const n of ["Test Bright Wraps", "Test Silk Cuffs", "Test Bead Bracers"]) {
    const c = conv({ name: n, quality: "uncommon", lines: ["Wrist", "Cloth", "+6 Intellect", "Item Level 30"] });
    assert.equal(attuned(c), false, n); assert.ok(rider(c, "variant"));
  }
  const boots = conv({ name: "Test Frost Boots", quality: "epic", lines: ["Feet", "Cloth", "+18 Stamina", "+10 Intellect", "Item Level 70"] });
  assert.equal(variantOf(boots), "conSaves", "cloth boots: Con saves");
  const signet = conv({ name: "Test Slayer Signet", quality: "epic", lines: ["Finger", "+12 Intellect", "Equip: Improves your chance to get a critical strike with spells by 1%.", "Item Level 70"] });
  assert.equal(variantOf(signet), "spellDC"); assert.equal(rider(signet, "variant").value, 2); assert.equal(attuned(signet), true);
  assert.equal(rider(signet, "critDice").formula, "2d6"); assert.equal(rider(signet, "resistance"), undefined);
  const talisman = conv({ name: "Test Blood Talisman", quality: "epic", lines: ["Trinket", "Equip: Increased Defense +10.", "Equip: Increases your chance to dodge an attack by 1%.", "Equip: Restores 10 health per 5 sec.", "Item Level 70"] });
  assert.ok(keys(talisman).includes("system.attributes.ac.bonus=+ 1")); assert.equal(rider(talisman, "parry").value, "@prof"); assert.ok(rider(talisman, "regeneration"));
  const scaleShard = conv({ name: "Test Scale Sliver", quality: "epic", lines: ["Trinket", "Equip: Restores 6 mana per 5 sec.", "Item Level 70"] });
  assert.equal(rider(scaleShard, "slotRecovery").level, 4);
  const eph = conv({ name: "Test Fleeting Talisman", quality: "epic", lines: ["Trinket", "Use: Increases damage and healing done by magical spells and effects by up to 175 for 15 sec.", "Item Level 70"] });
  const surge = rider(eph, "spellSurge");
  assert.deepEqual([surge.value, surge.formula, surge.uses], [2, "1d8", 3]); assert.equal(attuned(eph), true);
  const scepter = conv({ name: "Test Royal Scepter", quality: "rare", type: "weapon", lines: ["Main Hand", "Mace", "40 - 70 Damage", "Speed 2.60", "+10 Spirit", "Equip: Increases healing done by spells and effects by up to 30.", "Item Level 60"] });
  assert.equal(variantOf(scepter), "wisSaves"); assert.equal(rider(scepter, "healBonus").formula, "1d4");
  assert.ok(scepter.data.system.properties.includes("foc"));
});

test("sample expectations (weapons), recast as made-up fixtures", () => {
  const chopper = conv({ name: "Test Neck Chopper", quality: "uncommon", type: "weapon", lines: ["Two-Hand", "Axe", "40 - 65 Damage", "Speed 3.60", "Equip: Improves your chance to get a critical strike by 1%.", "Item Level 35"] });
  assert.equal(chopper.result.base, "greataxe"); assert.equal(chopper.result.bonus, 1); assert.equal(rider(chopper, "critDice").formula, "1d6");
  const saw = conv({ name: "Test Doom Saw", quality: "rare", type: "weapon", lines: ["Two-Hand", "Axe", "40 - 60 Damage", "Speed 3.50", "Chance on hit: Blasts the enemy for 110 to 120 Fire damage.", "Item Level 50"] });
  assert.deepEqual([rider(saw, "burstDamage").formula, rider(saw, "burstDamage").uses], ["4d6", 1]);
  const brand = conv({ name: "Test Digger Brand", quality: "rare", type: "weapon", lines: ["Main Hand", "Mace", "30 - 50 Damage", "Speed 2.70", "Chance on hit: Blasts the enemy for 25 Fire damage.", "Item Level 40"] });
  assert.equal(brand.result.base, "mace"); assert.equal(brand.result.bonus, 1);
  assert.deepEqual([rider(brand, "extraDamage").formula, rider(brand, "extraDamage").trigger], ["2d6", "critical"]);
  const machete = conv({ name: "Test Hill Machete", quality: "uncommon", type: "weapon", lines: ["One-Hand", "Sword", "10 - 20 Damage", "Speed 2.60", "Item Level 20"] });
  assert.equal(machete.result.base, "scimitar");
  const mageStaff = conv({ name: "Test Brigand Staff", quality: "uncommon", type: "weapon", lines: ["Two-Hand", "Staff", "30 - 50 Damage", "Speed 3.00", "+8 Intellect", "Item Level 25"] });
  assert.equal(mageStaff.result.bonus, 1); assert.equal(variantOf(mageStaff), "spellDC");
  const jordan = conv({ name: "Test Elder Staff", quality: "epic", type: "weapon", lines: ["Two-Hand", "Staff", "60 - 90 Damage", "Speed 3.00", "+15 Intellect", "Equip: Increases damage and healing done by magical spells and effects by up to 20.", "Item Level 50"] });
  assert.equal(variantOf(jordan), "concentration");
  const fang = conv({ name: "Test Gloom Fang", quality: "rare", type: "weapon", lines: ["One-Hand", "Sword", "30 - 55 Damage", "Speed 2.90", "Chance on hit: Wounds the target for 45 Shadow damage.", "Item Level 40"] });
  assert.equal(fang.result.bonus, 1); assert.equal(rider(fang, "extraDamage").trigger, "hit");
});

test("main stat ties: quality-gated jewellery row first, then armour order (plate / mail: Sta before Str), then slot rules", () => {
  const p = stats => ({ stats, statLines: {}, itemLevel: 60 });
  assert.equal(V.mainStat(p({ int: 12, con: 12 }), facts("Finger"), 3).ability, "int", "purple ring: caster stat -> spell DC row wins");
  assert.equal(V.mainStat(p({ int: 12, con: 12 }), facts("Finger"), 2).ability, "con", "blue ring: no gated row, stat order");
  assert.equal(V.mainStat(p({ str: 14, con: 14 }), facts("Feet", "Plate"), 2).ability, "con", "plate boots: armour order beats Str's boot row");
  assert.equal(V.mainStat(p({ str: 9, dex: 9 }), facts("Legs", "Leather"), 2).ability, "dex", "leather: Agi");
  assert.equal(V.mainStat(p({ con: 2, wis: 2 }), facts("Waist", "Cloth"), 1).ability, "wis", "cloth: Int / Spi");
  const ring = conv({ name: "Test Wyrm Signet", quality: "epic", lines: ["Finger", "+12 Intellect", "+12 Stamina", "Item Level 70"] });
  assert.equal(variantOf(ring), "spellDC"); assert.equal(attuned(ring), true);
  const boots = conv({ name: "Test Rime Sabatons", quality: "rare", lines: ["Feet", "Plate", "300 Armor", "+14 Strength", "+14 Stamina", "Item Level 58"] });
  assert.equal(variantOf(boots), "conSaves");
});

test("untyped damage procs take the weapon's damage type; a proc with an extra clause is flagged", () => {
  const saw = conv({ name: "Test Grim Cleaver", quality: "rare", type: "weapon", lines: ["Two-Hand", "Polearm", "40 - 60 Damage", "Speed 3.50", "Chance on hit: Wounds the target for 100 to 130 damage.", "Item Level 50"] });
  const b = rider(saw, "burstDamage");
  assert.deepEqual([b.formula, b.uses, b.damageType], ["4d6", 1, "slashing"], "ratio 2.3 -> Rare blast in the polearm's type");
  assert.equal(saw.data.flags["loot-ledger"].converted.review.length, 0, "not left for review");
  const small = conv({ name: "Test Bonk Knuckle", quality: "rare", type: "weapon", lines: ["One-Hand", "Mace", "30 - 50 Damage", "Speed 2.00", "Chance on hit: Pummels the target for 4 damage and interrupts the spell being cast.", "Item Level 40"] });
  assert.equal(rider(small, "extraDamage"), undefined, "untyped damage + another effect: review");
  assert.ok(small.data.flags["loot-ledger"].converted.flags.some(f => f.kind === "procParts"));
  const typed = conv({ name: "Test Gloom Hook", quality: "epic", type: "weapon", lines: ["One-Hand", "Dagger", "40 - 70 Damage", "Speed 1.80", "Chance on hit: Hurls a bolt for 70 Shadow damage and weakens the target.", "Item Level 60"] });
  assert.equal(rider(typed, "extraDamage").damageType, "necrotic", "typed damage still converts");
  assert.ok(typed.data.flags["loot-ledger"].converted.flags.some(f => f.kind === "procParts"), "the rest is flagged");
  const ring = conv({ name: "Test Spiked Band", quality: "rare", lines: ["Finger", "Chance on hit: Wounds the target for 20 damage.", "Item Level 40"] });
  assert.ok(ring.data.flags["loot-ledger"].converted.review.some(r => /not a weapon/.test(r)), "non-weapons: review");
});

test("endgame raise: +1 step on the +N of weapons, chest armour and shields (override only)", () => {
  const plate = { name: "Test Drake Breastplate", quality: "epic", lines: ["Chest", "Mail", "400 Armor", "+15 Stamina", "Equip: Improves your chance to get a critical strike by 1%.", "Item Level 70"] };
  assert.equal(conv(plate).result.bonus, 1, "curve: Very Rare armour with features +1");
  assert.equal(conv(plate, { overrides: { raise: true } }).result.bonus, 2, "raise override +1 step");
  const shield = { name: "Test Lion Guard", quality: "rare", lines: ["Off Hand", "Shield", "1500 Armor", "+10 Stamina", "Item Level 50"] };
  const s0 = conv(shield).result.bonus;
  assert.equal(conv(shield, { overrides: { raise: true } }).result.bonus, s0 + 1);
});
