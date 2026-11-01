/**
 * "Remove <module> data", pure (tested in Node). House rule: cleanup covers everything we write. The Foundry half reads the world
 * into plain lists; the module's own `plan()` sorts them into its categories; `dryRun()` shows counts and names; nothing changes until
 * the GM ticks categories and types REMOVE.
 *
 * Category: [key, label, tickedByDefault]. A plan is { [key]: [{ id | uuid | key, name }] }.
 */

/** The word the GM types to confirm. */
export const CONFIRM_WORD = "REMOVE";

/** @typedef {[key: string, label: string, ticked?: boolean]} Category */
/** @typedef {{ id?: string, uuid?: string, key?: string, name: string }} PlanItem */
/** @typedef {Record<string, PlanItem[]>} Plan */

/**
 * Whether the typed text confirms (trimmed, exact case).
 * @param {unknown} text
 * @returns {boolean}
 */
export const confirmed = text => String(text ?? "").trim() === CONFIRM_WORD;

/**
 * Our flags on a document's data (`flags[ns]` is a non-empty object), reading `_source` first when present.
 * @param {any} doc
 * @param {string} ns
 * @returns {boolean}
 */
export function hasFlags(doc, ns) {
  const f = doc?._source?.flags?.[ns] ?? doc?.flags?.[ns];
  return !!(f && typeof f === "object" && Object.keys(f).length);
}

/**
 * The plain-text dry run: one row per category with its count and the first few names.
 * @param {readonly Category[]} categories
 * @param {Plan} plan
 * @param {number} [max]
 * @returns {{ key: string, label: string, count: number, ticked: boolean, text: string }[]}
 */
export function dryRun(categories, plan, max = 5) {
  return categories.map(([key, label, ticked = false]) => {
    const list = plan[key] ?? [];
    const names = list.slice(0, max).map(x => x.name).join(", ");
    return { key, label, count: list.length, ticked: !!ticked, text: `${label}: ${list.length}${list.length ? ` (${names}${list.length > max ? ", …" : ""})` : ""}` };
  });
}

/**
 * The ticked categories that have something in them, from a pick object { key: boolean }.
 * @param {readonly Category[]} categories
 * @param {Record<string, unknown>} pick
 * @param {Plan} plan
 * @returns {string[]}
 */
export function picked(categories, pick, plan) {
  return categories.map(c => c[0]).filter(k => pick?.[k] && (plan[k]?.length ?? 0) > 0);
}

/**
 * World settings of our namespace whose value differs from the default: the "reset settings" category.
 * `defs`: [{ key, scope, default, value }].
 * @param {{ key: string, scope?: string, default?: unknown, value?: unknown }[]} defs
 * @param {{ scopes?: string[] }} [opts]
 * @returns {PlanItem[]}
 */
export function changedSettings(defs, { scopes = ["world"] } = {}) {
  return (defs ?? []).filter(d => d && scopes.includes(d.scope ?? "world") && JSON.stringify(d.value ?? null) !== JSON.stringify(d.default ?? null))
    .map(d => ({ key: d.key, name: d.key }));
}

/**
 * A one-line summary of what was removed: "messages 3, settings 2" or "nothing".
 * @param {Record<string, number>} done
 * @param {readonly Category[]} [categories] for labels (text before the first " (" is used)
 * @returns {string}
 */
export function summary(done, categories = []) {
  const label = Object.fromEntries(categories.map(([k, l]) => [k, l.replace(/ \(.*$/, "")]));
  const parts = Object.entries(done ?? {}).map(([k, n]) => `${label[k] ?? k}: ${n}`);
  return parts.length ? parts.join("; ") : "nothing";
}
