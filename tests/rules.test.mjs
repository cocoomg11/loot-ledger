/**
 * Pins the calibration values in scripts/rules.mjs (v0.3.0 rule changes: bands, attunement tier, armour curve,
 * rider dice, Resistance tier, daily uses, Initiative, mana potion slots).
 * Book day: when you change a value in rules.mjs on purpose, change the matching expectation here in the same commit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../scripts/rules.mjs";
import * as C from "../scripts/convert.mjs";
import { QUALITIES, priceFor } from "../scripts/data.mjs";

test("rarity by quality", () => {
  assert.deepEqual(R.RARITY_BY_QUALITY, { poor: "common", common: "common", uncommon: "uncommon", rare: "rare", epic: "veryRare", legendary: "legendary", artifact: "artifact" });
  for (const q of QUALITIES) assert.equal(q.rarity, R.RARITY_BY_QUALITY[q.key], `QUALITIES reads ${q.key} rarity from rules.mjs`);
});

test("mixed drop weights", () => {
  assert.deepEqual(R.DROP_WEIGHT, { poor: 120, common: 50, uncommon: 24, rare: 5, epic: 1, legendary: 0, artifact: 0 });
  for (const q of QUALITIES) assert.equal(q.weight, R.DROP_WEIGHT[q.key]);
});

test("price rule: listed = 2 x vendor sell, exact copper round-trip", () => {
  assert.deepEqual(R.PRICE_RULE, { sellMultiplier: 2, tenToOneMinCp: 1 });
  assert.deepEqual(priceFor(10203, "100"), { value: 2.0406, denomination: "gp" });
  assert.deepEqual(priceFor(2350, "100"), { value: 47, denomination: "sp" });
  assert.deepEqual(priceFor(7, "100"), { value: 14, denomination: "cp" });
  assert.deepEqual(priceFor(7, "10"), { value: 2, denomination: "cp" });
  assert.deepEqual(priceFor(0, "100"), { value: 0, denomination: "gp" });
});

test("tier and +N curves", () => {
  assert.deepEqual(R.TIER, { poor: 0, common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, artifact: 4 });
  const curve = t => [0, 1, 2, 3, 4].map(k => [t[k].plain, t[k].withEffect]);
  assert.deepEqual(curve(R.GEAR_BONUS), [[0, 0], [1, 0], [1, 1], [2, 2], [3, 3]], "weapons and shields");
  assert.deepEqual(curve(R.ARMOR_BONUS), [[0, 0], [0, 0], [1, 0], [2, 1], [3, 2]], "chest armour: official curve, no green +1; armour with features one step lower");
  assert.equal(R.ATTUNE_TIER, 4);
});

test("chest armour bases by item level", () => {
  assert.deepEqual(R.CHEST_RULES.map(r => `${r.wow}:${r.maxIlvl ?? "*"}:${r.base}`), [
    "Leather:30:leather", "Leather:*:studded", "Mail:25:chainshirt", "Mail:45:scalemail", "Mail:*:breastplate",
    "Plate:45:chainmail", "Plate:58:splint", "Plate:*:plate"
  ]);
  for (const r of R.CHEST_RULES) assert.ok(C.ARMOR_BASES[r.base], `${r.base} is an SRD armour`);
  for (const r of R.WEAPON_RULES) assert.ok(C.WEAPON_BASES[r.base], `${r.base} is a known weapon base`);
  assert.equal(R.CLOTH_CHEST, "clothing");
});

test("stat passives and trinket bonuses", () => {
  assert.deepEqual(R.STAT_RULE, { minTier: 1, minValue: 4, perItemLevel: 7 });
  assert.deepEqual(R.STAT_PASSIVE.dex.initiative, { 1: 2, 2: 2, 3: 3, 4: 4 });
  assert.deepEqual(R.STAT_PASSIVE.con.hpPerLevel, { 1: 0.5, 2: 0.5, 3: 1, 4: 1 });
  assert.deepEqual(R.STAT_PASSIVE.int.dc, { 1: 1, 2: 1, 3: 2, 4: 2 });
  assert.deepEqual(R.STAT_PASSIVE.int.uses, { 1: 1, 2: 2, 3: 1, 4: 2 });
  assert.deepEqual(R.STAT_PASSIVE.wis.perDie, { 1: "1", 2: "1", 3: "2", 4: "@prof" });
  assert.equal(R.STAT_PASSIVE.str.athleticsFrom, 2);
  assert.equal(R.STAT_PASSIVE.str.carryMultiplier, 2);
  assert.deepEqual(R.TRINKET_RULE.bonus, { 1: 1, 2: 2, 3: 2, 4: 2 });
  assert.ok(Math.max(...Object.values(R.TRINKET_RULE.bonus)) <= 2, "official items never give more than +2 to checks or saves");
});

test("line rules", () => {
  assert.deepEqual(R.HIT_RULE, { minTier: 3, bonus: 1 }, "+hit on non-weapons: purple+ and attuned");
  assert.deepEqual(R.DEFENSE_RULE, { minTier: 1, ac: 1, slots: ["Trinket"] });
  assert.deepEqual(R.SPELL_RULE.bonus, { 0: 1, 1: 1, 2: 1, 3: 2, 4: 3 });
  assert.deepEqual(R.RESIST_RULE, { minValue: 15, perItemLevel: 0.3, minTier: 3 });
  assert.deepEqual(R.WEAPON_EXTRA_DICE, { 0: "1d4", 1: "1d4", 2: "1d6", 3: "1d8", 4: "1d10" });
  assert.equal(R.PROC_RULE.critBelow, 1);
  assert.equal(R.PROC_RULE.burstFrom, 2, "blast threshold default (setting blastThreshold)");
  assert.deepEqual(R.PROC_RULE.burstDice, { 0: "2d6", 1: "3d6", 2: "4d6", 3: "6d6", 4: "8d6" });
});

test("limited uses: Flurry follows DAILY_USES, blasts are capped lower", () => {
  assert.deepEqual(R.DAILY_USES, { 0: 1, 1: 1, 2: 2, 3: 3, 4: 3 });
  assert.deepEqual(R.BLAST_USES, { 0: 1, 1: 1, 2: 1, 3: 2, 4: 3 });
  assert.equal(R.EXTRA_ATTACK_RULE.uses, R.DAILY_USES);
  for (const t of [0, 1, 2, 3, 4]) assert.ok(R.BLAST_USES[t] <= R.DAILY_USES[t]);
});

test("every per-tier table covers tiers it is read at, and level tables end at Infinity", () => {
  for (const [name, t] of Object.entries({ GEAR_BONUS: R.GEAR_BONUS, ARMOR_BONUS: R.ARMOR_BONUS, DAILY_USES: R.DAILY_USES, BLAST_USES: R.BLAST_USES, WEAPON_EXTRA_DICE: R.WEAPON_EXTRA_DICE, crit: R.PROC_RULE.critDice, onHit: R.PROC_RULE.onHitDice, burst: R.PROC_RULE.burstDice, spell: R.SPELL_RULE.bonus }))
    for (const k of [0, 1, 2, 3, 4]) assert.ok(t[k] !== undefined, `${name}[${k}]`);
  for (const [name, t] of Object.entries({ POTION_HEALING: R.POTION_HEALING, MANA_POTION_SLOT: R.MANA_POTION_SLOT, FOOD_HEALING: R.FOOD_HEALING, GEAR_HEALING: R.GEAR_HEALING })) {
    assert.equal(t.at(-1).maxIlvl, Infinity, name);
    for (let i = 1; i < t.length; i++) assert.ok(t[i].maxIlvl > t[i - 1].maxIlvl, `${name} ascending`);
  }
});

test("the converter reads the tables from rules.mjs (same objects)", () => {
  for (const k of ["GEAR_BONUS", "ARMOR_BONUS", "STAT_PASSIVE", "TRINKET_RULE", "PROC_RULE", "DAILY_USES", "BLAST_USES", "WEAPON_RULES", "CHEST_RULES"]) {
    assert.equal(C[k], R[k], k);
  }
});

test("level bands, creature tables, potion reflavour, review threshold", async () => {
  const { BANDS, bandForLevel, bandForItemLevel } = await import("../scripts/data.mjs");
  assert.equal(BANDS, R.LEVEL_BANDS, "data.mjs reads the bands from rules.mjs");
  assert.deepEqual(R.LEVEL_BANDS.map(b => [b.band, b.min, b.max, b.levels, b.charMin, b.charMax]), [
    [1, 1, 14, "L1–2", 1, 2], [2, 15, 28, "L3–4", 3, 4], [3, 29, 37, "L5–7", 5, 7], [4, 38, 46, "L8–10", 8, 10],
    [5, 47, 56, "L11–13", 11, 13], [6, 57, 65, "L14–16", 14, 16], [7, 66, Infinity, "L17–20", 17, 20]
  ]);
  assert.deepEqual(R.MANA_POTION_SLOT.map(r => [r.maxIlvl, r.level]), [[25, 1], [45, 3], [Infinity, 5]]);
  for (let l = 1; l <= 20; l++) assert.ok(R.LEVEL_BANDS.some(b => b.band === bandForLevel(l)), `character level ${l}`);
  assert.equal(bandForItemLevel(60), 6);
  assert.equal(bandForItemLevel(66), 7);
  assert.deepEqual(R.CREATURE_TABLE, { bandSpread: 1, minItems: 3 });
  assert.deepEqual(R.POTION_REFLAVOUR.map(r => [r.maxIlvl, r.name]), [
    [25, "Potion of Healing"], [35, "Potion of Greater Healing"], [45, "Potion of Superior Healing"], [Infinity, "Potion of Supreme Healing"]
  ]);
  assert.equal(C.POTION_REFLAVOUR, R.POTION_REFLAVOUR);
  assert.equal(R.EMPTY_REVIEW_TIER, 3);
});

test("drop table description follows DROP_WEIGHT", async () => {
  const { dropOdds } = await import("../scripts/build.mjs");
  assert.equal(dropOdds(), "poor 60%, common 25%, uncommon 12%, rare 2.5%, epic 0.5%");
});

test("random suffix rules (first pass, section 9)", () => {
  assert.deepEqual(R.SUFFIX_RULE, { minPower: 1, maxPower: 4, highBandFrom: 5, bandBoost: 1, comboDrop: 1, resistFrom: 3,
    priceMultiplier: { 1: 1.2, 2: 1.25, 3: 1.35, 4: 1.5 }, baseWeight: 1 });
  assert.equal(R.SUFFIXES.length, 25);
  assert.deepEqual(Object.keys(R.SUFFIX_WEIGHTS), ["cloth", "leather", "mail", "plate", "shield", "melee", "ranged", "caster", "jewelry"]);
});

test("phase 2 line rules and variant tables", () => {
  assert.deepEqual(R.WEAPON_BONUS, { 0: 0, 1: 1, 2: 1, 3: 2, 4: 3 });
  assert.deepEqual(R.CRIT_RULE.dice, { 1: "1d6", 2: "1d6", 3: "2d6", 4: "3d6" });
  assert.deepEqual(R.PARRY_RULE, { ac: { 1: 2, 2: 2, 3: "@prof", 4: "@prof" }, uses: 1, recovery: "sr" });
  assert.deepEqual(R.MANA_REGEN.slotLevel, { 1: 1, 2: 3, 3: 4, 4: 5 });
  assert.deepEqual(R.MANA_REGEN.concentration, { 1: 1, 2: 1, 3: 2, 4: 2 });
  assert.deepEqual(R.HEALTH_REGEN, { patternFrom: 3, dice: "1d6", minutes: 10 });
  assert.deepEqual(R.LINE_BUDGET, { 1: 1, 2: 2, 3: 3, 4: 3 });
  assert.deepEqual(R.VARIANT_RULE.bonus, { 1: 1, 2: 1, 3: 2, 4: 2 });
  assert.ok(Math.max(...Object.values(R.VARIANT_RULE.bonus)) <= 2, "checks and saves capped at +2");
  assert.equal(R.WEAPON_RULES[0].base, "scimitar", "name rule before speed rules");
});
