/**
 * Guest pages (0.6.0): a host module's window (a character sheet, a control panel) lists its own pages and lets other modules add
 * theirs through the host's API. Pure: no Foundry calls at import or call time, tested in Node (docs/pages.md).
 *
 * The registry lives in the HOST module, one per host window (`createPageHost`); guests reach it only through the host's API, never
 * through core (there is no global). Guest definitions are read by `readPageDef`, which never throws: a bad definition is refused
 * with a reason and a console warning, so a guest's mistake can't break the host's `ready`.
 */

/** A guest page id: `<module-id>.<page>` (the guest's own module id first, so two modules never collide). */
export const PAGE_ID_RE = /^[a-z0-9-]+\.[A-Za-z0-9_-]+$/;
/** Longest id, label (bookmark tooltip and page title) and hint (the small line next to the title). */
export const PAGE_ID_MAX = 80;
export const PAGE_LABEL_MAX = 40;
export const PAGE_HINT_MAX = 80;
/** An icon is one SVG path's `d` (24 × 24 grid; drawing commands and numbers only) of at most this many characters… */
export const PAGE_ICON_MAX = 2000;
export const PAGE_PATH_RE = /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE\s,.+-]*$/;
/** …or Font Awesome classes ("fa-solid fa-hammer"). */
export const PAGE_FA_RE = /^fa-[a-z]+( fa-[a-z0-9-]+)+$/;
/** Guest pages one host keeps at most (a new id past the cap is refused; replacing an id is always allowed). */
export const PAGE_GUESTS_MAX = 20;
/** How long `renderGuest` waits for a guest's render by default. */
export const PAGE_RENDER_MS = 5000;

/**
 * A guest page as the host keeps it (frozen).
 * @typedef {object} GuestPage
 * @property {string} id
 * @property {string} label
 * @property {string} hint "" when none
 * @property {string | null} icon an SVG path `d`, or null
 * @property {string | null} fa Font Awesome classes, or null (a path wins when both are given)
 * @property {number | null} order null = after every numbered page
 * @property {(ctx: any) => unknown} render returns an HTML string (inserted as is) or an element; may be async
 * @property {((ctx: any) => unknown) | null} visible optional: false hides the page for that context
 * @property {((ctx: any) => unknown) | null} activate optional: wires listeners after each render
 * @property {true} guest
 */

/**
 * A host's own page (frozen copy of what the host passed, plus `guest: false`).
 * @typedef {{ id: string, order: number, visible?: ((ctx: any) => unknown) | null, guest: false, [k: string]: unknown }} BuiltInPage
 */

/** @typedef {{ ok: true, page: GuestPage } | { ok: false, reason: string }} PageDefResult */

const isFn = (/** @type {unknown} */ f) => typeof f === "function";
const text = (/** @type {unknown} */ s) => (typeof s === "string" ? s.trim() : null);

/**
 * Reads a guest page definition. Never throws: `{ ok: true, page }` or `{ ok: false, reason }` (plain English, for a console warning).
 * Fields: `id` (required, `PAGE_ID_RE`), `label` (required, ≤ PAGE_LABEL_MAX), `hint` (optional, ≤ PAGE_HINT_MAX), `icon` (optional:
 * an SVG path or Font Awesome classes), `fa` (optional: Font Awesome classes), `order` (optional finite number), `render` (required
 * function), `visible` and `activate` (optional functions). Other fields are ignored.
 * @param {unknown} def
 * @returns {PageDefResult}
 */
export function readPageDef(def) {
  try {
    if (!def || typeof def !== "object" || Array.isArray(def)) return { ok: false, reason: "expected an object { id, label, render }" };
    const d = /** @type {Record<string, unknown>} */ (def);
    const id = d.id;
    if (typeof id !== "string" || id.length > PAGE_ID_MAX || !PAGE_ID_RE.test(id)) return { ok: false, reason: `id ${JSON.stringify(String(id ?? "")).slice(0, 90)} should look like "my-module.page" (your module id, a dot, then letters, digits, _ or -)` };
    const label = text(d.label);
    if (!label) return { ok: false, reason: `${id}: needs a label` };
    if (label.length > PAGE_LABEL_MAX) return { ok: false, reason: `${id}: the label is longer than ${PAGE_LABEL_MAX} characters` };
    const hint = d.hint === undefined || d.hint === null ? "" : text(d.hint);
    if (hint === null) return { ok: false, reason: `${id}: the hint should be text` };
    if (hint.length > PAGE_HINT_MAX) return { ok: false, reason: `${id}: the hint is longer than ${PAGE_HINT_MAX} characters` };
    /** @type {string | null} */
    let icon = null;
    /** @type {string | null} */
    let fa = null;
    for (const key of ["icon", "fa"]) {
      const raw = d[key];
      if (raw === undefined || raw === null || raw === "") continue;
      const s = text(raw);
      if (s && PAGE_FA_RE.test(s)) { fa ??= s; continue; }
      if (key === "icon" && s && s.length <= PAGE_ICON_MAX && PAGE_PATH_RE.test(s)) { icon = s; continue; }
      return { ok: false, reason: key === "icon"
        ? `${id}: the icon should be one SVG path (drawing commands and numbers only, at most ${PAGE_ICON_MAX} characters) or Font Awesome classes like "fa-solid fa-hammer"`
        : `${id}: fa should be Font Awesome classes like "fa-solid fa-hammer"` };
    }
    /** @type {number | null} */
    let order = null;
    if (d.order !== undefined && d.order !== null) {
      if (typeof d.order !== "number" || !Number.isFinite(d.order)) return { ok: false, reason: `${id}: order should be a number` };
      order = d.order;
    }
    if (!isFn(d.render)) return { ok: false, reason: `${id}: render should be a function` };
    for (const key of ["visible", "activate"]) {
      if (d[key] !== undefined && d[key] !== null && !isFn(d[key])) return { ok: false, reason: `${id}: ${key} should be a function` };
    }
    return { ok: true, page: Object.freeze({
      id, label, hint, icon, fa, order,
      render: /** @type {GuestPage["render"]} */ (d.render),
      visible: /** @type {GuestPage["visible"]} */ (d.visible ?? null),
      activate: /** @type {GuestPage["activate"]} */ (d.activate ?? null),
      guest: /** @type {const} */ (true)
    }) };
  } catch (e) {
    // A getter on the definition threw: refuse it like any other bad definition.
    return { ok: false, reason: `the definition couldn't be read (${/** @type {any} */ (e)?.message ?? e})` };
  }
}

