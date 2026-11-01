/**
 * The shared "Table Tools" tab in Foundry's Scene Configuration window (ApplicationV2 `SceneConfig`): the Foundry half. The rules
 * (registry, ordering, one section per module, field names) are in ../scene-tab-model.mjs, tested in Node. Untested in Node: needs
 * a live world.
 *
 * How the tab is added: through the documented `renderSceneConfig` hook (fired for SceneConfig and any subclass, before the HTML is
 * shown), not by extending `SceneConfig.TABS` / `PARTS`. A new PART needs a Handlebars template file served by one particular module
 * and a change to Foundry's shared class, which every copy of core would have to agree on; the hook needs neither. On each render
 * the hook makes sure the window has one nav entry and one tab panel with our id, in the window's own tab group, so Foundry's own
 * tab switching (`data-action="tab"`, `changeTab`) handles it, and re-renders (full or by part) keep it. Each module's section is
 * built again on every render from the scene's current data.
 *
 * Saving: fields named `flags.<moduleId>.…` sit inside the window's form, so its normal submit saves them with the scene. Fields with
 * any other name are disabled (they would write outside the module's namespace). A section may also pass `onSubmit` to save itself.
 */
import { esc } from "../text.mjs";
import { defineSection, claimRegistry, usableRegistry, ownField, SCENE_TAB_GLOBAL, SCENE_TAB_ID, SCENE_TAB_LABEL, SCENE_TAB_ICON } from "../scene-tab-model.mjs";

const PANEL_CLASS = "wanderers-scene-tab";
/** @type {WeakSet<object>} */
const submitHooked = new WeakSet();

/**
 * Builds one section's fieldset. Never throws: a failing section shows a short note instead.
 * @param {import("../scene-tab-model.mjs").SceneSection} s
 * @param {any} app
 * @param {any} scene
 * @returns {HTMLFieldSetElement}
 */
function buildSection(s, app, scene) {
  const fs = document.createElement("fieldset");
  fs.className = `${PANEL_CLASS}-section`;
  fs.dataset.module = s.moduleId;
  const legend = document.createElement("legend");
  legend.textContent = s.title;
  fs.append(legend);
  try {
    const out = /** @type {unknown} */ (s.render(app, scene));
    if (out instanceof HTMLElement || out instanceof DocumentFragment) fs.append(out);
    else if (typeof out === "string" && out) {
      const t = document.createElement("template"); t.innerHTML = out; fs.append(t.content);
    }
  } catch (e) {
    console.warn(`${s.moduleId} | scene tab`, e);
    const p = document.createElement("p"); p.className = "hint"; p.textContent = `${s.title} couldn't show its settings (see the console).`;
    fs.append(p);
  }
  for (const f of fs.querySelectorAll("[name]")) {
    const name = f.getAttribute("name");
    if (ownField(s.moduleId, name)) continue;
    console.warn(`${s.moduleId} | scene tab: field "${name}" isn't under flags.${s.moduleId}; disabled`);
    f.removeAttribute("name"); f.setAttribute("disabled", "");
  }
  return fs;
}

/**
 * The render hook: one nav entry, one panel, the sections in order.
 * @param {() => import("../scene-tab-model.mjs").SceneSection[]} list
 * @returns {(app: any, element: HTMLElement) => void}
 */
