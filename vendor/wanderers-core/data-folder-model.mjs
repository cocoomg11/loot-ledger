/**
 * The shared "Module data" journal folder: the pure half (which folder to use, what to create, whether to move an entry, whether the
 * folder is empty enough to delete). No Foundry calls, tested in Node. The Foundry half is ./foundry/data-folder.mjs.
 *
 * Purpose: tidiness only. Modules keep their GM-only store journals (ownership None) in one collapsed folder at the bottom of the
 * Journal tab instead of scattering them. Nothing becomes more secret: ownership None already hides the entries from players' sidebars
 * (their data is still sent to their clients), and a folder adds no protection.
 *
 * Namespacing: no shared flag marks the folder. Matching is by exact name + type + root level only, so renaming the folder (or moving
 * it into another folder) makes each module create a new "Module data" folder the next time it files its entry.
 */

/** The folder's name (matched exactly, case-sensitive). */
export const DATA_FOLDER_NAME = "Module data";
/** The folder's document type. */
export const DATA_FOLDER_TYPE = "JournalEntry";
/** Sort value for a new folder: very high, so it sits below the GM's own folders (manual sorting). */
export const DATA_FOLDER_SORT = 2000000000;

/** @typedef {{ id?: string, _id?: string, name?: string, type?: string, folder?: any, sort?: number }} FolderLike */

/** @param {any} v @returns {string} the id of a folder reference (an id, a document with an id, or null) */
function refId(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  return String(v.id ?? v._id ?? "");
}

/**
 * Every data folder: the JournalEntry folders named exactly "Module data" at root level (not inside another folder), the one to use
 * first (lowest `sort`, then lowest id). Several can exist when modules create the folder at the same moment (each saw none), or
 * when a GM makes one by hand. Never throws.
 * @param {FolderLike[]} folders
 * @returns {FolderLike[]}
 */
export function dataFolders(folders) {
  const hits = (Array.isArray(folders) ? folders : []).filter(f =>
    f && typeof f === "object" && f.name === DATA_FOLDER_NAME && f.type === DATA_FOLDER_TYPE && !refId(f.folder));
  const num = (/** @type {any} */ n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  return hits.sort((a, b) => num(a.sort) - num(b.sort) || refId(a).localeCompare(refId(b)));
}

/**
 * The data folder to use: the first of `dataFolders(folders)` (lowest `sort`, then lowest id), so every module and every client
 * that reads the same folders picks the same one. Null when there is none. Never throws.
 * @param {FolderLike[]} folders
 * @returns {FolderLike | null}
 */
export function pickDataFolder(folders) {
  return dataFolders(folders)[0] ?? null;
}

/**
 * The creation data for a new data folder (collapsed by default in Foundry; no colour).
 * @returns {{ name: string, type: string, sorting: "m", sort: number }}
 */
export function dataFolderData() {
  return { name: DATA_FOLDER_NAME, type: DATA_FOLDER_TYPE, sorting: "m", sort: DATA_FOLDER_SORT };
}

/**
 * What to do to file a store entry: create the folder (data, or null when one exists) and move the entry (only when it sits at
 * root level; an entry the GM put in another folder stays there, and then no folder is created for it).
 * @param {{ folders: FolderLike[], entry?: { folder?: any } | null }} input
 * @returns {{ create: ReturnType<typeof dataFolderData> | null, move: boolean }}
 */
export function dataFolderPlan({ folders, entry } = /** @type {any} */ ({})) {
  const atRoot = !entry || !refId(entry.folder);
  const exists = !!pickDataFolder(folders);
  return {
    create: !exists && atRoot ? dataFolderData() : null,
    move: !!entry && atRoot
  };
}

/**
 * True when removing `removedIds` leaves nothing in the folder (so it may be deleted). Subfolders count as contents: pass their ids
 * too. Never throws.
 * @param {string[]} contentIds ids of everything now in the folder (entries and subfolders)
 * @param {string[]} removedIds ids the module is removing
 */
export function folderEmptyAfter(contentIds, removedIds) {
  const gone = new Set(Array.isArray(removedIds) ? removedIds : []);
  return (Array.isArray(contentIds) ? contentIds : []).every(id => gone.has(id));
}

/** The conventional client setting key each module registers (hidden record or a checkbox) for "Show module data". */
export const SHOW_SETTING = "showModuleData";

/**
 * Whether the folder stays visible: true when ANY of the answers is true (one module's "Show module data" switch is enough).
 * Non-boolean answers count as false. No answers → hidden.
 * @param {unknown[]} answers
 */
export function dataFolderShown(answers) {
  return (Array.isArray(answers) ? answers : []).some(a => a === true);
}

/**
 * Ids to take out of the Journal directory: every data folder (all of them when there are several), every folder inside them, and
 * every entry in any of them.
 * @param {FolderLike[]} folders all JournalEntry folders
 * @param {{ id?: string, folder?: any }[]} entries all journal entries
 * @returns {{ folders: string[], entries: string[] }}
 */
export function dataFolderIds(folders, entries) {
  const roots = dataFolders(folders);
  if (!roots.length) return { folders: [], entries: [] };
  const fs = new Set(roots.map(refId).filter(Boolean));
  const all = Array.isArray(folders) ? folders : [];
  for (let grew = true; grew;) { // nested folders, repeated until nothing new is found
    grew = false;
    for (const f of all) { const id = refId(f); if (id && !fs.has(id) && fs.has(refId(f?.folder))) { fs.add(id); grew = true; } }
  }
  return {
    folders: [...fs],
    entries: (Array.isArray(entries) ? entries : []).filter(e => e && fs.has(refId(e.folder))).map(e => refId(e)).filter(Boolean)
  };
}

/**
 * How one module tidies up duplicate data folders: move ITS OWN entries that sit directly in a data folder other than the picked
 * one into the picked one, then delete each other data folder that is empty once those moves are done. Another module's entries,
 * subfolders and anything else are never moved; a folder that still holds them stays (that module's own merge moves its entries,
 * and the last one out deletes the folder). Every module running this converges the world on one folder. Nothing to do with one
 * data folder or none. Never throws.
 * @param {{ folders: FolderLike[], entries: { id?: string, folder?: any }[], own: string[] }} input all JournalEntry folders, all
 *   journal entries, and the ids of the calling module's own entries (its store journal)
 * @returns {{ target: string | null, move: string[], remove: string[] }} the picked folder's id, own entry ids to move into it,
 *   folder ids to delete afterwards
 */
export function dataFolderMergePlan({ folders, entries, own } = /** @type {any} */ ({})) {
  const roots = dataFolders(folders);
  const target = roots.length ? refId(roots[0]) : null;
  if (roots.length < 2 || !target) return { target, move: [], remove: [] };
  const others = new Set(roots.slice(1).map(refId).filter(Boolean));
  const mine = new Set((Array.isArray(own) ? own : []).map(String));
  const allEntries = (Array.isArray(entries) ? entries : []).filter(e => e && typeof e === "object");
  const move = allEntries.filter(e => mine.has(refId(e)) && others.has(refId(e.folder))).map(e => refId(e));
  const contents = [...allEntries, ...(Array.isArray(folders) ? folders : []).filter(f => f && typeof f === "object")];
  const remove = [...others].filter(id =>
    folderEmptyAfter(contents.filter(d => refId(d.folder) === id).map(d => refId(d)), move));
  return { target, move, remove };
}
