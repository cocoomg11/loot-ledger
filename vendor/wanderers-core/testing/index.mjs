/**
 * wanderers-core: test fakes. DEV ONLY, NOT FOR RUNTIME: never import this from a module's scripts. It ships in the vendored copy
 * (`vendor/wanderers-core/testing/`) so a module's Node tests can use the same fakes as core's own, and a module's release zip leaves
 * it out (`-x 'vendor/wanderers-core/testing/*'`, docs/module-ci.md).
 *
 * These are small stand-ins for the parts of Foundry that core's Foundry halves touch: `game` (user, users, settings, modules,
 * journal, folders, socket), `Hooks`, `JournalEntry` / `Folder` documents with flags, dotted updates, "-=" and operator deletions and
 * ownership, and an ApplicationV2 base with the documented lifecycle methods. They check a module's own wiring (what it reads, writes,
 * registers and refuses), not Foundry: anything they pass still needs a live world.
 */

/** The ownership levels (Foundry's CONST.DOCUMENT_OWNERSHIP_LEVELS). */
export const OWNERSHIP = Object.freeze({ INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 });

/** A stand-in for v14's deletion operator (`_del`), installed by `installFakes({ deletionOperator: true })`. */
export const FAKE_DEL = Object.freeze({ fakeDeletion: true });

