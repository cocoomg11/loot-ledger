/**
 * Remembered window placement: the pure rules (store shape, reading, clamping to the viewport, debouncing). No Foundry calls,
 * tested in Node. The Foundry half is ../foundry/window.mjs (`RememberedWindow`).
 *
 * One hidden client setting per module, `<moduleId>.windowPlacement` (`PLACEMENT_SETTING`), holds every remembered window of that
 * module: `{ v: 1, windows: { <window key>: { left, top, width?, height?, minimized? } } }`. Width and height are Foundry's unscaled
 * pixels (ApplicationPosition), left and top are page pixels.
 */
import { versioned } from "./records.mjs";

/** The client setting key each module registers (in its own namespace). */
export const PLACEMENT_SETTING = "windowPlacement";
/** Version of the stored shape. */
export const PLACEMENT_VERSION = 1;
/** At most this many windows are remembered per module; the least recently saved is dropped first. */
export const PLACEMENT_MAX = 50;
/** Saves wait this long after the last move or resize. */
export const PLACEMENT_SAVE_MS = 400;
/** Smallest width and height a restored window gets (a stored 0 or 5 would hide it). */
export const PLACEMENT_MIN_SIZE = 120;
/** Window keys: letters, digits, "_", "-", "." (1 to 64), so they're safe as object keys and readable in the setting. */
export const WINDOW_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

/** @typedef {{ left: number, top: number, width?: number, height?: number, minimized?: boolean }} Placement */
/** @typedef {{ v: number, windows: Record<string, Placement> }} PlacementStore */
/** @typedef {{ width: number, height: number }} Viewport */

const num = (/** @type {unknown} */ x) => typeof x === "number" && Number.isFinite(x);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Whether `key` can name a window (see WINDOW_KEY_RE; never "__proto__" and friends).
 * @param {unknown} key
 * @returns {key is string}
 */
export function isWindowKey(key) { return typeof key === "string" && WINDOW_KEY_RE.test(key) && !UNSAFE_KEYS.has(key); }

/**
 * One stored placement, cleaned: whole pixels, sizes positive (at least PLACEMENT_MIN_SIZE), "auto" or bad sizes dropped,
 * `minimized` only when true. null when left/top aren't finite numbers. Never throws.
 * @param {unknown} raw
 * @returns {Placement | null}
 */
export function readPlacement(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (!num(r.left) || !num(r.top)) return null;
  /** @type {Placement} */
  const out = { left: Math.round(/** @type {number} */ (r.left)), top: Math.round(/** @type {number} */ (r.top)) };
  if (num(r.width) && /** @type {number} */ (r.width) > 0) out.width = Math.max(PLACEMENT_MIN_SIZE, Math.round(/** @type {number} */ (r.width)));
  if (num(r.height) && /** @type {number} */ (r.height) > 0) out.height = Math.max(PLACEMENT_MIN_SIZE, Math.round(/** @type {number} */ (r.height)));
  if (r.minimized === true) out.minimized = true;
  return out;
}

const emptyStore = () => ({ v: PLACEMENT_VERSION, windows: {} });

/**
 * The stored setting value, cleaned (never throws): unreadable → empty store; bad keys and placements dropped; at most
 * PLACEMENT_MAX windows (the last ones kept). A store without `v` is read as version 1; one from a newer core version is read as
 * empty.
 * @type {(raw: unknown) => PlacementStore}
 */
export const readPlacements = versioned({
  version: PLACEMENT_VERSION,
  empty: emptyStore,
  // A value without "v" (written by hand or by a macro) is read as version 1.
  upgrades: { 0: x => x },
  clean(value) {
    const src = value?.windows && typeof value.windows === "object" && !Array.isArray(value.windows) ? value.windows : {};
    /** @type {Record<string, Placement>} */
    const windows = {};
    for (const [k, p] of Object.entries(src)) {
      const clean = isWindowKey(k) ? readPlacement(p) : null;
      if (clean) windows[k] = clean;
    }
    const keys = Object.keys(windows);
    for (const k of keys.slice(0, Math.max(0, keys.length - PLACEMENT_MAX))) delete windows[k];
    return { v: PLACEMENT_VERSION, windows };
  }
});

/**
 * The saved placement of one window, or null.
 * @param {unknown} store the setting value (read with readPlacements)
 * @param {string} key
 * @returns {Placement | null}
 */
export function getPlacement(store, key) {
  if (!isWindowKey(key)) return null;
  return readPlacements(store).windows[key] ?? null;
}

