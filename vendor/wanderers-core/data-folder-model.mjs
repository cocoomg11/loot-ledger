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
 * The existing data folder: a JournalEntry folder named exactly "Module data" at root level (not inside another folder). With
 * several, the lowest `sort` wins, then the lowest id. Never throws.
 * @param {FolderLike[]} folders
 * @returns {FolderLike | null}
 */
export function pickDataFolder(folders) {
  const hits = (Array.isArray(folders) ? folders : []).filter(f =>
    f && typeof f === "object" && f.name === DATA_FOLDER_NAME && f.type === DATA_FOLDER_TYPE && !refId(f.folder));
  if (!hits.length) return null;
  const num = (/** @type {any} */ n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  hits.sort((a, b) => num(a.sort) - num(b.sort) || refId(a).localeCompare(refId(b)));
  return hits[0];
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
 * Ids to take out of the Journal directory: the data folder, every folder inside it, and every entry in any of them.
 * @param {FolderLike[]} folders all JournalEntry folders
 * @param {{ id?: string, folder?: any }[]} entries all journal entries
 * @returns {{ folders: string[], entries: string[] }}
 */
export function dataFolderIds(folders, entries) {
  const root = pickDataFolder(folders);
  if (!root) return { folders: [], entries: [] };
  const fs = new Set([refId(root)]);
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
