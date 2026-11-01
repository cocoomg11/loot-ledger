/**
 * Remembered window placement for ApplicationV2 windows: the Foundry half. The rules (store shape, reading, clamping, debounce) are
 * in ../window-model.mjs, tested in Node. Untested in Node: needs a live client (settings, rendering, dragging, resizing).
 *
 * Opt-in per window class: `class Hub extends RememberedWindow(HandlebarsApplicationMixin(ApplicationV2), { moduleId, key })`.
 * Each module keeps its placements in one hidden client setting, `<moduleId>.windowPlacement` (registered by
 * `registerWindowPlacement(moduleId)` in "init", or on first use), so nothing is shared between modules or users.
 *
 * Hooks into documented ApplicationV2 methods only (v13/v14 API):
 * - `_initializeApplicationOptions`: the saved (clamped) placement becomes the default `position`, unless the code opening the
 *   window passed its own `position.left` or `position.top` (a window that sets its own position keeps it). `render({ position })`
 *   still wins as usual.
 * - `_onFirstRender`: restores the minimized state, starts listening for page resizes and core client setting changes (the UI
 *   scale), from then on saves.
 * - `_onPosition` (runs after every setPosition, which dragging and resizing go through): a debounced save.
 * - `minimize` / `maximize`: saves the minimized flag (the size is kept from before minimizing).
 * - `_onClose`: saves now and stops listening.
 */
import { getSetting } from "./module.mjs";
import {
  PLACEMENT_SETTING, PLACEMENT_SAVE_MS, readPlacements, getPlacement, setPlacement, removePlacement, clampPlacement, placementOf,
  samePlacement, isWindowKey, debouncer
} from "../window-model.mjs";

/**
 * Per-instance state set while the ApplicationV2 constructor runs `_initializeApplicationOptions`, before the subclass's own fields
 * (including private ones) exist, so it can't live in a private field.
 * @type {WeakMap<object, { key: string | null, saved: import("../window-model.mjs").Placement | null }>}
 */
const early = new WeakMap();

const g = () => /** @type {any} */ (globalThis).game;
const viewport = () => ({ width: /** @type {any} */ (globalThis).innerWidth, height: /** @type {any} */ (globalThis).innerHeight });

/**
 * Registers the hidden client setting `<moduleId>.windowPlacement` (call in "init"; RememberedWindow also registers it on first
 * use when the module didn't). Does nothing when it is already registered.
 * @param {string} moduleId
 */
export function registerWindowPlacement(moduleId) {
  if (typeof moduleId !== "string" || !moduleId) throw new Error("registerWindowPlacement: the module id is required");
  const settings = g()?.settings;
  if (!settings || settings.settings?.has?.(`${moduleId}.${PLACEMENT_SETTING}`)) return;
  settings.register(moduleId, PLACEMENT_SETTING, { name: "Window placement", scope: "client", config: false, type: Object, default: { v: 1, windows: {} } });
}

/** The module's stored placements (cleaned; empty when the setting can't be read). */
function load(/** @type {string} */ moduleId) {
  try { registerWindowPlacement(moduleId); } catch { /* no settings yet */ }
  return readPlacements(getSetting(moduleId, PLACEMENT_SETTING));
}

/** Writes the store; never throws (a failed save only logs). */
async function store(/** @type {string} */ moduleId, /** @type {unknown} */ value) {
  try {
    registerWindowPlacement(moduleId);
    await g().settings.set(moduleId, PLACEMENT_SETTING, value);
  } catch (e) { console.warn(`${moduleId} | could not save window placement`, e); }
}

/**
 * Forgets saved window placements: one window (`key`) or every window of the module. Open windows stay where they are until they
 * are closed and opened again (or moved, which saves them again).
 * @param {string} moduleId
 * @param {string} [key]
 * @returns {Promise<void>}
 */
export async function resetPlacement(moduleId, key) {
  await store(moduleId, removePlacement(load(moduleId), key));
}

/**
 * The saved placement of one window (cleaned, not clamped), or null.
 * @param {string} moduleId
 * @param {string} key
 * @returns {import("../window-model.mjs").Placement | null}
 */
export function savedPlacement(moduleId, key) { return getPlacement(load(moduleId), key); }

/**
 * @typedef {object} RememberedWindowOptions
 * @property {string} moduleId the host module id (its setting holds the placements)
 * @property {string | ((options: any) => string)} key the window key (see WINDOW_KEY_RE), or a function of the constructor options
 *   for windows opened once per document (e.g. `o => "sheet." + o.document.id`)
 * @property {boolean} [size] also remember width and height (default true; false for windows that size themselves)
 * @property {boolean} [minimized] also remember the minimized state (default true)
 * @property {number} [saveMs] debounce for saves (default PLACEMENT_SAVE_MS)
 */

/**
 * Adds remembered placement to an ApplicationV2 class. Returns a subclass; everything else about the window is unchanged.
 * Throws when the options are wrong (a programming mistake), never while playing.
 * @template {new (...args: any[]) => any} T
 * @param {T} Base an ApplicationV2 class (or a class already mixed with HandlebarsApplicationMixin)
 * @param {RememberedWindowOptions} opts
 * @returns {T}
 */
