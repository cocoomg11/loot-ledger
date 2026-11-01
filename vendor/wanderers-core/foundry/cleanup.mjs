/**
 * Helpers for a module's "Remove <module> data" window: walking the world for documents that carry our flags, removing only our
 * flags, resetting our settings. The categories, the dry run and the REMOVE confirmation are in ../cleanup-model.mjs (tested in Node);
 * the window itself stays in each module (its categories and wording are its own). Untested in Node: needs a live world.
 */
import { hasFlags } from "../cleanup-model.mjs";

const g = () => /** @type {any} */ (globalThis).game;

/** Embedded collections walked under each world document (names as on the document instances). */
const EMBEDDED = ["items", "effects", "pages", "tokens", "notes", "tiles", "drawings", "lights", "sounds", "regions", "walls", "templates", "results", "combatants"];

/**
 * Every world document and every embedded document directly under it (one level deep: a scene's tokens, an actor's items, a
 * journal's pages). Reads `game.collections` (one WorldCollection per primary document type). Compendium packs are not walked.
 * @returns {Generator<any>}
 */
export function* worldDocuments() {
  for (const coll of g()?.collections?.values?.() ?? []) {
    for (const doc of coll ?? []) {
      yield doc;
      for (const name of EMBEDDED) {
        let sub; try { sub = doc[name]; } catch { continue; }
        if (!sub || typeof sub[Symbol.iterator] !== "function" || typeof sub === "string") continue;
        for (const child of sub) if (child && typeof child === "object" && "documentName" in child) yield child;
      }
    }
  }
}

/**
 * Documents carrying `flags[ns]`, as plain { uuid, name, documentName } (for a plan).
 * @param {string} ns
 * @param {(doc: any) => boolean} [filter]
 * @returns {{ uuid: string, name: string, documentName: string }[]}
 */
export function flaggedDocuments(ns, filter = () => true) {
  const out = [];
  for (const d of worldDocuments()) if (hasFlags(d, ns) && filter(d)) out.push({ uuid: d.uuid, name: String(d.name ?? d.id), documentName: d.documentName });
  return out;
}

/**
 * Removes every flag of `ns` from the documents with those UUIDs (the documents stay). Returns how many documents changed.
 * @param {string} ns
 * @param {string[]} uuids
 * @returns {Promise<number>}
 */
export async function unsetFlags(ns, uuids) {
  let n = 0;
  for (const uuid of uuids) {
    try {
      const d = await /** @type {any} */ (globalThis).fromUuid(uuid);
      if (!d) continue;
      for (const k of Object.keys(d._source?.flags?.[ns] ?? d.flags?.[ns] ?? {})) await d.unsetFlag(ns, k);
      n += 1;
    } catch (e) { console.warn(`${ns} | remove flags ${uuid}`, e); }
  }
  return n;
}

/**
 * Resets settings of `ns` to their registered defaults. Returns how many were reset.
 * @param {string} ns
 * @param {string[]} keys
 * @returns {Promise<number>}
 */
export async function resetSettings(ns, keys) {
  let n = 0;
  for (const key of keys) {
    const c = g().settings.settings.get(`${ns}.${key}`); if (!c) continue;
    try { await g().settings.set(ns, key, structuredClone(c.default)); n += 1; } catch (e) { console.warn(`${ns} | reset ${key}`, e); }
  }
  return n;
}
