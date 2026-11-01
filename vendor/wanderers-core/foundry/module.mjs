/**
 * The Foundry halves of the feature registry, the settings table and debug logging, each bound to the host module's id. Thin wrappers
 * over game.settings; the rules are in ../features-model.mjs and ../settings-model.mjs (tested in Node). Untested in Node: needs a
 * live world (settings registration and reads).
 *
 * Nothing here is shared between modules: every function takes the module id and every setting is registered in that module's own
 * namespace.
 */
import { defineFeatures, isOn, allOn } from "../features-model.mjs";
import { defineSettings, registration } from "../settings-model.mjs";

const g = () => /** @type {any} */ (globalThis).game;
const TYPE = { bool: Boolean, text: String, number: Number, choice: String, object: Object, array: Array };

/**
 * Reads a setting of `ns`, or undefined when it isn't registered (yet).
 * @param {string} ns
 * @param {string} key
 * @returns {unknown}
 */
export function getSetting(ns, key) { try { return g().settings.get(ns, key); } catch { return undefined; } }

/**
 * The feature registry for one module.
 * @param {string} id the module id
 * @param {import("../features-model.mjs").FeatureInput[]} list
 * @param {{ title?: string, where?: string }} [opts] title: module title for warnings; where: "Features tab" wording
 */
export function createFeatures(id, list, { title = id, where = "Features" } = {}) {
  const FEATURES = defineFeatures(list);
  const get = (/** @type {string} */ key) => g().settings.get(id, key);
  const byId = (/** @type {string} */ f) => FEATURES.find(x => x.id === f);
  return {
    FEATURES,
    /** Whether a tool is on in this world (unknown ids count as on; a tool whose needs are off is off). */
    on: (/** @type {string} */ f) => isOn(FEATURES, f, get),
    /** Whether every tool in "a" or "a:b" is on. */
    allOn: (/** @type {string | null | undefined} */ spec) => allOn(FEATURES, spec, get),
    /** For API entry points: warns and returns false when the tool is off. */
    need(/** @type {string} */ f) {
      if (isOn(FEATURES, f, get)) return true;
      try { /** @type {any} */ (globalThis).ui.notifications.warn(`${byId(f)?.label ?? f} is turned off in ${title} › ${where}.`); } catch { /* no UI yet */ }
      return false;
    },
    /** Registers one world setting per tool (call in "init"). `config: true` also lists them in Configure Settings. */
    register({ config = false } = {}) {
      for (const f of FEATURES) g().settings.register(id, f.key, { name: `Feature: ${f.label}`, hint: f.hint, scope: "world", config, type: Boolean, default: f.default, requiresReload: true });
    },
    list: () => FEATURES.map(f => ({ id: f.id, label: f.label, on: isOn(FEATURES, f.id, get) }))
  };
}

/**
 * The settings table for one module.
 * @param {string} id the module id
 * @param {import("../settings-model.mjs").SettingRow[]} rows
 * @param {{ reserved?: Iterable<string> }} [opts] keys already taken (pass the feature keys)
 */
export function createSettings(id, rows, opts = {}) {
  const ROWS = defineSettings(rows, opts);
  return {
    ROWS,
    /** Registers every row (call in "init"). */
    register() {
      for (const r of ROWS) {
        const cfg = registration(r);
        cfg.type = TYPE[r.type];
        g().settings.register(id, r.key, cfg);
      }
    },
    get: (/** @type {string} */ key) => getSetting(id, key),
    set: (/** @type {string} */ key, /** @type {unknown} */ v) => g().settings.set(id, key, v)
  };
}

/**
 * Every registered setting of `ns` as { key, scope, value, default } (for export, cleanup and reset).
 * @param {string} ns
 * @returns {{ key: string, scope: string, value: unknown, default: unknown }[]}
 */
export function settingValues(ns) {
  const out = [];
  for (const [, c] of g().settings.settings) {
    if (c.namespace !== ns) continue;
    let value; try { value = g().settings.get(ns, c.key); } catch { continue; }
    out.push({ key: c.key, scope: c.scope, value, default: c.default });
  }
  return out;
}

/**
 * The registered settings of `ns` as a Map key → definition (for settings import).
 * @param {string} ns
 * @returns {Map<string, any>}
 */
export function settingDefs(ns) {
  const out = new Map();
  for (const [, c] of g().settings.settings) if (c.namespace === ns) out.set(c.key, c);
  return out;
}

/**
 * Debug logging for one module: `log(...)` prints only while the module's "Debug logging" setting is on.
 * @param {string} id
 * @param {{ key?: string }} [opts] the setting key (default "debugLog"; the module registers it in its settings table)
 */
export function createLogger(id, { key = "debugLog" } = {}) {
  const debugOn = () => !!getSetting(id, key);
  return {
    debugOn,
    log: (/** @type {unknown[]} */ ...args) => { if (debugOn()) console.log(`${id} [debug] |`, ...args); },
    warn: (/** @type {unknown[]} */ ...args) => console.warn(`${id} |`, ...args)
  };
}