export function RememberedWindow(Base, opts) {
  const { moduleId, key, size = true, minimized: keepMin = true, saveMs = PLACEMENT_SAVE_MS } = opts ?? /** @type {any} */ ({});
  if (typeof Base !== "function") throw new Error("RememberedWindow: Base should be an ApplicationV2 class");
  if (typeof moduleId !== "string" || !moduleId) throw new Error("RememberedWindow: moduleId is required");
  if (typeof key !== "function" && !isWindowKey(key)) throw new Error(`RememberedWindow: bad window key ${JSON.stringify(key)}`);
  const keyOf = (/** @type {any} */ options) => { try { const k = typeof key === "function" ? key(options) : key; return isWindowKey(k) ? k : null; } catch { return null; } };

  return class RememberedWindowApp extends Base {
    #ready = false;
    #quiet = false;
    /** @type {(() => void) | null} */ #onResize = null;
    /** @type {number | null} */ #hook = null;
    #save = debouncer(() => this.#writeNow(), saveMs);

    /** The key this window's placement is saved under (null when the key function gave none). */
    get placementKey() { return early.get(this)?.key ?? null; }

    /** @param {any} options */
    _initializeApplicationOptions(options) {
      const out = super._initializeApplicationOptions(options);
      const k = keyOf(options);
      const own = options?.position && (options.position.left !== undefined || options.position.top !== undefined);
      const saved = k ? getPlacement(load(moduleId), k) : null;
      early.set(this, { key: k, saved });
      if (saved && !own) {
        const pos = out.position ?? {};
        const want = { left: saved.left, top: saved.top, ...(size && saved.width ? { width: saved.width } : {}), ...(size && saved.height ? { height: saved.height } : {}) };
        const fit = clampPlacement(want, viewport(), { scale: pos.scale, size: { width: pos.width, height: pos.height } });
        if (fit) out.position = { ...pos, ...fit };
      }
      return out;
    }

    /** @param {any} context @param {any} options */
    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      if (!this.placementKey) return;
      this.#onResize = () => this.clampToViewport();
      /** @type {any} */ (globalThis).addEventListener?.("resize", this.#onResize);
      try { this.#hook = /** @type {any} */ (globalThis).Hooks.on("clientSettingChanged", (/** @type {string} */ k) => { if (String(k).startsWith("core.")) setTimeout(() => this.clampToViewport(), 0); }); } catch { /* no hooks */ }
      if (keepMin && early.get(this)?.saved?.minimized && !this.minimized) { try { await this.minimize(); } catch { /* not minimizable */ } }
      this.#ready = true;
    }

    /** @param {any} position */
    _onPosition(position) {
      super._onPosition(position);
      if (this.#ready && !this.#quiet && this.placementKey) this.#save.call();
    }

    async minimize() { await super.minimize(); if (this.#ready && keepMin) this.#save.call(); }
    async maximize() { await super.maximize(); if (this.#ready && keepMin) this.#save.call(); }

    /** @param {any} options */
    _onClose(options) {
      super._onClose(options);
      this.#save.flush();
      if (this.#onResize) /** @type {any} */ (globalThis).removeEventListener?.("resize", this.#onResize);
      if (this.#hook !== null) { try { /** @type {any} */ (globalThis).Hooks.off("clientSettingChanged", this.#hook); } catch { /* hooks gone */ } }
      this.#onResize = null; this.#hook = null; this.#ready = false;
    }

    /**
     * Moves the window back inside the page when the page (or the UI scale) got smaller. Not saved, so the remembered placement
     * comes back when the page is large again.
     */
    clampToViewport() {
      if (!this.rendered || this.minimized) return;
      const pos = this.position ?? {};
      const cur = placementOf(pos, { size });
      if (!cur) return;
      const fit = clampPlacement(cur, viewport(), { scale: pos.scale, size: { width: this.element?.offsetWidth, height: this.element?.offsetHeight } });
      if (!fit || samePlacement(fit, cur)) return;
      this.#quiet = true;
      try { this.setPosition(fit); } finally { this.#quiet = false; }
    }

    /** Forgets this window's saved placement (it opens at its default next time). */
    async resetPlacement() {
      this.#save.cancel();
      if (this.placementKey) await resetPlacement(moduleId, this.placementKey);
      const st = early.get(this); if (st) st.saved = null;
    }

    #writeNow() {
      const k = this.placementKey;
      if (!k) return;
      const all = load(moduleId);
      const before = all.windows[k] ?? null;
      const isMin = !!this.minimized;
      // While minimized the height is the header's: keep the size from before minimizing.
      let next = placementOf(this.position, { size: size && !isMin, minimized: keepMin && isMin });
      if (!next) return;
      if (isMin && size && before) next = { ...next, ...(before.width ? { width: before.width } : {}), ...(before.height ? { height: before.height } : {}) };
      if (samePlacement(before, next)) return;
      const st = early.get(this); if (st) st.saved = next;
      store(moduleId, setPlacement(all, k, next));
    }
  };
}
