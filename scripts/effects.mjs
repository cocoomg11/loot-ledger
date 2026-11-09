/**
 * Active Effect changes written by Loot Ledger (pure; tested in Node). One place for the dnd5e keys and the change shape,
 * so the converter, the stat variants and the random suffixes all write the same, current form.
 *
 * Keys: dnd5e 6.x moved the roll bonuses under `roll` fields and keeps the old `bonuses.*` keys only as shims that warn
 * and go away in dnd5e 7.0 (module/documents/active-effect.mjs SHIM_FIELDS and BONUS_SHIM_REGEX, and the migrated
 * paths in module/data/actor/templates/common.mjs, release 6.0.6). Loot Ledger writes the new keys only;
 * tests/effects.test.mjs fails on any old one.
 *
 * Shape: Foundry 14 stores an effect's changes under `system.changes`, each `{ key, type, value, phase, priority }`
 * (`type` "add" replaces the old numeric `mode` 2; `phase` "initial" is the first application phase; priority null =
 * the type's default), as dnd5e 6.0.6's own pack data does.
 */

/** Current dnd5e 6.x change keys, by what they change. `abilityCheck` / `abilitySave` / `skill` take a key. */
export const KEYS = {
  skill: k => `system.skills.${k}.roll.bonus`,
  skillMode: k => `system.skills.${k}.roll.mode`,
  abilityCheck: a => `system.abilities.${a}.check.roll.bonus`,
  abilitySave: a => `system.abilities.${a}.save.roll.bonus`,
  abilitySaveMode: a => `system.abilities.${a}.save.roll.mode`,
  init: "system.attributes.init.roll.bonus",
  initMode: "system.attributes.init.roll.mode",
  concentration: "system.attributes.concentration.roll.bonus",
  concentrationMode: "system.attributes.concentration.roll.mode",
  hpMax: "system.attributes.hp.bonuses.overall",
  spellDC: "system.bonuses.spell.dc",
  ac: "system.attributes.ac.bonus",
  resistance: "system.traits.dr.value",
  weaponAttack: ["system.rolls.attack.mwak.bonus", "system.rolls.attack.rwak.bonus"],
  spellAttack: ["system.rolls.attack.msak.bonus", "system.rolls.attack.rsak.bonus"]
};

/** Old (shimmed, removed in dnd5e 7.0) key patterns Loot Ledger must never write. */
export const DEPRECATED_KEY = /\.bonuses\.(check|save)$|^system\.attributes\.init\.bonus$|^system\.bonuses\.(mwak|rwak|msak|rsak)\.|^system\.bonuses\.abilities\.|^flags\.dnd5e\.initiativeAdv$/;

/** One change in the Foundry 14 shape (always type "add" for Loot Ledger's flat riders). */
export const aeChange = (key, value) => ({ key, type: "add", value: String(value), phase: "initial", priority: null });

/**
 * A transferred effect from a list of changes (null when there are none). Changes live in `system.changes`.
 * @param {{name:string, img?:string, changes:object[], flags?:object}} o
 */
export function effectData({ name, img = "icons/svg/aura.svg", changes, flags = {} }) {
  if (!changes?.length) return null;
  return { name, img, type: "base", transfer: true, disabled: false, system: { changes }, flags };
}

/** An Active Effect's changes: `system.changes` (Foundry 14), or the top-level `changes` of older data. */
export function effectChanges(fx) {
  const c = fx?.system?.changes ?? fx?.changes;
  return Array.isArray(c) ? c : [];
}

/**
 * The change type of a change: Foundry 14 `type`, or the old numeric `mode` (0 custom, 1 multiply, 2 add, 3 downgrade,
 * 4 upgrade, 5 override), as dnd5e's own property attribution reads it.
 */
export function changeType(c) {
  if (typeof c?.type === "string" && c.type) return c.type;
  return { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" }[Number(c?.mode)] ?? "add";
}
