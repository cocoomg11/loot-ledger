/**
 * Keybindings that open a module's windows: the Foundry half, a thin wrapper over `game.keybindings.register`. The checks and the
 * config shape are in ../keybinding-model.mjs, tested in Node. Untested in Node: needs a live client (Configure Controls, key
 * presses).
 *
 * Call in the "init" hook (Foundry reads registered keybindings when it initializes them). By default no key is assigned: the action
 * shows in Configure Controls under the module and each user picks a key. Pass `editable` only for a default you are sure doesn't
 * clash with Foundry or other modules.
 */
import { defineOpenKeybinding, keybindingConfig } from "../keybinding-model.mjs";

/**
 * Registers one keybinding action in the module's namespace.
 * @param {import("../keybinding-model.mjs").OpenKeybindingInput & { moduleId: string }} spec
 * @returns {Readonly<import("../keybinding-model.mjs").OpenKeybinding>} the checked definition
 */
export function registerOpenKeybinding(spec) {
  const moduleId = spec?.moduleId;
  if (typeof moduleId !== "string" || !moduleId) throw new Error("registerOpenKeybinding: moduleId is required");
  const def = defineOpenKeybinding(spec);
  const game = /** @type {any} */ (globalThis).game;
  game.keybindings.register(moduleId, def.action, keybindingConfig(def, {
    isGM: () => !!(/** @type {any} */ (globalThis).game?.user?.isGM),
    onError: e => console.error(`${moduleId} | keybinding ${def.action} failed`, e)
  }));
  return def;
}
