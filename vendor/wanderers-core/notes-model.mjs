/**
 * Update notes, pure (tested in Node): what changed in each version in plain words, and what a GM may need to do after updating.
 * The module posts them (its own card, its own setting for the last version seen); core only decides what to show.
 *
 * Entry: { version, changes: [text | { text, feature }], actions?: [Action] }.
 * Action: { id, label, icon?, hint?, feature?, check(ctx) → true while it still needs doing, run(ctx) }.
 * Lines and actions with a `feature` are left out while that feature is off. A version with nothing to say needs no entry.
 */
import { compareVersions, parseVersion } from "./version.mjs";

/** @typedef {{ id: string, label: string, icon?: string, hint?: string, feature?: string, check?: (ctx: any) => unknown, run?: (ctx: any) => unknown }} Action */
/** @typedef {{ version: string, changes?: (string | { text: string, feature?: string })[], actions?: Action[] }} NoteEntry */
/** @typedef {{ kind: "fresh" | "upgrade" | "same" | "downgrade", from: string | null }} Decision */

/**
 * What to do on ready, from the stored "last version seen" and the running version:
 * "fresh" (no record: a new world unless `knownWorld`; store the version, say nothing), "upgrade" (show notes after `from`; null = an
 * unknown older version), "same", "downgrade" (store the running version silently, so updating again shows the notes again).
 * @param {{ stored?: string | null, current?: string, knownWorld?: boolean }} opts
 *   knownWorld: the world was set up by an older version that kept no record (treat as an upgrade from an unknown version)
 * @returns {Decision}
 */
export function decide({ stored = "", current = "", knownWorld = false } = {}) {
  if (!parseVersion(current)) return { kind: "same", from: null };
  if (parseVersion(stored)) {
    const c = compareVersions(current, stored);
    return c === 1 ? { kind: "upgrade", from: String(stored) } : c === -1 ? { kind: "downgrade", from: String(stored) } : { kind: "same", from: String(stored) };
  }
  return knownWorld ? { kind: "upgrade", from: null } : { kind: "fresh", from: null };
}

/**
 * Entries newer than `from` (exclusive; null = all) up to `to` (inclusive), newest first.
 * @param {NoteEntry[]} notes
 * @param {string | null} [from]
 * @param {string | null} [to]
 * @returns {NoteEntry[]}
 */
export function entriesBetween(notes, from = null, to = null) {
  return notes.filter(n => (from === null || compareVersions(n.version, from) === 1) && (to === null || (compareVersions(n.version, to) ?? 1) <= 0))
    .sort((a, b) => compareVersions(b.version, a.version) ?? 0);
}

/**
 * Builds the notice: { from, to, entries: [{ version, changes: [text] }], actions, post }. Feature-gated lines and actions are dropped
 * while off; actions are de-duplicated by id (newest entry first, then `always`); an action whose check says it's done (or throws)
 * is left out. `post` is false when there's nothing to say.
 * @param {{ notes: NoteEntry[], always?: Action[], from?: string | null, to: string, on?: (feature: string) => boolean, ctx?: object }} opts
 * @returns {Promise<{ from: string | null, to: string, entries: { version: string, changes: string[] }[], actions: Action[], post: boolean }>}
 */
export async function buildNotice({ notes, always = [], from = null, to, on = () => true, ctx = {} }) {
  const allowed = (/** @type {{ feature?: string } | string} */ x) => typeof x === "string" || !x?.feature || on(x.feature);
  const picked = entriesBetween(notes, from, to).map(n => ({
    version: n.version,
    changes: (n.changes ?? []).filter(allowed).map(l => typeof l === "string" ? l : l?.text ?? "").filter(Boolean),
    actions: (n.actions ?? []).filter(allowed)
  }));
  const seen = new Set(); /** @type {Action[]} */ const candidates = [];
  for (const a of [...picked.flatMap(e => e.actions), ...always.filter(allowed)]) if (!seen.has(a.id)) { seen.add(a.id); candidates.push(a); }
  /** @type {Action[]} */ const actions = [];
  for (const a of candidates) {
    let need = false;
    try { need = !!(await a.check?.({ on, ...ctx })); } catch { need = false; }
    if (need) actions.push(a);
  }
  const entries = picked.filter(e => e.changes.length).map(({ version, changes }) => ({ version, changes }));
  return { from, to, entries, actions, post: entries.length > 0 || actions.length > 0 };
}

/**
 * Checks a notes list (for tests): versions readable, newest first, no duplicates, action ids unique per entry.
 * @param {NoteEntry[]} notes
 * @returns {string[]} problems, empty when fine
 */
export function lintNotes(notes) {
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (!parseVersion(n.version)) out.push(`entry ${i} has no readable version`);
    if (i > 0 && compareVersions(notes[i - 1].version, n.version) !== 1) out.push(`${n.version} isn't older than the entry above it`);
    const ids = (n.actions ?? []).map(a => a.id);
    if (new Set(ids).size !== ids.length) out.push(`${n.version} has duplicate action ids`);
  }
  return out;
}
