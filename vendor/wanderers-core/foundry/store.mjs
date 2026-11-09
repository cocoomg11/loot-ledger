/**
 * The GM-only store journal: the Foundry half. Rules and shapes are in ../store-model.mjs (tested in Node); this file is checked
 * against a fake `game` only (tests/store.test.mjs), the real journal writes need a live world.
 *
 * Not secrecy: a None-ownership journal is still sent to every player's client (checked on 14.369). See the model file and
 * docs/store.md. It keeps GM-only data out of world settings and player-facing windows; it is an honour system.
 */
import {
  defineStore, storeEntries, rawData, storeCreateData, needsFiling, storeGet, storeWith, storeWithKey, storeDeletions, deletionKeys,
  storeSize, storeKeys, STORE_FILED_FLAG
} from "../store-model.mjs";
import { fileInDataFolder, ensureDataFolder, removeDataFolderIfEmpty, mergeDataFolders } from "./data-folder.mjs";

/** @returns {any} */
function game() { return /** @type {any} */ (globalThis).game; }

/**
 * @typedef {object} Store
 * @property {() => any} entry the store's JournalEntry, or null (players: always null; they never look)
 * @property {() => any} read the normalized data (GM); players and a missing store get the normalized empty value
 * @property {(key?: string, fallback?: any) => any} get with no key, the same as `read()`; with a key, that key's value or `fallback`
 *   (players always get `fallback`). Values are a cached copy: never change them in place, use `update`.
 * @property {(fn: (data: any) => any) => Promise<any>} update GM only: `fn(current) → next` (pure; may be async), chained so
 *   updates run one at a time; creates the entry on the first write. Resolves to the new data; rejects for players, over the size
 *   limit, or when the write fails (the chain carries on).
 * @property {(key: string, value: any) => Promise<any>} set GM only: one key (`undefined` removes it)
 * @property {(key: string, sub: string, value: any) => Promise<any>} setKey GM only: one entry of a keyed object (null removes it)
 * @property {() => Promise<any>} ensure GM only: the entry, created (and filed) when missing; null when it can't be made
 * @property {() => Promise<boolean>} file writer only: files a root-level entry in the "Module data" folder once (idempotent), and
 *   (0.5.1) when several "Module data" folders exist, moves this module's own entries into the picked one and deletes emptied extras;
 *   resolves to true only when a root-level entry was filed
 * @property {() => Promise<number>} remove GM only: deletes the store entry (all of them if there are several) and the "Module data"
 *   folder when nothing else is in it; resolves to how many entries were deleted
 * @property {() => { exists: boolean, count: number, name: string, id: string, bytes: number, playersCanSee: string[], keys: string[] }} status
 *   for a health check (GM; players get `exists: false`)
 * @property {import("../store-model.mjs").StoreSpec} spec the checked definition
 * @property {string} moduleId
 */

/**
 * A GM-only store bound to one module. Nothing happens until it is used: no hooks, no writes at creation.
 * @param {string} moduleId
 * @param {import("../store-model.mjs").StoreSpecInput & { log?: { warn?: (...a: any[]) => void }, isWriter?: () => boolean }} options
 *   `isWriter`: whether this client does automatic work such as filing the entry (default: the active GM; pass the leader's
 *   `isLeader`)
 * @returns {Store}
 */