function onRender(list) {
  return (app, element) => {
    try {
      const sections = list();
      const root = element instanceof HTMLElement ? element : app?.element;
      if (!root || !sections.length) return;
      const form = root.tagName === "FORM" ? root : root.querySelector("form") ?? root;
      const nav = root.querySelector("nav.tabs[data-group]") ?? root.querySelector("nav.tabs");
      const group = nav?.getAttribute("data-group") ?? "sheet";
      const active = app?.tabGroups?.[group] === SCENE_TAB_ID;
      // Nav entry: copy the look of the window's own last tab, so it matches whatever v13/v14 template drew the others.
      if (nav && !nav.querySelector(`[data-tab="${SCENE_TAB_ID}"]`)) {
        const model = nav.querySelector("[data-action='tab'][data-tab]");
        const a = /** @type {HTMLElement} */ (model ? model.cloneNode(false) : document.createElement("a"));
        a.classList.remove("active");
        a.setAttribute("data-action", "tab"); a.setAttribute("data-group", group); a.setAttribute("data-tab", SCENE_TAB_ID);
        a.removeAttribute("aria-selected"); a.setAttribute("data-tooltip", SCENE_TAB_LABEL);
        a.innerHTML = `<i class="${esc(SCENE_TAB_ICON)}" inert></i><span>${esc(SCENE_TAB_LABEL)}</span>`;
        nav.append(a);
      }
      nav?.querySelector(`[data-tab="${SCENE_TAB_ID}"]`)?.classList.toggle("active", active);
      // Panel: after the window's last tab panel (before the footer), kept in place across part re-renders.
      let panel = /** @type {HTMLElement | null} */ (form.querySelector(`:scope > .tab[data-tab="${SCENE_TAB_ID}"]`) ?? root.querySelector(`.tab.${PANEL_CLASS}`));
      if (!panel) {
        panel = document.createElement("section");
        panel.className = `tab scrollable ${PANEL_CLASS}`;
        panel.setAttribute("data-group", group); panel.setAttribute("data-tab", SCENE_TAB_ID);
        const tabs = form.querySelectorAll(`.tab[data-group="${group}"]`);
        const last = tabs[tabs.length - 1];
        if (last?.parentElement) last.after(panel);
        else form.querySelector(":scope > footer")?.before(panel) ?? form.append(panel);
      }
      panel.classList.toggle("active", active);
      const scene = app?.document ?? app?.object ?? null;
      panel.replaceChildren(...sections.map(s => buildSection(s, app, scene)));
      if (!submitHooked.has(form)) {
        submitHooked.add(form);
        form.addEventListener("submit", () => {
          for (const s of list()) {
            if (!s.onSubmit) continue;
            const el = form.querySelector(`.${PANEL_CLASS}-section[data-module="${CSS.escape(s.moduleId)}"]`);
            try { Promise.resolve(s.onSubmit(app, app?.document ?? null, /** @type {HTMLElement} */ (el))).catch(e => console.warn(`${s.moduleId} | scene tab save`, e)); }
            catch (e) { console.warn(`${s.moduleId} | scene tab save`, e); }
          }
        });
      }
    } catch (e) {
      console.warn("wanderers-core | scene tab", e);
    }
  };
}

/**
 * The shared Scene Configuration tab. Call `addSection` from the module's "init" (or "setup") hook, only when the feature that owns
 * the section is on. The first module to add a section creates the tab; it works the same with one module installed or several.
 */
export const sceneTab = Object.freeze({
  /**
   * Adds (or replaces) this module's section in the shared tab.
   * @param {string} moduleId
   * @param {{ title: string, order?: number, render: (app: any, scene: any) => HTMLElement | string | null | undefined, onSubmit?: (app: any, scene: any, el: HTMLElement) => unknown }} opts
   *   render: the section's contents. Escape every value you put in an HTML string (`esc`); name fields `flags.<moduleId>.…`.
   */
  addSection(moduleId, opts) {
    const entry = defineSection(moduleId, opts);
    const { registry, created } = claimRegistry(/** @type {any} */ (globalThis));
    registry.add(entry);
    if (created) /** @type {any} */ (globalThis).Hooks.on("renderSceneConfig", onRender(() => registry.list()));
  },
  /**
   * Removes this module's section (the tab disappears on the next render when no section is left).
   * @param {string} moduleId
   */
  removeSection(moduleId) {
    const r = /** @type {any} */ (globalThis)[SCENE_TAB_GLOBAL];
    if (usableRegistry(r)) r.remove(moduleId);
  },
  /**
   * The sections in display order (module id and title), for health checks.
   * @returns {{ moduleId: string, title: string, order: number }[]}
   */
  sections() {
    const r = /** @type {any} */ (globalThis)[SCENE_TAB_GLOBAL];
    try { return usableRegistry(r) ? r.list().map((/** @type {any} */ s) => ({ moduleId: s.moduleId, title: s.title, order: s.order })) : []; } catch { return []; }
  }
});
