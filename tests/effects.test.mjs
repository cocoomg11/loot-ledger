/**
 * Active Effect keys and shape (0.4.0): every key the converter, the stat variants and the random suffixes write is a
 * current dnd5e 6.x key (checked against dnd5e release 6.0.6: SHIM_FIELDS / BONUS_SHIM_REGEX in
 * module/documents/active-effect.mjs, migrated paths in module/data/actor/templates/common.mjs), and every change is in
 * the Foundry 14 shape { key, type, value, phase, priority } under system.changes. Made-up fixtures only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KEYS, DEPRECATED_KEY, aeChange, effectData, effectChanges, changeType } from "../scripts/effects.mjs";
import { convertItem, riderChanges } from "../scripts/convert.mjs";
import { variantKeys } from "../scripts/variants.mjs";
import { SUFFIXES } from "../scripts/rules.mjs";
import { suffixEffects } from "../scripts/suffix.mjs";
import { srcItem } from "./_fixtures.mjs";

/** Every key dnd5e 6.x reads for what Loot Ledger writes (the pinned list). */
const PINNED = new Set([
  "system.skills.ath.roll.bonus", "system.skills.ste.roll.bonus", "system.skills.acr.roll.bonus", "system.skills.arc.roll.bonus",
  "system.skills.inv.roll.bonus", "system.skills.prc.roll.bonus",
  "system.skills.ath.roll.mode", "system.skills.ste.roll.mode", "system.skills.acr.roll.mode", "system.skills.arc.roll.mode",
  "system.skills.inv.roll.mode", "system.skills.prc.roll.mode",
  "system.abilities.str.save.roll.bonus", "system.abilities.con.save.roll.bonus", "system.abilities.wis.save.roll.bonus",
  "system.abilities.dex.save.roll.bonus", "system.abilities.int.save.roll.bonus", "system.abilities.cha.save.roll.bonus",
  "system.abilities.str.save.roll.mode", "system.abilities.con.save.roll.mode", "system.abilities.wis.save.roll.mode",
  "system.abilities.str.check.roll.bonus", "system.abilities.dex.check.roll.bonus", "system.abilities.con.check.roll.bonus",
  "system.abilities.int.check.roll.bonus", "system.abilities.wis.check.roll.bonus", "system.abilities.cha.check.roll.bonus",
  "system.attributes.init.roll.bonus", "system.attributes.init.roll.mode",
  "system.attributes.concentration.roll.bonus", "system.attributes.concentration.roll.mode",
  "system.attributes.hp.bonuses.overall", "system.bonuses.spell.dc", "system.attributes.ac.bonus", "system.traits.dr.value",
  "system.rolls.attack.mwak.bonus", "system.rolls.attack.rwak.bonus", "system.rolls.attack.msak.bonus", "system.rolls.attack.rsak.bonus"
]);

const RIDERS = [
  { type: "resistance", damageType: "fire" }, { type: "acBonus", value: 1 },
  ...["str", "dex", "con", "int", "wis", "cha"].flatMap(a => [{ type: "saveBonus", ability: a, value: 1 }, { type: "checkBonus", ability: a, value: 1 }]),
  { type: "spellBonus", value: 1, scope: "attackAndDC" }, { type: "attackBonus", value: 1, scope: "weapon" }, { type: "attackBonus", value: 1, scope: "spell" },
  { type: "concentration", value: 1 },
  ...["athletics", "moveSaves", "initiative", "stealth", "acrobatics", "conSaves", "concentration", "arcana", "investigation", "wisSaves", "perception"]
    .flatMap(v => [{ type: "variant", variant: v, value: 1 }, { type: "variant", variant: v, value: 1, advantage: true }]),
  { type: "variant", variant: "hpMax", formula: "@details.level" }, { type: "variant", variant: "spellDC", value: 1 }
];