/**
 * A new store with `key` set to `placement` (moved to the end, so it is the last to be dropped by the cap). Throws on a bad key
 * (a programming mistake); a placement that can't be read removes the entry.
 * @param {unknown} store
 * @param {string} key
 * @param {unknown} placement
 * @returns {PlacementStore}
 */
export function setPlacement(store, key, placement) {
  if (!isWindowKey(key)) throw new Error(`window placement: bad window key ${JSON.stringify(key)}`);
  const next = readPlacements(store);
  delete next.windows[key];
  const p = readPlacement(placement);
  if (p) next.windows[key] = p;
  return readPlacements(next);
}

/**
 * A new store without `key`, or empty when `key` is omitted.
 * @param {unknown} store
 * @param {string} [key]
 * @returns {PlacementStore}
 */
export function removePlacement(store, key) {
  if (key === undefined) return emptyStore();
  const next = readPlacements(store);
  if (isWindowKey(key)) delete next.windows[key];
  return next;
}

/**
 * Whether two placements are the same once cleaned (so an unchanged window isn't saved again).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function samePlacement(a, b) {
  const A = readPlacement(a), B = readPlacement(b);
  if (!A || !B) return A === B;
  return A.left === B.left && A.top === B.top && A.width === B.width && A.height === B.height && !!A.minimized === !!B.minimized;
}

/**
 * Fits a placement inside the viewport: the size shrinks to the viewport (never below `minWidth`/`minHeight`), then the window
 * moves so it is fully on screen (top-left corner wins when the window is bigger than the viewport). `scale` is the window's
 * scale (ApplicationPosition `scale`, from the UI scale): the on-screen size is width × scale. Missing width/height stay missing
 * (the window keeps its own size); pass `size` (the window's current unscaled size) to keep it on screen anyway. Never throws; a
 * bad viewport returns the cleaned placement unclamped.
 * @param {unknown} placement
 * @param {Viewport} viewport page size in pixels (window.innerWidth/innerHeight)
 * @param {{ scale?: number, minWidth?: number, minHeight?: number, size?: { width?: unknown, height?: unknown } }} [opts]
 * @returns {Placement | null}
 */
export function clampPlacement(placement, viewport, { scale = 1, minWidth = PLACEMENT_MIN_SIZE, minHeight = PLACEMENT_MIN_SIZE, size = {} } = {}) {
  const p = readPlacement(placement);
  if (!p) return null;
  const vw = viewport?.width, vh = viewport?.height;
  if (!num(vw) || !num(vh) || vw <= 0 || vh <= 0) return p;
  const s = num(scale) && scale > 0 ? scale : 1;
  /** @type {Placement} */
  const out = { ...p };
  const fit = (/** @type {number} */ v, /** @type {number} */ max, /** @type {number} */ min) => Math.max(Math.min(v, Math.floor(max / s)), Math.min(min, Math.floor(max / s)));
  if (out.width !== undefined) out.width = fit(out.width, vw, minWidth);
  if (out.height !== undefined) out.height = fit(out.height, vh, minHeight);
  const w = out.width ?? (num(size.width) ? /** @type {number} */ (size.width) : 0);
  const h = out.height ?? (num(size.height) ? /** @type {number} */ (size.height) : 0);
  out.left = Math.max(0, Math.min(out.left, Math.floor(vw - w * s)));
  out.top = Math.max(0, Math.min(out.top, Math.floor(vh - h * s)));
  return out;
}

/**
 * The part of an ApplicationPosition worth saving: left/top always, width/height when `size` and they are numbers (not "auto").
 * @param {unknown} position
 * @param {{ size?: boolean, minimized?: boolean }} [opts]
 * @returns {Placement | null}
 */
export function placementOf(position, { size = true, minimized } = {}) {
  if (!position || typeof position !== "object") return null;
  const p = /** @type {Record<string, unknown>} */ (position);
  return readPlacement({ left: p.left, top: p.top, ...(size ? { width: p.width, height: p.height } : {}), minimized: minimized === true });
}

/**
 * A debounced call: `call()` (re)starts the timer; `flush()` runs a pending call now; `cancel()` drops it. Timers are injectable
 * for tests.
 * @param {() => void} fn
 * @param {number} ms
 * @param {{ set?: (fn: () => void, ms: number) => any, clear?: (id: any) => void }} [timers]
 */
export function debouncer(fn, ms, { set = setTimeout, clear = clearTimeout } = {}) {
  /** @type {any} */
  let id = null;
  const run = () => { id = null; fn(); };
  return {
    call() { if (id !== null) clear(id); id = set(run, ms); },
    flush() { if (id === null) return; clear(id); run(); },
    cancel() { if (id !== null) clear(id); id = null; },
    pending: () => id !== null
  };
}
