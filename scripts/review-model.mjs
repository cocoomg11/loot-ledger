/**
 * Review board, pure logic (no Foundry calls; unit-tested in Node):
 *   - review decisions stored on a converted item as flags["loot-ledger"].review = {status, note, by, at};
 *   - state transitions for the board actions (Accept / Tweak / Skip / Reject / Reset / note);
 *   - which items a rebuild must not overwrite, and what review state a rewritten item carries forward;
 *   - which items are left out of the roll tables (Reject);
 *   - the board queue: entries, filters, ordering, progress counts, next / previous item.
 */

/** Every review status. "pending" is the state of a flagged item nobody has decided on yet. */
export const STATUSES = ["pending", "accepted", "tweaked", "skipped", "rejected"];

/** Board action -> resulting status. */
export const ACTIONS = { accept: "accepted", tweak: "tweaked", skip: "skipped", reject: "rejected", reset: "pending" };

/** Statuses that mean "the GM has signed this item off": a rebuild keeps the stored item instead of rewriting it. */
export const PROTECTED = new Set(["accepted", "tweaked"]);

/** Statuses still on the GM's to-do list. */
export const TODO = new Set(["pending", "skipped"]);

/** The stored review status of an item (from its flags["loot-ledger"]), "pending" when none was stored. */
export function statusOf(flags) {
  const s = flags?.review?.status;
  return STATUSES.includes(s) ? s : "pending";
}

/** True when the GM rejected the item: it is left out of the roll tables on the next table build. */
export function isRejected(flags) {
  return flags?.review?.status === "rejected";
}

/**
 * The review object after a board action.
 * @param {object|null} prev   the stored review (or null)
 * @param {string} action      accept | tweak | skip | reject | reset | note (note: change only the note)
 * @param {object} [o]
 * @param {string} [o.by]      user name (or id) making the decision
 * @param {string} [o.at]      ISO timestamp
 * @param {string} [o.note]    new note; undefined keeps the stored note
 * @returns {{status:string, note:string, by:string|null, at:string|null}}
 */
export function applyAction(prev, action, { by = null, at = null, note } = {}) {
  if (action !== "note" && !(action in ACTIONS)) throw new Error(`Loot Ledger: unknown review action "${action}"`);
  const status = action === "note" ? statusOf({ review: prev }) : ACTIONS[action];
  return {
    status,
    note: String(note === undefined ? prev?.note ?? "" : note ?? "").trim(),
    by: by ?? prev?.by ?? null,
    at: at ?? prev?.at ?? null
  };
}

/**
 * Keep reviewed items out of a rebuild. Items the GM accepted or tweaked are not rewritten when their hash changed,
 * so manual edits survive; `force` rewrites them anyway.
 * @param {{create:string[], replace:string[], skip:string[], remove:string[]}} plan  planSync() result for the converted pack
 * @param {Map<string,{flags:object}>} stored  id -> stored Loot Ledger flags (packState().flags)
 * @param {{force?:boolean}} [o]
 * @returns {{plan:object, protected:string[]}}  the plan without the protected ids in `replace`, and those ids
 */
export function protectReviewed(plan, stored, { force = false } = {}) {
  if (force || !plan) return { plan, protected: [] };
  const keep = plan.replace.filter(id => PROTECTED.has(stored.get(id)?.flags?.review?.status));
  if (!keep.length) return { plan, protected: [] };
  const k = new Set(keep);
  return { plan: { ...plan, replace: plan.replace.filter(id => !k.has(id)) }, protected: keep };
}

/**
 * The review state a rewritten converted item carries forward from its stored version (null: none stored).
 * Skip, Reject and notes always survive. A forced rewrite of an accepted / tweaked item discards the manual edits,
 * so its status goes back to pending (`previous` records what it was); the note is kept.
 */
export function carryReview(prev, { force = false } = {}) {
  if (!prev || typeof prev !== "object") return null;
  const status = statusOf({ review: prev });
  const out = { status, note: prev.note ?? "", by: prev.by ?? null, at: prev.at ?? null };
  if (force && PROTECTED.has(status)) return { ...out, status: "pending", previous: status };
  return out;
}

/** True when an item belongs on the board: the converter flagged it for review, or it already has a decision. */
export function onBoard(flags) {
  return !!(flags?.converted?.needsReview || flags?.review);
}

/** The reason part of a stored review line ("<line> — <why>"); the line itself when there is no reason. */
export function reasonOf(line) {
  const s = String(line ?? "");
  const i = s.lastIndexOf(" — ");
  return (i >= 0 ? s.slice(i + 3) : s).trim();
}

/** The tooltip-line part of a stored review line. */
export function lineOf(line) {
  const s = String(line ?? "");
  const i = s.lastIndexOf(" — ");
  return (i >= 0 ? s.slice(0, i) : s).trim();
}

/** One board entry from a converted pack index entry ({_id, name, img, flags: {"loot-ledger": ...}}). */
export function boardEntry(id, name, flags, img = null) {
  const lines = flags?.converted?.review ?? [];
  return {
    id, name: name ?? "", img,
    quality: flags?.quality ?? "", category: flags?.category ?? "", slot: flags?.slot ?? "", band: flags?.band ?? null,
    lines, reasons: [...new Set(lines.map(reasonOf))],
    status: statusOf(flags), note: flags?.review?.note ?? ""
  };
}