export function createStore(moduleId, options) {
  if (typeof moduleId !== "string" || !moduleId) throw new Error("createStore(): module id is required");
  const { log, isWriter, ...rest } = options ?? /** @type {any} */ ({});
  const spec = defineStore(/** @type {any} */ (rest));
  const base = `flags.${moduleId}.${spec.flagKey}`;
  const warn = (/** @type {any[]} */ ...a) => {
    try { (typeof log?.warn === "function" ? log.warn : (/** @type {any[]} */ ...b) => console.warn(`${moduleId} |`, ...b))(...a); } catch { /* never throw */ }
  };
  const isGM = () => { try { return !!game()?.user?.isGM; } catch { return false; } };
  const writer = () => {
    try {
      if (typeof isWriter === "function") return !!isWriter();
      const g = game(); const a = g?.users?.activeGM;
      return !!g?.user?.isGM && (a ? a.id === g.user.id : true);
    } catch { return false; }
  };

  const entries = () => { try { return storeEntries(game()?.journal ?? [], moduleId, spec); } catch { return []; } };
  const entry = () => (isGM() ? entries()[0] ?? null : null);

  // Normalizing clones the data, so the result is kept until the entry changes: same stored object AND same modification stamp
  // (Foundry may merge an update into the stored object in place, so identity alone isn't enough), and dropped after our own writes.
  const NONE = Symbol("none");
  /** @type {{ raw: unknown, stamp: unknown, value: any }} */
  let cache = { raw: NONE, stamp: NONE, value: undefined };
  const stampOf = (/** @type {any} */ j) => { try { return j?._stats?.modifiedTime ?? null; } catch { return null; } };
  const read = () => {
    const j = entry();
    const raw = j ? rawData(j, moduleId, spec) : null;
    const stamp = stampOf(j);
    if (raw !== cache.raw || stamp !== cache.stamp) cache = { raw, stamp, value: spec.normalize(raw) };
    return cache.value;
  };
  const forget = () => { cache = { raw: NONE, stamp: NONE, value: undefined }; };

  /** @type {Promise<any> | null} */
  let creating = null;
  async function ensure() {
    if (!isGM()) return null;
    const j = entry(); if (j) return j;
    creating ??= (async () => {
      const folder = spec.dataFolder ? await ensureDataFolder(moduleId, { log }) : null;
      const none = /** @type {any} */ (globalThis).CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
      return /** @type {any} */ (globalThis).JournalEntry.create(storeCreateData(moduleId, spec, { none, folder: folder?.id ?? null }));
    })().finally(() => { creating = null; });
    return creating;
  }

  async function file() {
    try {
      if (!writer()) return false;
      const j = entry();
      // Several "Module data" folders (modules created it at the same moment): move our own entries into the picked one and drop
      // the extra folders once empty. Runs on every call (cheap when there is one folder), filed or not.
      if (spec.dataFolder && j) await mergeDataFolders(moduleId, { entries: entries(), log });
      if (!needsFiling(j, moduleId, spec)) return false;
      const moved = await fileInDataFolder(moduleId, j, { log });
      // Marked once it sits in a folder (ours, or one the GM chose), so a GM moving it later keeps their choice; a failed move
      // leaves it unmarked and is tried again next time.
      const folder = j.folder?.id ?? j.folder;
      if (folder) await j.update({ [`flags.${moduleId}.${STORE_FILED_FLAG}`]: true });
      return moved;
    } catch (e) { warn("GM-only store: couldn't file the entry", e); return false; }
  }

  let chain = Promise.resolve();
  /** @param {(data: any) => any} fn */
  function update(fn) {
    if (!isGM()) return Promise.reject(new Error(`${moduleId}: only a GM can change the GM-only records`));
    const run = chain.then(async () => {
      const j = await ensure();
      if (!j) throw new Error(`${moduleId}: couldn't create the GM-only store`);
      const prev = spec.normalize(rawData(j, moduleId, spec));
      const next = spec.normalize(await fn(structuredClone(prev)));
      const size = storeSize(next, spec);
      if (!size.ok) throw new Error(`${moduleId}: the GM-only store would be ${size.bytes} bytes (limit ${size.max}); nothing was written`);
      const del = deletionKeys(storeDeletions(prev, next, base, spec.deleteDepth), /** @type {any} */ (globalThis)._del);
      try { await j.update({ [base]: next, ...del }); } finally { forget(); }
      return next;
    });
    chain = run.then(() => undefined, e => warn("GM-only store: write failed", e));
    return run;
  }

  async function remove() {
    if (!isGM()) return 0;
    const all = entries();
    const ids = all.map(e => String(e.id));
    let n = 0;
    for (const e of all) { try { await e.delete(); n += 1; } catch (err) { warn("GM-only store: couldn't delete the entry", err); } }
    if (spec.dataFolder) await removeDataFolderIfEmpty(moduleId, ids, { log });
    forget();
    return n;
  }

  function status() {
    const all = isGM() ? entries() : [];
    const j = all[0];
    if (!j) return { exists: false, count: 0, name: "", id: "", bytes: 0, playersCanSee: [], keys: [] };
    /** @type {string[]} */
    let see = [];
    try { see = Array.from(game().users ?? []).filter((/** @type {any} */ u) => !u.isGM && j.testUserPermission?.(u, "LIMITED")).map((/** @type {any} */ u) => String(u.name)); } catch { /* no users */ }
    return { exists: true, count: all.length, name: String(j.name ?? ""), id: String(j.id ?? ""), bytes: storeSize(rawData(j, moduleId, spec), spec).bytes, playersCanSee: see, keys: Object.keys(storeKeys(read(), spec)) };
  }

  return {
    spec, moduleId, entry, read, ensure, file, update, remove, status,
    get(key, fallback = null) {
      if (key === undefined) return read();
      return isGM() ? storeGet(read(), spec, key, fallback) : fallback;
    },
    set: (key, value) => update(d => storeWith(d, spec, key, value)),
    setKey: (key, sub, value) => update(d => storeWithKey(d, spec, key, sub, value))
  };
}
