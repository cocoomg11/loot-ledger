/**
 * The shared "Table Tools" tab in the Scene Configuration window: the pure half (no Foundry calls; tested in Node). The Foundry half
 * is ./foundry/scene-tab.mjs.
 *
 * Several modules each bundle their own copy of core, but the window should get one extra tab, not one per module. The first copy
 * that registers a section creates a small registry on `globalThis` (the one deliberate global in core, see README, Namespacing) and
 * renders the tab; every other copy, whatever its version, only adds its section through the registry's `add()`. The registry is a
 * versioned format: `{ version: 1, tabId, add(entry), remove(moduleId), list() }`, and `entry` is the section below.
 */

/** The global the registry lives on. */
export const SCENE_TAB_GLOBAL = "__wanderersSceneTab";
/** The registry format version. */
export const SCENE_TAB_VERSION = 1;
/** The tab's id in the window's tab group. */
export const SCENE_TAB_ID = "wanderers";
/** The tab's label and icon. */
export const SCENE_TAB_LABEL = "Table Tools";
export const SCENE_TAB_ICON = "fa-solid fa-toolbox";

const MODULE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * @typedef {object} SceneSection
 * @property {string} moduleId the host module's id; one section per module (adding again replaces it)
 * @property {string} title shown as the section's legend
 * @property {number} order lower first; ties sort by title, then module id
 * @property {(app: any, scene: any) => HTMLElement | string | null | undefined} render the section's contents. Form fields must be
 *   named `flags.<moduleId>.…` (they save with the window's own submit); fields named anything else are disabled.
 * @property {((app: any, scene: any, el: HTMLElement) => unknown) | null} onSubmit optional: runs when the window's form is submitted,
 *   for a module that saves its section itself
 */

/**
 * Checks and normalises a section at registration time. Throws on a programming mistake, so a module's tests catch it.
 * @param {string} moduleId
 * @param {{ title?: unknown, order?: unknown, render?: unknown, onSubmit?: unknown }} opts
 * @returns {SceneSection}
 */
export function defineSection(moduleId, opts) {
  if (typeof moduleId !== "string" || !MODULE_ID_RE.test(moduleId)) throw new Error("sceneTab.addSection(): needs the module id");
  if (!opts || typeof opts !== "object") throw new Error(`sceneTab.addSection(${moduleId}): expected { title, render }`);
  if (typeof opts.title !== "string" || !opts.title.trim()) throw new Error(`sceneTab.addSection(${moduleId}): needs a title`);
  if (typeof opts.render !== "function") throw new Error(`sceneTab.addSection(${moduleId}): render should be a function`);
  if (opts.onSubmit !== undefined && opts.onSubmit !== null && typeof opts.onSubmit !== "function") throw new Error(`sceneTab.addSection(${moduleId}): onSubmit should be a function`);
  const order = opts.order === undefined ? 0 : Number(opts.order);
  if (!Number.isFinite(order)) throw new Error(`sceneTab.addSection(${moduleId}): order should be a number`);
  return Object.freeze({
    moduleId, title: opts.title.trim(), order,
    render: /** @type {SceneSection["render"]} */ (opts.render),
    onSubmit: /** @type {SceneSection["onSubmit"]} */ (opts.onSubmit ?? null)
  });
}

/**
 * Sections in display order: `order`, then title (case-insensitive), then module id.
 * @param {readonly SceneSection[]} list
 * @returns {SceneSection[]}
 */
export function orderSections(list) {
  return [...(list ?? [])].sort((a, b) => (a.order - b.order)
    || a.title.localeCompare(b.title, "en", { sensitivity: "base" })
    || (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
}

/**
 * Adds a section, replacing the module's earlier one (one section per module).
 * @param {readonly SceneSection[]} list
 * @param {SceneSection} entry
 * @returns {SceneSection[]}
 */
export function upsertSection(list, entry) {
  return orderSections([...(list ?? []).filter(s => s.moduleId !== entry.moduleId), entry]);
}

/**
 * Whether a form field name belongs to the module: `flags.<moduleId>.<something>`.
 * @param {string} moduleId
 * @param {unknown} name
 * @returns {boolean}
 */
export function ownField(moduleId, name) {
  if (typeof name !== "string") return false;
  const prefix = `flags.${moduleId}.`;
  return name.startsWith(prefix) && name.length > prefix.length && !name.slice(prefix.length).split(".").some(p => !p || p === "__proto__" || p === "constructor" || p === "prototype");
}

/**
 * @typedef {object} SceneTabRegistry
 * @property {number} version
 * @property {string} tabId
 * @property {(entry: SceneSection) => void} add
 * @property {(moduleId: string) => void} remove
 * @property {() => SceneSection[]} list in display order
 */

/**
 * A fresh registry (no globals here: the Foundry half puts it on `globalThis`).
 * @returns {SceneTabRegistry}
 */
export function createRegistry() {
  /** @type {SceneSection[]} */
  let sections = [];
  return Object.freeze({
    version: SCENE_TAB_VERSION,
    tabId: SCENE_TAB_ID,
    add(entry) { sections = upsertSection(sections, entry); },
    remove(moduleId) { sections = sections.filter(s => s.moduleId !== moduleId); },
    list() { return [...sections]; }
  });
}

/**
 * Whether a value found on the global is a registry this copy can use (any version that keeps the version-1 calls).
 * @param {unknown} r
 * @returns {r is SceneTabRegistry}
 */
export function usableRegistry(r) {
  const x = /** @type {any} */ (r);
  return !!x && typeof x === "object" && Number.isInteger(x.version) && x.version >= 1 && typeof x.add === "function"
    && typeof x.remove === "function" && typeof x.list === "function";
}

/**
 * The registry on `host` (normally `globalThis`), created when there is none. `created` tells the caller it owns the rendering.
 * @param {Record<string, unknown>} host
 * @returns {{ registry: SceneTabRegistry, created: boolean }}
 */
export function claimRegistry(host) {
  const found = host[SCENE_TAB_GLOBAL];
  if (usableRegistry(found)) return { registry: found, created: false };
  const registry = createRegistry();
  Object.defineProperty(host, SCENE_TAB_GLOBAL, { value: registry, configurable: true, enumerable: false, writable: false });
  return { registry, created: true };
}