/**
 * Filter the queue.
 * @param {object[]} entries  boardEntry() rows
 * @param {object} f  {status: "todo"|"all"|<status>, quality, category, slot, reason, search}; empty values match all
 */
export function filterQueue(entries, f = {}) {
  const q = String(f.search ?? "").trim().toLowerCase();
  const st = f.status ?? "todo";
  return entries.filter(e =>
    (st === "all" || (st === "todo" ? TODO.has(e.status) : e.status === st)) &&
    (!f.quality || e.quality === f.quality) &&
    (!f.category || e.category === f.category) &&
    (!f.slot || e.slot === f.slot) &&
    (!f.reason || e.reasons.includes(f.reason)) &&
    (!q || e.name.toLowerCase().includes(q) || e.lines.some(l => l.toLowerCase().includes(q)) || e.note.toLowerCase().includes(q)));
}

const ORDER = { pending: 0, skipped: 1, tweaked: 2, accepted: 3, rejected: 4 };

/** Queue order: pending first, then skipped (come back later), then decided items; by name within a status. */
export function sortQueue(entries) {
  return [...entries].sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || a.name.localeCompare(b.name));
}

/** Progress counts over every entry: {total, pending, accepted, tweaked, skipped, rejected, done}. */
export function countStatuses(entries) {
  const c = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const e of entries) c[e.status] = (c[e.status] ?? 0) + 1;
  return { total: entries.length, ...c, done: c.accepted + c.tweaked + c.rejected };
}

/** The id `dir` steps from `id` in a list (clamped); the first id when `id` is not in the list; null for an empty list. */
export function neighbour(list, id, dir = 1) {
  if (!list.length) return null;
  const i = list.findIndex(e => e.id === id);
  if (i < 0) return list[0].id;
  return list[Math.min(list.length - 1, Math.max(0, i + dir))].id;
}

/**
 * Which item to show after deciding on `id`: the next one in the list as it was before the decision (so the GM
 * moves forward even when the decided item drops out of the filtered view), else the previous one, else null.
 */
export function nextAfter(listBefore, id) {
  const i = listBefore.findIndex(e => e.id === id);
  if (i < 0) return listBefore[0]?.id ?? null;
  return listBefore[i + 1]?.id ?? listBefore[i - 1]?.id ?? null;
}

/** Board keyboard shortcuts: key -> board command. */
export const SHORTCUTS = {
  a: "accept", t: "tweak", s: "skip", r: "reject",
  ArrowRight: "next", ArrowDown: "next", ArrowLeft: "prev", ArrowUp: "prev"
};

/** The board command for a keydown (null when the key is not a shortcut or a modifier is held). */
export function shortcutFor({ key, ctrlKey = false, metaKey = false, altKey = false } = {}) {
  if (ctrlKey || metaKey || altKey) return null;
  return SHORTCUTS[key] ?? SHORTCUTS[String(key ?? "").toLowerCase()] ?? null;
}

const escHtml = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = s => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Plain text lines of tooltip HTML (same splitting as data.mjs tooltipLines, kept local so this file has no imports). */
function htmlLines(html) {
  if (!html) return [];
  return html.split(/<\/(?:div|span|p|li)>|<br\s*\/?>/i)
    .map(s => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * What the board shows for one converted item (plain item data, e.g. doc.toObject()).
 * @returns {{name, quality, sourceLines:{text:string, flagged:boolean}[], rulesHtml:string, summary:string,
 *   bonus:number, activities:string[], riders:string[], notConverted:string[], reviewLines:{line:string, why:string}[]}}
 *   sourceLines: the classic tooltip lines (above the 5e block), `flagged` for lines the converter sent to review.
 */
export function itemView(data, { moduleId = "loot-ledger" } = {}) {
  const f = data?.flags?.[moduleId] ?? {};
  const c = f.converted ?? {};
  const desc = data?.system?.description?.value ?? "";
  const cut = desc.indexOf('<section class="loot-ledger-5e"');
  const sourceHtml = cut >= 0 ? desc.slice(0, cut) : desc;
  const rulesHtml = cut >= 0 ? desc.slice(cut) : "";
  const reviewLines = (c.review ?? []).map(l => ({ line: lineOf(l), why: reasonOf(l) }));
  const flagged = new Set(reviewLines.map(r => norm(r.line)));
  const sourceLines = htmlLines(sourceHtml).map(text => ({ text, flagged: flagged.has(norm(text)) }));
  const acts = data?.system?.activities;
  const actList = acts ? (Array.isArray(acts) ? acts : Object.values(acts)) : [];
  const sys = data?.system ?? {};
  return {
    name: data?.name ?? "", quality: f.quality ?? "",
    sourceLines, rulesHtml, summary: c.summary ?? "",
    bonus: Number(sys.magicalBonus ?? sys.armor?.magicalBonus ?? 0) || 0,
    activities: actList.map(a => a?.name ? `${a.name} (${a.type ?? "activity"})` : String(a?.type ?? "activity")),
    riders: (f.riders ?? []).map(r => [r.type, r.effect].filter(Boolean).join(": ") + (r.value !== undefined ? ` ${r.value}` : "")),
    notConverted: c.notConverted ?? [],
    reviewLines
  };
}

/** HTML-escape (for the board's own markup). */
export const esc = escHtml;
