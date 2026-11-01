/**
 * The GM-only store journal: the pure half (definition, finding the entry, creation data, key helpers, the deletions an update
 * needs, the size guard). No Foundry calls, tested in Node. The Foundry half is ./foundry/store.mjs (`createStore`).
 *
 * A store is ONE journal entry per module with default ownership None and no player owners, holding the module's GM-only records
 * in one flag (`flags.<moduleId>.<flagKey>`). It replaces world settings for data players shouldn't read, because every client
 * receives every world setting.
 *
 * Honesty about what this is: ownership None is NOT secrecy. Checked live on Foundry 14.369: a None-ownership journal entry is still
 * sent to every player's client (it is only left out of their sidebar), and so is a GM-only world compendium. A player who opens the
 * browser console can read it. It is an honour system that keeps GM-only data out of every player-facing window, chat card and
 * setting, nothing more. Never put real secrets (passwords, keys, tokens) in it.
 *
 * Finding the entry (so existing stores are found exactly as each module finds them today; nothing is renamed or moved):
 *   - `entryFlag: "vaultEntry"` → the first journal with `flags.<moduleId>.vaultEntry === true` (the toolkit; the Satchel uses
 *     `"storeEntry"`).
 *   - `entryFlag: null` → the first journal whose data flag `flags.<moduleId>.<flagKey>` is set (truthy) (Red Book).
 *   The entry's name never matters for finding it.
 */
import { versioned } from "./records.mjs";
import { esc } from "./text.mjs";
import { jsonBytes } from "./socket-model.mjs";