let ids = 0;
/** A 16-character id, unique within the process. @param {string} [prefix] */
export function fakeId(prefix = "fk") {
  ids += 1;
  return `${prefix}${String(ids).padStart(16 - prefix.length, "0")}`.slice(0, 16);
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Applies a Foundry-style update to a plain object: dotted keys, objects merged recursively, "-=key" deletes `key`, the deletion
 * operator (`FAKE_DEL`, or `del`) deletes the key. Changes `target` in place and returns it.
 * @param {Record<string, any>} target @param {Record<string, any>} data @param {unknown} [del]
 */
export function applyUpdate(target, data, del = FAKE_DEL) {
  for (const [key, value] of Object.entries(data ?? {})) {
    const parts = key.split(".");
    let obj = target;
    for (const p of parts.slice(0, -1)) { if (!isObj(obj[p])) obj[p] = {}; obj = obj[p]; }
    const last = /** @type {string} */ (parts.at(-1));
    if (last.startsWith("-=")) { delete obj[last.slice(2)]; continue; }
    if (value === del || value === FAKE_DEL) { delete obj[last]; continue; }
    if (isObj(value) && isObj(obj[last])) applyUpdate(obj[last], value, del);
    else obj[last] = isObj(value) || Array.isArray(value) ? structuredClone(value) : value;
  }
  return target;
}

/**
 * Fake Hooks: `on`, `once`, `off`, `call`, `callAll`; `calls` records every call/callAll as [name, args].
 */
export function fakeHooks() {
  /** @type {Map<string, { id: number, fn: Function, once: boolean }[]>} */
  const map = new Map();
  let n = 0;
  const hooks = {
    /** @type {[string, any[]][]} */ calls: [],
    /** @param {string} name @param {Function} fn */
    on(name, fn) { n += 1; (map.get(name) ?? map.set(name, []).get(name))?.push({ id: n, fn, once: false }); return n; },
    /** @param {string} name @param {Function} fn */
    once(name, fn) { n += 1; (map.get(name) ?? map.set(name, []).get(name))?.push({ id: n, fn, once: true }); return n; },
    /** @param {string} name @param {number | Function} idOrFn */
    off(name, idOrFn) { const l = map.get(name); if (l) map.set(name, l.filter(h => h.id !== idOrFn && h.fn !== idOrFn)); },
    /** @param {string} name @param {...any} args */
    callAll(name, ...args) { hooks.calls.push([name, args]); for (const h of [...(map.get(name) ?? [])]) { if (h.once) hooks.off(name, h.id); h.fn(...args); } return true; },
    /** @param {string} name @param {...any} args */
    call(name, ...args) { hooks.calls.push([name, args]); for (const h of [...(map.get(name) ?? [])]) { if (h.once) hooks.off(name, h.id); if (h.fn(...args) === false) return false; } return true; },
    /** @param {string} name */
    listeners(name) { return (map.get(name) ?? []).length; }
  };
  return hooks;
}

/**
 * A collection like Foundry's (Map keyed by id, iterates values, `find`/`filter`/`map`/`some`, `contents`, `getName`).
 * @param {any[]} [items]
 */
export function fakeCollection(items = []) {
  const c = /** @type {Map<string, any> & Record<string, any>} */ (new Map());
  const it = () => [...Map.prototype.values.call(c)];
  Object.defineProperties(c, {
    [Symbol.iterator]: { value: () => it()[Symbol.iterator]() },
    contents: { get: it },
    find: { value: (/** @type {any} */ f) => it().find(f) },
    filter: { value: (/** @type {any} */ f) => it().filter(f) },
    map: { value: (/** @type {any} */ f) => it().map(f) },
    some: { value: (/** @type {any} */ f) => it().some(f) },
    getName: { value: (/** @type {string} */ name) => it().find(d => d?.name === name) },
    add: { value: (/** @type {any} */ d) => { c.set(String(d.id), d); return d; } }
  });
  for (const i of items) c.add(i);
  return c;
}

/**
 * Fake client settings: `register`, `get` (throws when not registered, like Foundry), `set` (async), `settings` (the definitions
 * Map, keyed "ns.key"); `values` holds what was set. Values are cloned on the way in and out.
 * @param {Map<string, any>} [values] shared between clients for world settings
 */
export function fakeSettings(values = new Map()) {
  /** @type {Map<string, any>} */
  const defs = new Map();
  return {
    settings: defs,
    values,
    /** @param {string} ns @param {string} key @param {any} cfg */
    register(ns, key, cfg) { defs.set(`${ns}.${key}`, { ...cfg, namespace: ns, key }); },
    /** @param {string} ns @param {string} key */
    get(ns, key) {
      const k = `${ns}.${key}`; const d = defs.get(k);
      if (!d) throw new Error(`${k} is not a registered game setting`);
      return values.has(k) ? structuredClone(values.get(k)) : structuredClone(d.default);
    },
    /** @param {string} ns @param {string} key @param {any} v */
    async set(ns, key, v) {
      const k = `${ns}.${key}`; if (!defs.has(k)) throw new Error(`${k} is not a registered game setting`);
      values.set(k, structuredClone(v)); changed(k, v); return v;
    }
  };
  /** @param {string} k @param {any} v */
  function changed(k, v) { const def = defs.get(k); try { def?.onChange?.(v); } catch { /* like Foundry, onChange errors don't undo the write */ } }
}

/**
 * A fake world: every client shares the users, journal, folders and world setting values; each `client(user)` has its own `game`.
 * `installFakes(world, user)` puts one client's `game` and the shared `Hooks`, `JournalEntry`, `Folder`, `CONST`, `ui` on
 * `globalThis` (and returns a function that restores what was there).
 * @param {{ users?: { id?: string, name?: string, isGM?: boolean, active?: boolean }[], modules?: { id: string, active?: boolean }[] }} [opts]
 */
export function fakeWorld({ users = [], modules = [] } = {}) {
  const world = {
    users: fakeCollection(users.map(u => ({ id: u.id ?? fakeId("us"), name: u.name ?? "User", isGM: !!u.isGM, active: u.active !== false }))),
    journal: fakeCollection(),
    folders: fakeCollection(),
    modules: new Map(modules.map(m => [m.id, { id: m.id, active: m.active !== false }])),
    worldSettings: new Map(),
    hooks: fakeHooks(),
    notifications: /** @type {{ level: string, text: string }[]} */ ([]),
    /** @type {{ channel: string, fn: Function, game: any }[]} */ sockets: [],
    /** @type {any} */ current: null,
    /** @param {any} user */
    client(user) {
      const u = typeof user === "string" ? world.users.get(user) : user;
      const game = {
        user: u,
        users: world.users,
        journal: world.journal,
        folders: world.folders,
        modules: world.modules,
        settings: fakeSettings(world.worldSettings),
        keybindings: { registered: /** @type {any[][]} */ ([]), register(/** @type {any[]} */ ...a) { this.registered.push(a); } },
        socket: {
          on: (/** @type {string} */ channel, /** @type {Function} */ fn) => { world.sockets.push({ channel, fn, game }); },
          off: (/** @type {string} */ channel, /** @type {Function} */ fn) => { world.sockets = world.sockets.filter(s => !(s.channel === channel && s.fn === fn && s.game === game)); },
          // Delivers to every OTHER client on the channel, as that client, with the sender's user id (like Foundry's server).
          emit: (/** @type {string} */ channel, /** @type {any} */ msg) => {
            const before = /** @type {any} */ (globalThis).game;
            for (const s of [...world.sockets]) if (s.game !== game && s.channel === channel) {
              /** @type {any} */ (globalThis).game = s.game;
              try { s.fn(structuredClone(msg), u?.id); } finally { /** @type {any} */ (globalThis).game = before; }
            }
          }
        }
      };
      Object.defineProperty(game.users, "activeGM", { configurable: true, get: () => world.users.find((/** @type {any} */ x) => x.isGM && x.active) ?? null });
      return game;
    }
  };
  return world;
}

/**
 * A fake document with flags, ownership, `getFlag`, `setFlag`, `unsetFlag`, `update` (dotted keys, merges, deletions), `delete`
 * and `testUserPermission`.
 * @param {any} world @param {"journal" | "folders"} collection @param {Record<string, any>} data
 */
function fakeDocument(world, collection, data) {
  const doc = /** @type {Record<string, any>} */ ({ id: data._id ?? data.id ?? fakeId(collection === "journal" ? "je" : "fo"), name: "", flags: {}, ownership: { default: OWNERSHIP.NONE }, folder: null, _stats: { modifiedTime: 1 }, ...structuredClone({ ...data, _id: undefined }) });
  delete doc._id;
  Object.defineProperties(doc, {
    documentName: { value: collection === "journal" ? "JournalEntry" : "Folder" },
    getFlag: { value: (/** @type {string} */ ns, /** @type {string} */ key) => key.split(".").reduce((/** @type {any} */ o, p) => o?.[p], doc.flags?.[ns]) },
    setFlag: { value: async (/** @type {string} */ ns, /** @type {string} */ key, /** @type {any} */ v) => doc.update({ [`flags.${ns}.${key}`]: v }) },
    unsetFlag: { value: async (/** @type {string} */ ns, /** @type {string} */ key) => doc.update({ [`flags.${ns}.-=${key}`]: null }) },
    // Like Foundry: merged in place (the flags object keeps its identity) and `_stats.modifiedTime` moves on.
    update: { value: async (/** @type {Record<string, any>} */ d) => { world.updates = (world.updates ?? 0) + 1; applyUpdate(doc, d, /** @type {any} */ (globalThis)._del); doc._stats = { ...(doc._stats ?? {}), modifiedTime: (doc._stats?.modifiedTime ?? 0) + 1 }; return doc; } },
    delete: { value: async () => { world[collection].delete(String(doc.id)); doc.deleted = true; return doc; } },
    testUserPermission: {
      value: (/** @type {any} */ user, /** @type {string | number} */ lvl) => {
        if (user?.isGM) return true;
        const need = typeof lvl === "number" ? lvl : /** @type {any} */ (OWNERSHIP)[lvl] ?? OWNERSHIP.OWNER;
        const own = doc.ownership?.[user?.id] ?? doc.ownership?.default ?? OWNERSHIP.NONE;
        return own >= need;
      }
    }
  });
  return world[collection].add(doc);
}

/**
 * Installs one client of `world` on `globalThis` (`game`, plus shared `Hooks`, `JournalEntry`, `Folder`, `CONST`, `ui`) and returns
 * `restore()`. `deletionOperator: true` also sets `globalThis._del` to `FAKE_DEL` (v14 style deletions); default leaves it unset
 * (v13 "-=" keys).
 * @param {ReturnType<typeof fakeWorld>} world @param {any} user a user from `world.users` (or its id)
 * @param {{ deletionOperator?: boolean }} [opts]
 * @returns {() => void}
 */
export function installFakes(world, user, { deletionOperator = false } = {}) {
  const g = /** @type {any} */ (globalThis);
  const names = ["game", "Hooks", "JournalEntry", "Folder", "CONST", "ui", "_del"];
  const before = Object.fromEntries(names.map(n => [n, g[n]]));
  g.game = world.client(user);
  world.current = g.game;
  g.Hooks = world.hooks;
  g.JournalEntry = { create: async (/** @type {any} */ d) => fakeDocument(world, "journal", d) };
  g.Folder = { create: async (/** @type {any} */ d) => fakeDocument(world, "folders", d) };
  g.CONST = { DOCUMENT_OWNERSHIP_LEVELS: OWNERSHIP };
  const note = (/** @type {string} */ level) => (/** @type {any} */ text) => { world.notifications.push({ level, text: String(text) }); };
  g.ui = { notifications: { info: note("info"), warn: note("warn"), error: note("error") } };
  if (deletionOperator) g._del = FAKE_DEL; else delete g._del;
  return () => { for (const n of names) { if (before[n] === undefined) delete g[n]; else g[n] = before[n]; } };
}

/**
 * Switches `globalThis.game` to another user's client of the same world (keeping the other globals). Returns that `game`.
 * @param {ReturnType<typeof fakeWorld>} world @param {any} user
 */
export function actAs(world, user) {
  const game = world.client(user);
  /** @type {any} */ (globalThis).game = game;
  world.current = game;
  return game;
}

/**
 * A tiny ApplicationV2 stand-in with the documented lifecycle core's helpers use: the constructor calls
 * `_initializeApplicationOptions`; `render()` calls `_onFirstRender` once and `_onRender` each time; `setPosition` calls
 * `_onPosition`; `minimize`/`maximize`; `close` calls `_onClose`. No DOM: `element` is null unless a test sets it.
 */
export class FakeApplicationV2 {
  static DEFAULT_OPTIONS = { classes: /** @type {string[]} */ ([]), position: { width: 600, height: /** @type {number | "auto"} */ ("auto") } };
  /** @param {Record<string, any>} [options] */
  constructor(options = {}) {
    /** @type {Record<string, any>} */
    this.options = this._initializeApplicationOptions(options);
    /** @type {Record<string, any>} */
    this.position = { left: 50, top: 50, scale: 1, ...this.options.position };
    this.rendered = false;
    this.minimized = false;
    this.renders = 0;
    /** @type {any} */
    this.element = null;
  }
  /** @param {Record<string, any>} options */
  _initializeApplicationOptions(options) {
    const D = /** @type {any} */ (this.constructor).DEFAULT_OPTIONS ?? FakeApplicationV2.DEFAULT_OPTIONS;
    return { ...D, ...options, classes: [...(D.classes ?? []), ...(options.classes ?? [])], position: { ...(D.position ?? {}), ...(options.position ?? {}) } };
  }
  /** @param {any} [_options] */
  async render(_options) {
    const first = !this.rendered; this.rendered = true; this.renders += 1;
    if (first) await this._onFirstRender({}, {});
    await this._onRender({}, {});
    return this;
  }
  /** @param {any} _context @param {any} _options */
  async _onFirstRender(_context, _options) {}
  /** @param {any} _context @param {any} _options */
  async _onRender(_context, _options) {}
  /** @param {Record<string, any>} p */
  setPosition(p) { Object.assign(this.position, p); this._onPosition(this.position); return this.position; }
  /** @param {any} _position */
  _onPosition(_position) {}
  async minimize() { this.minimized = true; }
  async maximize() { this.minimized = false; }
  /** @param {any} [_options] */
  async close(_options) { this.rendered = false; this._onClose({}); return this; }
  /** @param {any} _options */
  _onClose(_options) {}
}