test("riderChanges: every key is pinned, none is a deprecated bonuses.check / bonuses.save key, shape is Foundry 14", () => {
  const all = RIDERS.flatMap(riderChanges);
  assert.ok(all.length >= 40);
  for (const c of all) {
    assert.ok(PINNED.has(c.key), `unpinned key ${c.key}`);
    assert.ok(!DEPRECATED_KEY.test(c.key), `deprecated key ${c.key}`);
    assert.ok(!/bonuses\.(check|save)/.test(c.key), c.key);
    assert.deepEqual(Object.keys(c).sort(), ["key", "phase", "priority", "type", "value"]);
    assert.equal(c.type, "add"); assert.equal(c.phase, "initial"); assert.equal(c.priority, null);
    assert.equal(typeof c.value, "string");
    assert.equal("mode" in c, false, "no numeric mode");
  }
  assert.equal(KEYS.abilityCheck("str"), "system.abilities.str.check.roll.bonus");
});

test("variant keys: flat and Advantage keys are all pinned", () => {
  for (const v of ["athletics", "moveSaves", "initiative", "stealth", "acrobatics", "hpMax", "conSaves", "concentration", "spellDC", "arcana", "investigation", "wisSaves", "perception"]) {
    const k = variantKeys(v);
    for (const key of [k.flat, k.adv].filter(Boolean)) assert.ok(PINNED.has(key), `${v}: ${key}`);
  }
});

test("converted items: effects carry system.changes (no top-level changes) with pinned keys", () => {
  const items = [
    srcItem({ name: "Test Owl Hood", quality: "rare", lines: ["Head", "Cloth", "+12 Intellect", "Item Level 45"] }),
    srcItem({ name: "Test Stone Collar", quality: "epic", lines: ["Neck", "+17 Stamina", "Item Level 60"] }),
    srcItem({ name: "Test Fire Band", quality: "epic", lines: ["Finger", "+20 Fire Resistance", "Item Level 60"] }),
    srcItem({ name: "Test Swift Cloak", quality: "uncommon", lines: ["Back", "+8 Agility", "Item Level 30"] }),
    srcItem({ name: "Test Seer Sash", quality: "epic", lines: ["Trinket", "Equip: Improves your chance to hit by 1%.", "+10 Intellect", "Item Level 60"] })
  ];
  let n = 0;
  for (const src of items) {
    for (const fx of convertItem(src, { dnd5eMajor: 6 }).data.effects) {
      assert.equal(fx.changes, undefined, `${src.name}: no top-level changes`);
      assert.equal(fx.type, "base");
      for (const c of fx.system.changes) { n++; assert.ok(PINNED.has(c.key), c.key); assert.equal(c.type, "add"); }
    }
  }
  assert.ok(n >= 5);
});

test("random suffix effects use the same keys and shape", () => {
  for (const s of SUFFIXES) {
    for (const power of [1, 3]) {
      for (const c of suffixEffects(s, power).changes) {
        assert.ok(PINNED.has(c.key), `${s.id}: ${c.key}`);
        assert.equal(c.type, "add"); assert.equal(c.phase, "initial");
      }
    }
  }
});

test("source: no script writes a deprecated key or a numeric mode", () => {
  for (const f of ["convert.mjs", "variants.mjs", "suffix.mjs", "effects.mjs"]) {
    const src = readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");
    assert.ok(!/["'`]system\.(skills|abilities)\.\w+\.bonuses\.(check|save)["'`]/.test(src), `${f}: literal deprecated key`);
    assert.ok(!/\$\{[^}]+\}\.bonuses\.(check|save)/.test(src), `${f}: built deprecated key`);
    assert.ok(!/mode: AE|mode: 2\b|AE_ADD/.test(src), `${f}: numeric mode`);
  }
});

test("helpers: effectData, effectChanges (old and new shapes), changeType", () => {
  assert.equal(effectData({ name: "x", changes: [] }), null);
  const fx = effectData({ name: "x", changes: [aeChange("system.attributes.ac.bonus", "+ 1")] });
  assert.deepEqual(effectChanges(fx), [{ key: "system.attributes.ac.bonus", type: "add", value: "+ 1", phase: "initial", priority: null }]);
  assert.deepEqual(effectChanges({ changes: [{ key: "k", mode: 2 }] }), [{ key: "k", mode: 2 }], "old data still reads");
  assert.equal(changeType({ type: "upgrade" }), "upgrade");
  assert.equal(changeType({ mode: 4 }), "upgrade");
  assert.equal(changeType({ mode: 5 }), "override");
  assert.equal(changeType({ mode: 2 }), "add");
});