/** Default size limit of the stored data, in bytes of JSON (8 MiB). A write over the limit is refused. */
export const STORE_MAX_BYTES = 8 * 1024 * 1024;
/** Default depth of removed-key detection under the data flag (see `storeDeletions`). */
export const STORE_DELETE_DEPTH = 3;
/** Flag (under the module's namespace) marking an entry already filed in (or deliberately kept out of) the "Module data" folder. */
export const STORE_FILED_FLAG = "dataFolderFiled";
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * @typedef {object} StoreSpecInput
 * @property {string} name the journal's name when it is created (found by flag, never by name)
 * @property {string} [flagKey] data flag key: `flags.<moduleId>.<flagKey>` (default "store")
 * @property {string | null} [entryFlag] marker flag set to `true` on the entry (default "storeEntry"); null = the data flag marks it
 * @property {(raw: unknown) => any} [normalize] the one normalizer for the stored data (never throws). Or give `version` + `empty`
 *   (+ `upgrades`, `clean`) and core builds it with `versioned()`.
 * @property {number} [version]
 * @property {() => any} [empty]
 * @property {Record<number, (old: any) => any>} [upgrades]
 * @property {(value: any) => any} [clean]
 * @property {string | null} [keysAt] where `get(key)`, `set` and `setKey` act inside the data: a top-level field holding the keyed
 *   records (the toolkit's "buckets"), or null for the data's own top level (default)
 * @property {string[] | null} [keys] allowed keys for `set`/`setKey` (unknown keys throw: a programming mistake); null = any key
 * @property {number} [maxBytes] size limit of the stored data (default `STORE_MAX_BYTES`)
 * @property {number} [deleteDepth] how deep removed keys are deleted on update (default `STORE_DELETE_DEPTH`)
 * @property {string} [about] plain text for the entry's "About" page (escaped); "" = no page
 * @property {boolean} [dataFolder] file the entry in the shared "Module data" folder (default true)
 */

/**
 * @typedef {object} StoreSpec
 * @property {string} name
 * @property {string} flagKey
 * @property {string | null} entryFlag
 * @property {(raw: unknown) => any} normalize
 * @property {string | null} keysAt
 * @property {string[] | null} keys
 * @property {number} maxBytes
 * @property {number} deleteDepth
 * @property {string} about
 * @property {boolean} dataFolder
 */

/**
 * Checks a store definition and fills the defaults. Throws on mistakes (so a module's tests catch them); everything it returns
 * never throws.
 * @param {StoreSpecInput} spec
 * @returns {StoreSpec}
 */
export function defineStore(spec) {
  if (!spec || typeof spec !== "object") throw new Error("defineStore(): spec must be an object");
  const name = typeof spec.name === "string" ? spec.name.trim() : "";
  if (!name) throw new Error("defineStore(): name is required (the journal's name)");
  const flagKey = spec.flagKey ?? "store";
  if (!KEY_RE.test(flagKey)) throw new Error(`defineStore(): bad flagKey ${flagKey}`);
  const entryFlag = spec.entryFlag === undefined ? "storeEntry" : spec.entryFlag;
  if (entryFlag !== null && (!KEY_RE.test(entryFlag) || entryFlag === flagKey)) throw new Error(`defineStore(): bad entryFlag ${entryFlag}`);
  if (entryFlag === STORE_FILED_FLAG || flagKey === STORE_FILED_FLAG) throw new Error(`defineStore(): ${STORE_FILED_FLAG} is reserved`);
  /** @type {(raw: unknown) => any} */
  let normalize;
  if (typeof spec.normalize === "function") normalize = spec.normalize;
  else if (spec.version !== undefined) {
    if (typeof spec.empty !== "function") throw new Error("defineStore(): give empty() with version");
    const version = spec.version; const userClean = spec.clean;
    // The version field is always written, even when empty() and clean() leave it out (versioned() sets it only on stored values).
    const clean = (/** @type {any} */ x) => { const c = userClean ? userClean(x) : x; return c && typeof c === "object" && !Array.isArray(c) ? { ...c, v: version } : c; };
    normalize = versioned({ version, empty: spec.empty, upgrades: spec.upgrades, clean });
  } else normalize = raw => (raw && typeof raw === "object" && !Array.isArray(raw) ? structuredClone(raw) : {});
  const keysAt = spec.keysAt ?? null;
  if (keysAt !== null && !KEY_RE.test(keysAt)) throw new Error(`defineStore(): bad keysAt ${keysAt}`);
  const keys = spec.keys ?? null;
  if (keys !== null && (!Array.isArray(keys) || keys.some(k => typeof k !== "string" || !k))) throw new Error("defineStore(): keys must be a list of names");
  const maxBytes = spec.maxBytes ?? STORE_MAX_BYTES;
  if (!(Number.isFinite(maxBytes) && maxBytes > 0)) throw new Error("defineStore(): maxBytes must be a positive number");
  const deleteDepth = spec.deleteDepth ?? STORE_DELETE_DEPTH;
  if (!Number.isInteger(deleteDepth) || deleteDepth < 0 || deleteDepth > 6) throw new Error("defineStore(): deleteDepth must be 0 to 6");
  return {
    name, flagKey, entryFlag, normalize, keysAt, keys: keys ? [...keys] : null, maxBytes, deleteDepth,
    about: typeof spec.about === "string" ? spec.about : "", dataFolder: spec.dataFolder !== false
  };
}

/** @param {any} entry @param {string} moduleId @returns {Record<string, any> | null} */
function ownFlags(entry, moduleId) {
  try {
    const f = entry?.flags?.[moduleId];
    return f && typeof f === "object" ? f : null;
  } catch { return null; }
}

/**
 * Whether a journal entry is this module's store (by the marker flag, or by the data flag when `entryFlag` is null). Never throws.
 * @param {any} entry @param {string} moduleId @param {StoreSpec} spec
 */
export function isStoreEntry(entry, moduleId, spec) {
  const f = ownFlags(entry, moduleId);
  if (!f) return false;
  return spec.entryFlag ? f[spec.entryFlag] === true : !!f[spec.flagKey];
}

/**
 * The store entries among `entries`, in their order (normally one; more only if two GMs created one at the same moment).
 * @param {Iterable<any>} entries @param {string} moduleId @param {StoreSpec} spec
 * @returns {any[]}
 */
export function storeEntries(entries, moduleId, spec) {
  try { return Array.from(entries ?? []).filter(e => isStoreEntry(e, moduleId, spec)); } catch { return []; }
}

/**
 * The raw stored data of an entry (not normalized), or null.
 * @param {any} entry @param {string} moduleId @param {StoreSpec} spec
 */
export function rawData(entry, moduleId, spec) {
  return ownFlags(entry, moduleId)?.[spec.flagKey] ?? null;
}

/**
 * The creation data for a new store entry: name, ownership `{ default: none }`, the flags (marker + normalized empty data + filed
 * marker when a folder is given), the About page, the folder.
 * @param {string} moduleId
 * @param {StoreSpec} spec
 * @param {{ none?: number, folder?: string | null, data?: unknown }} [opts] `none`: Foundry's NONE ownership level (0)
 */
export function storeCreateData(moduleId, spec, { none = 0, folder = null, data } = {}) {
  /** @type {Record<string, any>} */
  const flags = { [spec.flagKey]: spec.normalize(data ?? null) };
  if (spec.entryFlag) flags[spec.entryFlag] = true;
  if (folder) flags[STORE_FILED_FLAG] = true;
  /** @type {Record<string, any>} */
  const out = { name: spec.name, ownership: { default: none }, flags: { [moduleId]: flags } };
  if (folder) out.folder = folder;
  if (spec.about) out.pages = [{ name: "About", type: "text", text: { format: 1, content: `<p>${esc(spec.about)}</p>` } }];
  return out;
}

/**
 * Whether the entry still has to be filed in the "Module data" folder: the spec wants it and the entry has no filed marker. (The
 * entry is filed once; a GM who moves it afterwards, even back to the root, keeps their choice.)
 * @param {any} entry @param {string} moduleId @param {StoreSpec} spec
 */
export function needsFiling(entry, moduleId, spec) {
  return !!entry && spec.dataFolder && ownFlags(entry, moduleId)?.[STORE_FILED_FLAG] !== true;
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The keyed records (`keysAt` field, or the data itself), as a plain object.
 * @param {any} data normalized data @param {StoreSpec} spec
 * @returns {Record<string, any>}
 */
export function storeKeys(data, spec) {
  const at = spec.keysAt ? data?.[spec.keysAt] : data;
  return isObj(at) ? at : {};
}

/**
 * One key's value, or `fallback`.
 * @param {any} data normalized data @param {StoreSpec} spec @param {string} key @param {any} [fallback]
 */
export function storeGet(data, spec, key, fallback = null) {
  const k = storeKeys(data, spec);
  return Object.prototype.hasOwnProperty.call(k, key) ? k[key] : fallback;
}

/** @param {StoreSpec} spec @param {string} key */
function checkKey(spec, key) {
  if (typeof key !== "string" || !key) throw new Error("store: key must be a non-empty string");
  if (spec.keys && !spec.keys.includes(key)) throw new Error(`store: unknown key ${key}`);
}

/**
 * New data with `key` set to `value` (or removed when `value` is undefined), normalized. Unknown keys throw.
 * @param {any} data @param {StoreSpec} spec @param {string} key @param {any} value
 */
export function storeWith(data, spec, key, value) {
  checkKey(spec, key);
  const d = spec.normalize(data);
  const k = { ...storeKeys(d, spec) };
  if (value === undefined) delete k[key]; else k[key] = value;
  return spec.normalize(spec.keysAt ? { ...d, [spec.keysAt]: k } : k);
}

/**
 * New data with `sub` inside the keyed object `key` set to `value` (or removed when `value` is null or undefined).
 * @param {any} data @param {StoreSpec} spec @param {string} key @param {string} sub @param {any} value
 */
export function storeWithKey(data, spec, key, sub, value) {
  checkKey(spec, key);
  const cur = storeGet(spec.normalize(data), spec, key, {});
  const obj = { ...(isObj(cur) ? cur : {}) };
  if (value === null || value === undefined) delete obj[sub]; else obj[sub] = value;
  return storeWith(data, spec, key, obj);
}

/**
 * The paths (dotted, under `base`) of keys present in `prev` and gone from `next`, down to `depth` levels of plain objects. Foundry
 * merges object updates, so a removed key would otherwise stay. Arrays are replaced whole and need nothing.
 * @param {unknown} prev @param {unknown} next @param {string} base e.g. "flags.my-module.store"
 * @param {number} [depth]
 * @returns {string[]}
 */
export function storeDeletions(prev, next, base, depth = STORE_DELETE_DEPTH) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {unknown} */ a, /** @type {unknown} */ b, /** @type {string} */ path, /** @type {number} */ d) => {
    if (!isObj(a) || !isObj(b) || d < 1) return;
    for (const k of Object.keys(a)) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) out.push(`${path}.${k}`);
      else walk(a[k], b[k], `${path}.${k}`, d - 1);
    }
  };
  walk(prev, next, base, depth);
  return out;
}

/**
 * The update keys that delete `paths`: v14's deletion operator when given (`globalThis._del`), else the "-=" key on the last part
 * (v13; v14 still reads it).
 * @param {string[]} paths @param {unknown} [del] the deletion operator, or undefined
 * @returns {Record<string, any>}
 */
export function deletionKeys(paths, del) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const p of paths) {
    if (del !== undefined && del !== null) { out[p] = del; continue; }
    const i = p.lastIndexOf(".");
    out[`${p.slice(0, i)}.-=${p.slice(i + 1)}`] = null;
  }
  return out;
}

/**
 * The size check before a write: { ok, bytes, max }.
 * @param {unknown} data @param {StoreSpec} spec
 */
export function storeSize(data, spec) {
  const bytes = jsonBytes(data);
  return { ok: bytes <= spec.maxBytes, bytes, max: spec.maxBytes };
}
