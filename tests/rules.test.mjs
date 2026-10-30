/**
 * Pins the calibration values in scripts/rules.mjs. These are the v0.2.0 values, unchanged.
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
  assert.deepEqual(curve(R.ARMOR_BONUS), [[0, 0], [0, 0], [1, 1], [2, 2], [3, 3]], "chest armour: official curve, no green +1");
  assert.equal(R.ATTUNE_TIER, 3);
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
  assert.deepEqual(R.STAT_PASSIVE.dex.initiative, { 1: 1, 2: 1, 3: 2, 4: 3 });
  assert.deepEqual(R.STAT_PASSIVE.con.hpPerLevel, { 1: 0.5, 2: 0.5, 3: 1, 4: 1 });
  assert.deepEqual(R.STAT_PASSIVE.int.dc, { 1: 1, 2: 1, 3: 2, 4: 2 });
  assert.deepEqual(R.STAT_PASSIVE.int.uses, { 1: 1, 2: 2, 3: 1, 4: 2 });
  assert.deepEqual(R.STAT_PASSIVE.wis.perDie, { 1: "1", 2: "1", 3: "2", 4: "@prof" });
  assert.equal(R.STAT_PASSIVE.str.athleticsFrom, 2);
  assert.deepEqual(R.TRINKET_RULE.bonus, { 1: 1, 2: 2, 3: 2, 4: 2 });
  assert.ok(Math.max(...Object.values(R.TRINKET_RULE.bonus)) <= 2, "official items never give more than +2 to checks or saves");
});

test("line rules", () => {
  assert.deepEqual(R.HIT_RULE, { minTier: 1, bonus: 1 });
  assert.deepEqual(R.DEFENSE_RULE, { minTier: 1, ac: 1 });
  assert.deepEqual(R.SPELL_RULE.bonus, { 0: 1, 1: 1, 2: 1, 3: 2, 4: 3 });
  assert.deepEqual(R.RESIST_RULE, { minValue: 15, perItemLevel: 0.3 });
  assert.equal(R.PROC_RULE.critBelow, 1);
  assert.equal(R.PROC_RULE.burstFrom, 2.5);
  assert.deepEqual(R.PROC_RULE.burstDice, { 0: "2d6", 1: "3d6", 2: "4d6", 3: "6d6", 4: "8d6" });
});

test("limited uses: Flurry follows DAILY_USES, blasts are capped lower", () => {
  assert.deepEqual(R.DAILY_USES, { 0: 1, 1: 2, 2: 3, 3: 4, 4: 6 });
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
