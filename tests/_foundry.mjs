/**
 * Minimal in-memory Foundry for running build() in Node. Only what build.mjs touches: world compendiums with
 * an index, folders, Item / RollTable / Folder create+delete, JournalEntry, ChatMessage, settings, notifications.
 */
const clone = o => structuredClone(o);
const getProperty = (o, path) => path.split(".").reduce((a, k) => a?.[k], o);

class Index extends Map {
  *[Symbol.iterator]() { yield* this.values(); }
  find(fn) { for (const v of this.values()) if (fn(v)) return v; return undefined; }
}

export class Pack {
  constructor(collection, docs = []) {
    this.collection = collection;
    this.docs = new Map(docs.map(d => [d._id, d]));
    this.folderDocs = new Map();
    this.locked = false;
    this.writes = { created: 0, deleted: 0 };
  }
  get index() { return this._index(); }
  _index() { const i = new Index(); for (const d of this.docs.values()) i.set(d._id, { _id: d._id, name: d.name, flags: clone(d.flags ?? {}) }); return i; }
  async getIndex() { return this._index(); }
  get folders() { const m = this.folderDocs; return { get: id => m.get(id), map: fn => [...m.values()].map(fn) }; }
  get documentClass() { return this.collection.endsWith("tables") ? globalThis.RollTable : globalThis.Item; }
  async configure(o) { Object.assign(this, o); }
  async getDocuments() { return [...this.docs.values()].map(d => makeDoc(d, this.collection)); }
  async getDocument(id) { const d = this.docs.get(id); return d ? makeDoc(d, this.collection) : null; }
}

function makeDoc(d, collection) {
  const data = clone(d);
  return Object.assign(clone(d), { id: d._id, uuid: `Compendium.${collection}.Item.${d._id}`, toObject: () => clone(data) });
}

export function install({ sourceItems, settings = {} }) {
  const packs = new Map();
  const source = new Pack("wow-classic-items.items", sourceItems.map(clone));
  packs.set(source.collection, source);
  const chat = [];
  const journal = [];
  const pack = o => packs.get(o.pack);
  const docClass = () => class {
    static async createDocuments(list, o) {
      const p = pack(o);
      for (const d of list) {
        if (p.docs.has(d._id)) throw new Error(`duplicate id ${d._id} in ${p.collection}`);
        p.docs.set(d._id, clone(d));
      }
      p.writes.created += list.length;
      return list;
    }
    static async deleteDocuments(ids, o) {
      const p = pack(o);
      for (const id of ids) p.docs.delete(id);
      p.writes.deleted += ids.length;
    }
  };
  globalThis.Item = docClass();
  globalThis.RollTable = docClass();
  globalThis.Folder = class {
    static async createDocuments(list, o) { for (const f of list) pack(o).folderDocs.set(f._id, clone(f)); }
    static async deleteDocuments(ids, o) { for (const id of ids) pack(o).folderDocs.delete(id); }
  };
  class Entry {
    constructor(d) { Object.assign(this, d); this.id = `j${journal.length}`; this.uuid = `JournalEntry.${this.id}`; this._pages = []; }
    get pages() { return this._pages.map(p => ({ id: p.id, ...p })); }
    getFlag(s, k) { return this.flags?.[s]?.[k]; }
    async deleteEmbeddedDocuments(_, ids) { this._pages = this._pages.filter(p => !ids.includes(p.id)); }
    async createEmbeddedDocuments(_, list) { list.forEach((p, i) => this._pages.push({ ...p, id: `p${this._pages.length + i}` })); }
  }
  globalThis.JournalEntry = { create: async d => { const e = new Entry(d); journal.push(e); return e; } };
  journal.getName = n => journal.find(e => e.name === n);
  globalThis.ChatMessage = { create: async d => { chat.push(d); return d; } };
  globalThis.ui = { notifications: { info: () => null, warn: () => null, error: () => null } };
  const store = { coinRatio: "100", convertOnBuild: false, ...settings };
  globalThis.game = {
    user: { isGM: true },
    system: { version: "6.0.0" },
    packs: { get: k => packs.get(k), has: k => packs.has(k) },
    settings: { get: (_, k) => store[k], set: async (_, k, v) => { store[k] = v; } },
    journal,
    users: { filter: fn => [{ id: "gm", isGM: true }].filter(fn) },
    modules: { get: () => null }
  };
  globalThis.foundry = {
    utils: { getProperty, deepClone: clone },
    documents: { collections: { CompendiumCollection: { createCompendium: async ({ name, type }) => {
      const p = new Pack(`world.${name}`); p.type = type; packs.set(p.collection, p); return p;
    } } } },
    applications: { api: { DialogV2: { confirm: async () => true }, ApplicationV2: class {} } }
  };
  return { packs, source, chat, journal, store };
}