/**
 * Pages in display order: by `order` (null last), then the host's own pages before guests, then by id. Stable for equal keys.
 * @template {{ id: string, order?: number | null, guest?: boolean }} P
 * @param {readonly P[]} list
 * @returns {P[]}
 */
export function orderPages(list) {
  const key = (/** @type {P} */ p) => (typeof p.order === "number" && Number.isFinite(p.order) ? p.order : Infinity);
  return [...(list ?? [])].sort((a, b) => (key(a) - key(b) || 0)
    || (Number(!!a.guest) - Number(!!b.guest))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * @typedef {object} PageHost
 * @property {string} hostId
 * @property {(def: unknown) => PageOff} register adds (or replaces, same id) a guest page; never throws
 * @property {(id: string) => boolean} unregister true when a guest page was removed
 * @property {(ctx?: unknown) => Array<BuiltInPage | GuestPage>} pages the host's pages and the guests visible for `ctx`, in order
 * @property {(ctx?: unknown) => GuestPage[]} guests only the guests visible for `ctx`, in order
 * @property {(id: string) => BuiltInPage | GuestPage | null} get a page by id (built-in or guest)
 * @property {(id: string) => boolean} has
 * @property {() => number} size guest pages registered
 */

/**
 * `off()` from `register`: removes that registration (not a later one with the same id). `ok` tells whether it was accepted;
 * `reason` why not.
 * @typedef {(() => boolean) & { ok: boolean, reason?: string }} PageOff
 */

/**
 * A page registry for one host window. Built-ins are the host's own pages (`{ id, order, ...anything }`, optional `visible(ctx)`);
 * a programming mistake in them throws here, so the host's tests catch it. Guests come through `register`, which never throws.
 * `onChange({ type: "register" | "unregister", id })` runs after each change (the host re-renders its open windows); a throw there
 * is logged. `visible` that throws hides the page (logged once per page).
 * @param {{ hostId: string, builtIn?: ReadonlyArray<{ id: string, order: number, visible?: unknown, [k: string]: unknown }>,
 *   onChange?: (change: { type: "register" | "unregister", id: string }) => void, max?: number, warn?: (...args: unknown[]) => void }} opts
 * @returns {PageHost}
 */
export function createPageHost(opts) {
  const { hostId, builtIn = [], onChange, max = PAGE_GUESTS_MAX } = opts ?? /** @type {any} */ ({});
  if (typeof hostId !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(hostId)) throw new Error("createPageHost(): needs the host module id");
  if (!Array.isArray(builtIn)) throw new Error(`createPageHost(${hostId}): builtIn should be an array`);
  if (onChange !== undefined && !isFn(onChange)) throw new Error(`createPageHost(${hostId}): onChange should be a function`);
  if (!Number.isInteger(max) || max < 0) throw new Error(`createPageHost(${hostId}): max should be a whole number`);
  const warn = isFn(opts.warn) ? /** @type {(...args: unknown[]) => void} */ (opts.warn) : (/** @type {unknown[]} */ ...a) => console.warn(`${hostId} |`, ...a);
  /** @type {BuiltInPage[]} */
  const own = builtIn.map(b => {
    if (!b || typeof b !== "object" || typeof b.id !== "string" || !b.id) throw new Error(`createPageHost(${hostId}): every built-in page needs an id`);
    if (typeof b.order !== "number" || !Number.isFinite(b.order)) throw new Error(`createPageHost(${hostId}): built-in page ${b.id} needs a numeric order`);
    if (b.visible !== undefined && b.visible !== null && !isFn(b.visible)) throw new Error(`createPageHost(${hostId}): built-in page ${b.id}: visible should be a function`);
    return /** @type {BuiltInPage} */ (Object.freeze({ ...b, guest: false }));
  });
  const ownIds = new Set(own.map(b => b.id));
  if (ownIds.size !== own.length) throw new Error(`createPageHost(${hostId}): built-in page ids must be unique`);
  /** @type {Map<string, GuestPage>} */
  const guests = new Map();
  /** Pages whose visible() threw (warned once). */
  const warned = new Set();
  const changed = (/** @type {"register" | "unregister"} */ type, /** @type {string} */ id) => {
    if (!onChange) return;
    try { onChange({ type, id }); } catch (e) { warn(`guest page ${id}: refreshing after ${type} failed`, e); }
  };
  /** @param {{ id: string, visible?: unknown }} p @param {unknown} ctx */
  const shows = (p, ctx) => {
    if (!isFn(p.visible)) return true;
    try { return /** @type {Function} */ (p.visible)(ctx) !== false; } catch (e) {
      if (!warned.has(p.id)) { warned.add(p.id); warn(`page ${p.id}: visible() failed, page hidden`, e); }
      return false;
    }
  };
  /** @param {boolean} ok @param {() => boolean} fn @param {string} [reason] @returns {PageOff} */
  const offFn = (ok, fn, reason) => Object.assign(fn, ok ? { ok } : { ok, reason });

  return Object.freeze({
    hostId,
    register(def) {
      const r = readPageDef(def);
      if (!r.ok) { warn(`guest page refused: ${r.reason}`); return offFn(false, () => false, r.reason); }
      const page = r.page;
      if (!guests.has(page.id) && guests.size >= max) {
        const reason = `${page.id}: ${hostId} already has ${max} guest pages`;
        warn(`guest page refused: ${reason}`);
        return offFn(false, () => false, reason);
      }
      guests.set(page.id, page);
      warned.delete(page.id);
      changed("register", page.id);
      return offFn(true, () => {
        if (guests.get(page.id) !== page) return false; // replaced since: leave the newer one
        guests.delete(page.id); changed("unregister", page.id); return true;
      });
    },
    unregister(id) {
      if (!guests.has(id)) return false;
      guests.delete(id); changed("unregister", id); return true;
    },
    pages(ctx) { return orderPages([...own.filter(p => shows(p, ctx)), ...[...guests.values()].filter(p => shows(p, ctx))]); },
    guests(ctx) { return orderPages([...guests.values()].filter(p => shows(p, ctx))); },
    get(id) { return own.find(p => p.id === id) ?? guests.get(id) ?? null; },
    has(id) { return ownIds.has(id) || guests.has(id); },
    size() { return guests.size; }
  });
}

/**
 * Whether a value is a DOM element or fragment (duck-typed, so it runs in Node).
 * @param {unknown} x
 * @returns {boolean}
 */
const isNode = x => !!x && typeof x === "object" && (/** @type {any} */ (x).nodeType === 1 || /** @type {any} */ (x).nodeType === 11);

/**
 * Calls a guest page's render inside try/catch with a time limit. Never throws, never rejects. The context is passed as a frozen
 * shallow copy. Result: `{ html }` (a string, inserted by the host as is: guests escape their own data), `{ element }` (an element
 * or fragment), or `{ error }` (plain text: it threw, timed out or returned something else; the host shows one line).
 * @param {{ id: string, render: (ctx: any) => unknown }} page
 * @param {Record<string, unknown>} [ctx]
 * @param {{ timeoutMs?: number }} [o]
 * @returns {Promise<{ html: string } | { element: unknown } | { error: string }>}
 */
export async function renderGuest(page, ctx = {}, o = {}) {
  const ms = Number.isFinite(o.timeoutMs) && /** @type {number} */ (o.timeoutMs) > 0 ? /** @type {number} */ (o.timeoutMs) : PAGE_RENDER_MS;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    const out = await Promise.race([
      Promise.resolve().then(() => page.render(Object.freeze({ ...ctx }))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`took longer than ${Math.round(ms / 100) / 10} s`)), ms); })
    ]);
    if (out === undefined || out === null) return { html: "" };
    if (typeof out === "string") return { html: out };
    if (isNode(out)) return { element: out };
    return { error: `render returned ${Array.isArray(out) ? "an array" : typeof out}, not HTML text or an element` };
  } catch (e) {
    return { error: String(/** @type {any} */ (e)?.message ?? e) || "render failed" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Calls a guest page's optional `activate(ctx)` after the host inserted its body. Never throws; an async activate's rejection is
 * caught too. `{ ok: true }` or `{ error }`.
 * @param {{ id: string, activate?: ((ctx: any) => unknown) | null }} page
 * @param {Record<string, unknown>} [ctx]
 * @returns {Promise<{ ok: true } | { error: string }>}
 */
export async function activateGuest(page, ctx = {}) {
  if (!isFn(page?.activate)) return { ok: true };
  try { await /** @type {Function} */ (page.activate)(Object.freeze({ ...ctx })); return { ok: true }; }
  catch (e) { return { error: String(/** @type {any} */ (e)?.message ?? e) || "activate failed" }; }
}
