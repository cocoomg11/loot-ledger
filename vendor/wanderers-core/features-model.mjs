/**
 * The feature registry, pure (tested in Node). One world setting per tool: a turned-off tool registers nothing (no hooks, buttons,
 * key bindings, socket handlers or wrappers) and its API entry is undefined. The Foundry half (src/foundry/features.mjs) registers
 * the settings and reads them.
 *
 * Feature: { id, label, hint, default = true, key = "feature-<id>", needs?: [other feature ids] }.
 * `key` may be given for a setting that existed before the registry; keys never change once released.
 */

const ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * @typedef {object} FeatureInput
 * @property {string} id
 * @property {string} label
 * @property {string} [hint]
 * @property {boolean} [default]
 * @property {string} [key]
 * @property {string[]} [needs] features this one only works with (checked by `isOn`)
 */
/** @typedef {Readonly<Required<Omit<FeatureInput, "needs">> & { needs: readonly string[] }>} Feature */

/**
 * Fills in the defaults and checks the list once. Throws on a programming mistake (duplicate id or key, a bad id, a need that
 * isn't in the list), so it fails in tests rather than in a live world.
 * @param {FeatureInput[]} list
 * @returns {readonly Feature[]}
 */
export function defineFeatures(list) {
  if (!Array.isArray(list)) throw new Error("defineFeatures(): expected a list");
  const ids = new Set(), keys = new Set();
  const out = list.map(f => {
    if (!f || typeof f.id !== "string" || !ID_RE.test(f.id)) throw new Error(`defineFeatures(): bad feature id ${JSON.stringify(f?.id)}`);
    if (ids.has(f.id)) throw new Error(`defineFeatures(): duplicate feature id ${f.id}`);
    const key = f.key ?? `feature-${f.id}`;
    if (keys.has(key)) throw new Error(`defineFeatures(): duplicate setting key ${key}`);
    ids.add(f.id); keys.add(key);
    return Object.freeze({ id: f.id, label: String(f.label ?? f.id), hint: String(f.hint ?? ""), default: f.default ?? true, key, needs: Object.freeze([...(f.needs ?? [])]) });
  });
  for (const f of out) for (const n of f.needs) if (!ids.has(n)) throw new Error(`defineFeatures(): ${f.id} needs unknown feature ${n}`);
  return Object.freeze(out);
}

/**
 * Whether a feature is on, from a setting getter `(key) => value` (which may throw before settings are registered). Unknown ids
 * count as on (so a typo never silently disables something; tests catch typos). A feature whose `needs` are off counts as off.
 * @param {readonly Feature[]} features
 * @param {string} id
 * @param {(key: string) => unknown} get
 * @param {Set<string>} [seen] internal: guards against need loops
 * @returns {boolean}
 */
export function isOn(features, id, get, seen = new Set()) {
  const f = features.find(x => x.id === id);
  if (!f) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  let v;
  try { v = get(f.key); } catch { v = undefined; }
  const self = v === undefined || v === null ? f.default : !!v;
  return self && f.needs.every(n => isOn(features, n, get, seen));
}

/**
 * Feature ids a combined id names: "a" or "a:b:c" (all must be on). Used by settings rows and macros that need several tools.
 * @param {string | null | undefined} spec
 * @returns {string[]}
 */
export function splitNeeds(spec) {
  return String(spec ?? "").split(":").map(s => s.trim()).filter(Boolean);
}

/**
 * Whether every feature in a combined id is on. An empty spec is always on.
 * @param {readonly Feature[]} features
 * @param {string | null | undefined} spec
 * @param {(key: string) => unknown} get
 * @returns {boolean}
 */
export function allOn(features, spec, get) {
  return splitNeeds(spec).every(id => isOn(features, id, get));
}
