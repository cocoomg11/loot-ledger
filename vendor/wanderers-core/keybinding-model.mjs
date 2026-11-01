/**
 * Keybindings that open a module's windows: the pure half (checking the definition, building Foundry's KeybindingActionConfig).
 * No Foundry calls, tested in Node. The Foundry half is ../foundry/keybinding.mjs (`registerOpenKeybinding`).
 *
 * Foundry's shape (KeybindingActionConfig, v13/v14): `{ name, hint, editable: [{ key, modifiers }], onDown, restricted, precedence }`;
 * `key` is a KeyboardEvent#code ("KeyB", "Digit1", "F5"), `modifiers` come from KeyboardManager.MODIFIER_KEYS. `restricted: true`
 * means only a GM can edit and run the action. `onDown` returning true consumes the key press.
 */

/** Modifier names Foundry accepts (KeyboardManager.MODIFIER_KEYS values). */
export const KEY_MODIFIERS = /** @type {const} */ (["Alt", "Control", "Shift"]);
/** Action ids: letters, digits, "_" and "-", starting with a letter (1 to 64). */
export const ACTION_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** A KeyboardEvent#code: letters and digits, starting with a letter ("KeyB", "Digit1", "F5", "BracketLeft"). */
export const KEY_CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

/** @typedef {{ key: string, modifiers: string[] }} KeyBinding */
/**
 * @typedef {object} OpenKeybindingInput
 * @property {string} action the action id, unique in the module (e.g. "openHub")
 * @property {string} name the label in Configure Controls (pass the final, translated text)
 * @property {string} [hint]
 * @property {(context: any) => unknown} onDown what the key does (usually opens or focuses a window)
 * @property {boolean} [gmOnly] only GMs see, edit and run it (Foundry `restricted`)
 * @property {{ key: string, modifiers?: string[] }[]} [editable] default keys (default none: users choose in Configure Controls)
 * @property {number} [precedence] Foundry's CONST.KEYBINDING_PRECEDENCE value (default Foundry's own)
 */
/** @typedef {{ action: string, name: string, hint: string, gmOnly: boolean, editable: KeyBinding[], precedence?: number, onDown: (context: any) => unknown }} OpenKeybinding */

/**
 * Checks a keybinding definition and returns it cleaned (frozen). Throws on mistakes (module tests catch them): a bad action id,
 * a missing name or onDown, a key that isn't a KeyboardEvent#code, an unknown modifier, a repeated binding.
 * @param {OpenKeybindingInput} spec
 * @returns {Readonly<OpenKeybinding>}
 */
export function defineOpenKeybinding(spec) {
  const fail = (/** @type {string} */ m) => { throw new Error(`keybinding ${JSON.stringify(spec?.action)}: ${m}`); };
  if (!spec || typeof spec !== "object") throw new Error("keybinding: the definition should be an object");
  if (typeof spec.action !== "string" || !ACTION_RE.test(spec.action)) fail("the action id should be letters, digits, _ or - (starting with a letter)");
  if (typeof spec.name !== "string" || !spec.name.trim()) fail("name is required (the label in Configure Controls)");
  if (spec.hint !== undefined && typeof spec.hint !== "string") fail("hint should be text");
  if (typeof spec.onDown !== "function") fail("onDown should be a function");
  if (spec.gmOnly !== undefined && typeof spec.gmOnly !== "boolean") fail("gmOnly should be true or false");
  if (spec.precedence !== undefined && !Number.isInteger(spec.precedence)) fail("precedence should be an integer (CONST.KEYBINDING_PRECEDENCE)");
  if (spec.editable !== undefined && !Array.isArray(spec.editable)) fail("editable should be a list of { key, modifiers }");
  /** @type {KeyBinding[]} */
  const editable = [];
  const seen = new Set();
  for (const b of spec.editable ?? []) {
    if (!b || typeof b !== "object" || typeof b.key !== "string" || !KEY_CODE_RE.test(b.key)) fail(`bad key ${JSON.stringify(b?.key)} (use a KeyboardEvent code such as "KeyB")`);
    const mods = b.modifiers ?? [];
    if (!Array.isArray(mods)) fail("modifiers should be a list");
    for (const m of mods) if (!KEY_MODIFIERS.includes(/** @type {any} */ (m))) fail(`unknown modifier ${JSON.stringify(m)} (use ${KEY_MODIFIERS.join(", ")})`);
    const modifiers = KEY_MODIFIERS.filter(m => mods.includes(m));
    const id = [...modifiers, b.key].join("+");
    if (seen.has(id)) fail(`the binding ${id} is listed twice`);
    seen.add(id);
    editable.push({ key: b.key, modifiers });
  }
  return Object.freeze({
    action: spec.action, name: spec.name, hint: spec.hint ?? "", gmOnly: spec.gmOnly === true, editable,
    ...(spec.precedence !== undefined ? { precedence: spec.precedence } : {}), onDown: spec.onDown
  });
}

/**
 * Foundry's KeybindingActionConfig for a checked definition. `onDown` is wrapped: it runs the module's function only for GMs when
 * gmOnly (Foundry's `restricted` also blocks it), never lets an error or a rejected promise escape into Foundry's key handling
 * (`onError` gets it), and returns true (the key press is consumed) when it ran.
 * @param {Readonly<OpenKeybinding>} def from defineOpenKeybinding
 * @param {{ isGM: () => boolean, onError?: (e: unknown) => void }} env
 * @returns {{ name: string, hint: string, editable: KeyBinding[], restricted: boolean, onDown: (context: any) => boolean, precedence?: number }}
 */
export function keybindingConfig(def, { isGM, onError = () => {} }) {
  return {
    name: def.name, hint: def.hint, editable: def.editable.map(b => ({ key: b.key, modifiers: [...b.modifiers] })),
    restricted: def.gmOnly,
    ...(def.precedence !== undefined ? { precedence: def.precedence } : {}),
    onDown(context) {
      if (def.gmOnly && !isGM()) return false;
      try {
        const r = /** @type {any} */ (def.onDown(context));
        if (r && typeof r.then === "function") r.then(undefined, onError);
      } catch (e) { onError(e); }
      return true;
    }
  };
}
