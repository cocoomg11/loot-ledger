/**
 * Capped record lists and schema-version normalizers. Pure: no Foundry calls, tested in Node.
 *
 * House rules these support: every list-like stored value has a cap (and a test); every stored shape that has changed before or is
 * likely to carries a version and is read through one normalizer. Bump the version and add an upgrade step when the shape changes.
 */

/**
 * A new list with `entry` first and at most `max` entries; the oldest drop off. Entries with the same key as `entry` are removed
 * first (so re-adding moves it to the top). Bad stored values (not an array, non-object entries) count as empty.
 * @template T
 * @param {unknown} list the stored list, newest first
 * @param {T} entry
 * @param {{ max: number, key?: string | null }} opts `key`: field that identifies an entry (default "id"; null: no de-dup)
 * @returns {T[]}
 */
export function addCapped(list, entry, { max, key = "id" }) {
  const old = Array.isArray(list) ? list.filter(e => e !== null && e !== undefined) : [];
  const k = key && entry && typeof entry === "object" ? /** @type {any} */ (entry)[key] : undefined;
  const rest = k === undefined || !key ? old : old.filter(e => !(e && typeof e === "object" && e[key] === k));
  return [entry, ...rest].slice(0, Math.max(1, Math.floor(max)));
}

/**
 * The list trimmed to `max` entries, keeping the first ones (newest first) or the last ones (`keep: "last"`, for oldest-first
 * logs). A non-array gives [].
 * @template T
 * @param {unknown} list
 * @param {number} max
 * @param {{ keep?: "first" | "last" }} [opts]
 * @returns {T[]}
 */
export function capList(list, max, { keep = "first" } = {}) {
  if (!Array.isArray(list)) return [];
  const n = Math.max(0, Math.floor(max));
  if (list.length <= n) return [...list];
  return keep === "last" ? list.slice(list.length - n) : list.slice(0, n);
}

/**
 * @typedef {object} VersionedSpec
 * @property {number} version the current shape version (an integer, 1 or more)
 * @property {string} [field] where the version is stored on the object (default "v")
 * @property {() => any} empty a fresh value of the current shape (used for missing or unreadable values)
 * @property {Record<number, (old: any) => any>} [upgrades] upgrades[n] turns a version-n value into version n+1. A value without the
 *   field counts as version 0.
 * @property {(value: any) => any} [clean] runs last on every value (current or upgraded): fix types, apply caps
 */

/**
 * Builds the one normalizer for a stored shape. The returned function never throws: an unreadable value, a missing upgrade step
 * or a failing step gives `empty()`. A value from a newer version than this code knows is returned as `empty()` too unless
 * `keepNewer` is set, because reading a shape we don't understand risks writing it back damaged.
 * @param {VersionedSpec & { keepNewer?: boolean }} spec
 * @returns {(raw: unknown) => any}
 */
export function versioned(spec) {
  const field = spec.field ?? "v";
  const current = spec.version;
  if (!Number.isInteger(current) || current < 1) throw new Error("versioned(): version must be an integer of 1 or more");
  const clean = spec.clean ?? (x => x);
  return raw => {
    try {
      if (!raw || typeof raw !== "object") return clean(spec.empty());
      let value = structuredClone(raw);
      let v = Number.isInteger(value[field]) ? value[field] : 0;
      if (v > current) return spec.keepNewer ? value : clean(spec.empty());
      while (v < current) {
        const step = spec.upgrades?.[v];
        if (typeof step !== "function") return clean(spec.empty());
        value = step(value);
        if (!value || typeof value !== "object") return clean(spec.empty());
        v += 1;
        value[field] = v;
      }
      value[field] = current;
      return clean(value);
    } catch {
      return clean(spec.empty());
    }
  };
}
