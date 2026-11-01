/**
 * The shared "Module data" journal folder: the Foundry half. The rules are in ../data-folder-model.mjs (tested in Node). Untested in
 * Node: needs a live world (folder and journal writes).
 *
 * Only a module's single writer calls these (the leader / active GM), after it created or found its store journal. They never throw:
 * a problem is logged as a warning and the entry simply stays where it is. Purely for tidiness; see the model file for what this does
 * not do (it hides nothing from players).
 */
import { pickDataFolder, dataFolderPlan, dataFolderData, folderEmptyAfter, dataFolderShown, dataFolderIds } from "../data-folder-model.mjs";

/** @typedef {{ warn?: (...args: any[]) => void }} DataFolderLog */

/** @param {string} moduleId @param {DataFolderLog | undefined} log @param {string} what @param {unknown} e */
function warnAbout(moduleId, log, what, e) {
  const fn = typeof log?.warn === "function" ? log.warn : (/** @type {any[]} */ ...a) => console.warn(`${moduleId} |`, ...a);
  try { fn(`Module data folder: ${what}`, e); } catch { /* logging must not throw */ }
}

/** @returns {any} */
function game() { return /** @type {any} */ (globalThis).game; }

/**
 * Finds the "Module data" folder, creating it when missing. GM only.
 * @param {string} moduleId the calling module (for the log line only; the folder is shared and carries no module flag)
 * @param {{ log?: DataFolderLog }} [options]
 * @returns {Promise<any | null>} the Folder, or null (not a GM, or it failed)
 */
export async function ensureDataFolder(moduleId, { log } = {}) {
  try {
    if (!game()?.user?.isGM) return null;
    const folders = Array.from(game().folders ?? []);
    const found = pickDataFolder(/** @type {any} */ (folders));
    if (found) return folders.find(f => f === found) ?? found;
    return (await /** @type {any} */ (globalThis).Folder.create(dataFolderData())) ?? null;
  } catch (e) {
    warnAbout(moduleId, log, "couldn't find or create the folder", e);
    return null;
  }
}

/**
 * Moves a root-level store journal into the "Module data" folder (creating the folder if needed). An entry already in a folder (the
 * GM's own choice) is left alone. GM only.
 * @param {string} moduleId
 * @param {any} journalEntry the module's store JournalEntry
 * @param {{ log?: DataFolderLog }} [options]
 * @returns {Promise<boolean>} true when the entry was moved
 */
export async function fileInDataFolder(moduleId, journalEntry, { log } = {}) {
  try {
    if (!game()?.user?.isGM || !journalEntry) return false;
    const plan = dataFolderPlan({ folders: /** @type {any} */ (Array.from(game().folders ?? [])), entry: journalEntry });
    if (!plan.move) return false;
    const folder = await ensureDataFolder(moduleId, { log });
    if (!folder?.id) return false;
    await journalEntry.update({ folder: folder.id });
    return true;
  } catch (e) {
    warnAbout(moduleId, log, "couldn't file the entry", e);
    return false;
  }
}

/**
 * Deletes the "Module data" folder when nothing is left in it once `removedIds` are gone (other modules' entries and subfolders
 * keep it). Call after the module removed its own store journal, or pass the entry's id before removing it. GM only.
 * @param {string} moduleId
 * @param {string[]} [removedIds] ids being removed by this module (default none)
 * @param {{ log?: DataFolderLog }} [options]
 * @returns {Promise<boolean>} true when the folder was deleted
 */
export async function removeDataFolderIfEmpty(moduleId, removedIds = [], { log } = {}) {
  try {
    if (!game()?.user?.isGM) return false;
    const folder = pickDataFolder(/** @type {any} */ (Array.from(game().folders ?? [])));
    if (!folder) return false;
    const id = String(folder.id);
    const inside = /** @type {any[]} */ ([...Array.from(game().journal ?? []), ...Array.from(game().folders ?? [])])
      .filter(d => (d.folder?.id ?? d.folder) === id).map(d => String(d.id));
    if (!folderEmptyAfter(inside, removedIds)) return false;
    await /** @type {any} */ (folder).delete();
    return true;
  } catch (e) {
    warnAbout(moduleId, log, "couldn't remove the folder", e);
    return false;
  }
}

/** @type {Map<string, number>} hook ids by module id (one hook per module in this copy of core) */
const hideHooks = new Map();

/**
 * Hides the "Module data" folder, its subfolders and their entries from the Journal sidebar, for GMs too. UI tidiness only: it hides
 * nothing from anyone's data, the journals stay ordinary documents. Call once per module in `init` or `ready`; calling again for the
 * same module is a no-op.
 *
 * Shared by several modules without shared state: each module's hook computes the same answer, and the folder shows when ANY of these
 * is true: this module's `shown()`, or the world/client setting `<moduleId>.showModuleData` of ANY active module that registered one
 * (`SHOW_SETTING`; read only, never written). So each module registers a hidden-or-visible Boolean setting of that name (default
 * false) and re-renders the directory when it changes (`ui.journal?.render()`); then one module's switch shows the folder for all.
 *
 * Hook: `renderJournalDirectory(app, html)` (`html` is an HTMLElement in v13/v14, a jQuery object in older code; both handled).
 * Elements are removed from the rendered DOM (folder `[data-folder-id]`, entry `[data-entry-id]`), so the sidebar search, which
 * filters those elements, can't reveal them either; the next render runs the hook again.
 * @param {string} moduleId
 * @param {{ shown?: () => boolean }} [options] this module's own switch (default: read its `showModuleData` setting)
 * @returns {number | null} the hook id, or null when already registered / Hooks unavailable
 */
export function hideDataFolder(moduleId, { shown } = {}) {
  try {
    if (hideHooks.has(moduleId)) return null;
    const Hooks = /** @type {any} */ (globalThis).Hooks;
    if (!Hooks?.on) return null;
    const id = Hooks.on("renderJournalDirectory", (/** @type {any} */ _app, /** @type {any} */ html) => {
      try {
        const g = game();
        const answers = [];
        try { answers.push(typeof shown === "function" ? shown() : null); } catch { answers.push(false); }
        for (const m of g?.modules ?? []) {
          const mid = m?.id ?? m?.[0];
          const active = m?.active ?? m?.[1]?.active;
          if (!active || !mid) continue;
          try { if (g.settings.settings.has(`${mid}.showModuleData`)) answers.push(g.settings.get(mid, "showModuleData")); } catch { /* not readable */ }
        }
        if (dataFolderShown(answers)) return;
        const ids = dataFolderIds(Array.from(g?.folders ?? []), Array.from(g?.journal ?? []));
        const root = html?.[0] ?? html;
        if (!root?.querySelectorAll) return;
        const esc = (/** @type {string} */ v) => String(v).replace(/["\\]/g, "\\$&");
        for (const f of ids.folders) for (const el of root.querySelectorAll(`[data-folder-id="${esc(f)}"]`)) el.remove();
        for (const e of ids.entries) for (const el of root.querySelectorAll(`[data-entry-id="${esc(e)}"]`)) el.remove();
      } catch (e) { warnAbout(moduleId, undefined, "couldn't hide the folder", e); }
    });
    hideHooks.set(moduleId, id);
    return id;
  } catch (e) {
    warnAbout(moduleId, undefined, "couldn't register the hide hook", e);
    return null;
  }
}
