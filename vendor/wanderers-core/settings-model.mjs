/**
 * The settings table, pure (tested in Node). Every setting except the feature switches is one row; the Foundry half
 * (src/foundry/settings.mjs) registers them, and a module's control panel shows them on their tab, Basic first and the rest under
 * Advanced. Keys are stable across versions: never rename one (a renamed key silently resets every world's choice).
 *
 * Row: { key, type: "bool" | "text" | "number" | "choice" | "object" | "array", default, label, hint, tab, advanced, feature
 *        ("a" or "a:b"), min, max, step, choices, hidden (records the module writes itself), client (scope "client"),
 *        user (scope "user"), reload (requiresReload), onChange }
 */

const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const TYPES = new Set(["bool", "text", "number", "choice", "object", "array"]);

/**
 * @typedef {object} SettingRow
 * @property {string} key
 * @property {"bool" | "text" | "number" | "choice" | "object" | "array"} type
 * @property {unknown} default
 * @property {string} [label]
 * @property {string} [hint]
 * @property {string} [tab]
 * @property {boolean} [advanced]
 * @property {string | null} [feature]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {Record<string, string>} [choices]
 * @property {boolean} [hidden]
 * @property {boolean} [client]
 * @property {boolean} [user]
 * @property {boolean} [reload]
 * @property {(value: unknown) => void} [onChange]
 */

/**
 * Checks the table once and returns it frozen. Throws on a programming mistake (duplicate or bad key, unknown type, a default that
 * doesn't fit, a key in `reserved` such as the feature switches).
 * @param {SettingRow[]} rows
 * @param {{ reserved?: Iterable<string> }} [opts]
 * @returns {readonly SettingRow[]}
 */
export function defineSettings(rows, { reserved = [] } = {}) {
  if (!Array.isArray(rows)) throw new Error("defineSettings(): expected a list");
  const taken = new Set(reserved); const seen = new Set();
  for (const r of rows) {
    if (!r || typeof r.key !== "string" || !KEY_RE.test(r.key)) throw new Error(`defineSettings(): bad key ${JSON.stringify(r?.key)}`);
    if (seen.has(r.key)) throw new Error(`defineSettings(): duplicate key ${r.key}`);
    if (taken.has(r.key)) throw new Error(`defineSettings(): key ${r.key} is reserved`);
    if (!TYPES.has(r.type)) throw new Error(`defineSettings(): ${r.key} has unknown type ${r.type}`);
    if (r.type === "choice" && !(r.choices && Object.hasOwn(r.choices, String(r.default)))) throw new Error(`defineSettings(): ${r.key} default isn't one of its choices`);
    if (r.type === "number" && typeof r.default !== "number") throw new Error(`defineSettings(): ${r.key} default should be a number`);
    if (r.type === "bool" && typeof r.default !== "boolean") throw new Error(`defineSettings(): ${r.key} default should be true or false`);
    if (r.client && r.user) throw new Error(`defineSettings(): ${r.key} can't be both client and user scope`);
    seen.add(r.key);
  }
  return Object.freeze(rows.map(r => Object.freeze({ ...r })));
}

/**
 * The scope a row registers with.
 * @param {SettingRow} r
 * @returns {"world" | "client" | "user"}
 */
export const scopeOf = r => r.client ? "client" : r.user ? "user" : "world";

/**
 * Hidden record rows (written by the module, never shown, never reset by "Reset tab").
 * @param {readonly SettingRow[]} rows
 * @returns {string[]}
 */
export const records = rows => rows.filter(r => r.hidden).map(r => r.key);

/**
 * The rows of a tab, split into { basic, advanced }, skipping hidden rows and rows whose feature is off.
 * @param {readonly SettingRow[]} rows
 * @param {string} tab
 * @param {(spec: string) => boolean} [featureOn] e.g. spec => allOn(FEATURES, spec, get)
 * @returns {{ basic: SettingRow[], advanced: SettingRow[] }}
 */
export function tabRows(rows, tab, featureOn = () => true) {
  const list = rows.filter(r => r.tab === tab && !r.hidden && (!r.feature || featureOn(r.feature)));
  return { basic: list.filter(r => !r.advanced), advanced: list.filter(r => r.advanced) };
}

/**
 * A form value converted to the row's type, clamped; `null` when it can't be read (keep the old value).
 * @param {SettingRow} r
 * @param {unknown} raw
 * @returns {unknown}
 */
export function convert(r, raw) {
  switch (r.type) {
    case "bool": return raw === true || raw === "on" || raw === "true";
    case "number": {
      if (raw === "" || raw === null || raw === undefined) return null;
      let n = Number(raw);
      if (!Number.isFinite(n)) return null;
      if (r.step && Number.isInteger(r.step)) n = Math.round(n);
      return Math.min(r.max ?? Infinity, Math.max(r.min ?? -Infinity, n));
    }
    case "text": return String(raw ?? "").trim() || String(r.default ?? "");
    case "choice": { const s = String(raw ?? ""); return r.choices && Object.hasOwn(r.choices, s) ? s : null; }
    default: return null;
  }
}

/**
 * The registration data for one row, without Foundry types (the Foundry half maps `type`). `name`/`hint` only for rows with a label.
 * @param {SettingRow} r
 * @returns {Record<string, unknown>}
 */
export function registration(r) {
  /** @type {Record<string, unknown>} */
  const cfg = { scope: scopeOf(r), config: false, type: r.type, default: r.default };
  if (r.label) { cfg.name = r.label; cfg.hint = r.hint ?? ""; }
  if (r.type === "number" && (r.min !== undefined || r.max !== undefined)) cfg.range = { min: r.min, max: r.max, step: r.step ?? 1 };
  if (r.type === "choice") cfg.choices = { ...r.choices };
  if (r.reload) cfg.requiresReload = true;
  if (typeof r.onChange === "function") cfg.onChange = r.onChange;
  return cfg;
}
