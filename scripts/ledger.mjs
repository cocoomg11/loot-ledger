/**
 * Build bookkeeping, pure logic (no Foundry calls, unit-tested with node --test):
 *   - source hashes, so re-running Build skips items whose source and rules are unchanged (idempotent, resumable);
 *   - the sync plan (create / replace / skip / remove) against what a pack already holds;
 *   - replace-list matching;
 *   - routing of a conversion to converted / replaced / GM review;
 *   - the GM summary and Build Report HTML.
 */
import { suffixPageHtml } from "./suffix.mjs";
import { MODULE_ID, SOURCE_MODULE } from "./data.mjs";
import * as RULES from "./rules.mjs";

/** Bump when transformItem() (the plain copy) changes shape, so plain copies are rewritten. */
export const COPY_VERSION = 1;

/* -------------------------------------------- */
/*  Hashing                                     */
/* -------------------------------------------- */

/** JSON with sorted keys; Sets, RegExps, Infinity and undefined serialised deterministically. */
export function canonical(value) {
  const norm = v => {
    if (v === undefined) return null;
    if (v === Infinity) return "∞";
    if (v === -Infinity) return "-∞";
    if (v instanceof RegExp) return `/${v.source}/${v.flags}`;
    if (v instanceof Set) return { "<set>": [...v].map(norm).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])]));
    return v;
  };
  return JSON.stringify(norm(value));
}

/** 64-bit FNV-1a style hash of a string, as 16 hex characters. */
export function hashString(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519) ^ (h1 >>> 15);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Fingerprint of every calibration value in rules.mjs: changing any value re-converts affected items. */
export function rulesFingerprint(rules = RULES) {
  return hashString(canonical(rules));
}

/** The parts of a source item that the copy / conversion reads. */
function sourcePart(src) {
  const data = typeof src.toObject === "function" ? src.toObject() : src;
  return { name: data.name, type: data.type, img: data.img, system: data.system, effects: data.effects ?? [], flags: data.flags?.[SOURCE_MODULE] ?? {} };
}

/**
 * Hash of everything that decides one item's output. Equal hash => the stored item is current and Build skips it.
 * @param {object} src  source item (plain data or document)
 * @param {object} opts {mode: "copy"|"convert", ratio, converterVersion, rules (fingerprint), replace (bool),
 *                       officialPacks (sorted list of installed official / SRD pack ids), dnd5eMajor}
 */
export function sourceHash(src, opts = {}) {
  const o = {
    mode: opts.mode ?? "copy", ratio: opts.ratio ?? "100",
    ...(opts.mode === "convert"
      ? { v: opts.converterVersion ?? 0, rules: opts.rules ?? rulesFingerprint(), replace: !!opts.replace,
          official: [...(opts.officialPacks ?? [])].sort(), dnd5e: opts.dnd5eMajor ?? null }
      : { v: COPY_VERSION, rarity: RULES.RARITY_BY_QUALITY, price: RULES.PRICE_RULE, dnd5e: opts.dnd5eMajor ?? null })
  };
  return hashString(canonical({ src: sourcePart(src), o }));
}

/* -------------------------------------------- */
/*  Sync plan                                   */
/* -------------------------------------------- */

/**
 * Decide what to write to a pack.
 * @param {Map<string,string|null>|object} existing  id -> stored hash (null when the doc has none) for the pack
 * @param {{id:string, hash:string}[]} desired       every item the build wants in the pack
 * @param {object} [options]
 * @param {boolean} [options.prune=true]             remove docs that are no longer wanted
 * @returns {{create:string[], replace:string[], skip:string[], remove:string[]}}
 *   create: not in the pack; replace: in the pack with a different / missing hash (delete + create);
 *   skip: hash equal; remove: in the pack but not wanted.
 */
export function planSync(existing, desired, { prune = true } = {}) {
  const have = existing instanceof Map ? existing : new Map(Object.entries(existing ?? {}));
  const out = { create: [], replace: [], skip: [], remove: [] };
  const want = new Set();
  for (const { id, hash } of desired) {
    if (want.has(id)) continue; // duplicate ids in the source never produce two documents
    want.add(id);
    if (!have.has(id)) out.create.push(id);
    else if (have.get(id) && have.get(id) === hash) out.skip.push(id);
    else out.replace.push(id);
  }
  if (prune) for (const id of have.keys()) if (!want.has(id)) out.remove.push(id);
  return out;
}

/* -------------------------------------------- */
/*  Replace list                                */
/* -------------------------------------------- */

/** Index a replace list for matching: {byId: Map, byName: Map}. */
export function indexReplaceList(list) {
  const byId = new Map(), byName = new Map();
  for (const e of list ?? []) {
    if (e.itemId !== undefined && e.itemId !== null && e.itemId !== "") byId.set(String(e.itemId), e);
    else if (e.name) byName.set(e.name.trim().toLowerCase(), e);
  }
  return { byId, byName };
}

/** The replace-list entry for a source item, or null. Item id first, then exact (case-insensitive) name. */
export function replaceEntry(src, index) {
  const f = src.flags?.[SOURCE_MODULE] ?? {};
  const id = f.itemId ?? f.id;
  if (id !== undefined && id !== null && index.byId.has(String(id))) return index.byId.get(String(id));
  return index.byName.get(String(src.name ?? "").trim().toLowerCase()) ?? null;
}

/**
 * Replace-list status after a build: which entries matched a source item, which matched an item that has no
 * hand-written rules (no effect), which matched nothing.
 * @param {object[]} list
 * @param {{entry:object, handAuthored:boolean}[]} hits  one per matched source item
 */
export function replaceListStatus(list, hits) {
  const matched = new Set(hits.map(h => h.entry));
  const noHand = new Set(hits.filter(h => !h.handAuthored).map(h => h.entry));
  return {
    total: list.length,
    applied: list.filter(e => matched.has(e) && !noHand.has(e)).map(e => e.name),
    notHandWritten: list.filter(e => noHand.has(e)).map(e => e.name),
    missing: list.filter(e => !matched.has(e)).map(e => e.name)
  };
}

/* -------------------------------------------- */
/*  Routing                                     */
/* -------------------------------------------- */

/**
 * Where a converted item is reported. Every converted item is still written (with only traceable features);
 * this decides the report lists. "review": the converter flagged a line it has no rule for (GM review list);
 * "replaced": a hand-written source rule was replaced (audit failure or replace list); "converted": clean.
 * An item can be both replaced and in review: review wins, with `replaced` true.
 * @param {object} flags  the item's flags["loot-ledger"]
 */
export function route(flags) {
  const c = flags?.converted ?? {};
  const replaced = !!(c.handAuthored && !c.handAuthoredKept);
  return { list: c.needsReview ? "review" : replaced ? "replaced" : "converted", review: !!c.needsReview, replaced, kept: !!c.handAuthoredKept };
}

/** Report row for an item the converter could not process at all (an exception): GM review, plain copy kept. */
export function errorRow(id, name, meta, uuid, message) {
  return {
    id, name, uuid, quality: meta?.quality ?? "", band: meta?.band ?? null,
    reviewLines: [`converter error: ${message} (the plain copy is used on the tables)`], replacedWhy: [], replaceList: false,
    list: "review", review: true, replaced: false, kept: false
  };
}

/** One GM review / replaced row from a stored or freshly converted item. */
export function reportRow(id, name, flags, uuid) {
  const c = flags?.converted ?? {};
  return {
    id, name, uuid, quality: flags?.quality ?? "", band: flags?.band ?? null,
    reviewLines: c.review ?? [], replacedWhy: c.handAuthoredReplaced ?? [], replaceList: !!c.replaceList,
    status: flags?.review?.status ?? "pending",
    ...route(flags)
  };
}

/* -------------------------------------------- */
/*  Summary and report                          */
/* -------------------------------------------- */

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Counts for the GM summary.
 * @param {object} s  {copy: plan counts, convert: plan counts|null, rows: reportRow[], replaceList: status, convertOn}
 */
export function summaryCounts(s) {
  const n = p => p ? p.create.length + p.replace.length : 0;
  return {
    copied: n(s.copy), copySkipped: s.copy?.skip.length ?? 0,
    converted: n(s.convert), convertSkipped: s.convert?.skip.length ?? 0,
    skipped: (s.copy?.skip.length ?? 0) + (s.convert?.skip.length ?? 0),
    removed: (s.copy?.remove.length ?? 0) + (s.convert?.remove.length ?? 0),
    review: s.rows.filter(r => r.review).length,
    errors: s.rows.filter(r => r.reviewLines?.some(l => l.startsWith("converter error"))).length,
    replaced: s.rows.filter(r => r.replaced).length,
    replaceList: s.rows.filter(r => r.replaceList).length,
    kept: s.rows.filter(r => r.kept).length,
    reviewProtected: s.protected ?? 0,
    rejected: s.rejected ?? 0
  };
}

/** Short HTML for the GM chat whisper. */
export function summaryHtml(counts, { convertOn, tables, seconds, reportUuid = null } = {}) {
  const li = (k, v) => `<li><strong>${k}:</strong> ${v}</li>`;
  const items = [
    li("Copied", `${counts.copied} written, ${counts.copySkipped} unchanged`),
    convertOn ? li("Converted to 5e", `${counts.converted} written, ${counts.convertSkipped} unchanged`) : li("Converted to 5e", "off (setting)"),
    ...(convertOn ? [
      li("GM review needed", counts.review),
      li("Hand-written rules replaced", `${counts.replaced} (${counts.replaceList} from the replace list)`),
      li("Hand-written rules kept", counts.kept)
    ] : []),
    li("Skipped (unchanged)", counts.skipped),
    ...(counts.reviewProtected ? [li("Kept as reviewed (accepted / tweaked)", counts.reviewProtected)] : []),
    ...(counts.rejected ? [li("Rejected on the review board (left off the tables)", counts.rejected)] : []),
    ...(counts.removed ? [li("Removed (no longer in source)", counts.removed)] : []),
    li("Roll tables", tables ?? 0)
  ];
  const link = reportUuid ? `<p>@UUID[${reportUuid}]{Open the Build Report}</p>` : "";
  return `<h3>Loot Ledger · Build</h3><ul>${items.join("")}</ul>${seconds !== undefined ? `<p><em>${seconds}s</em></p>` : ""}${link}`;
}

/** Build Report journal pages: [{name, html}]. */
export function reportPages(counts, rows, { convertOn, replaceList, tables, seconds, suffixes = null, date = new Date().toISOString() } = {}) {
  const link = r => r.uuid ? `@UUID[${r.uuid}]{${esc(r.name)}}` : esc(r.name);
  const summary = `<p>Build finished ${esc(date)}${seconds !== undefined ? ` in ${seconds}s` : ""}.</p>` +
    summaryHtml(counts, { convertOn, tables }).replace(/^<h3>[^<]*<\/h3>/, "") +
    (replaceList ? `<h3>Replace list</h3><p>${replaceList.applied.length} of ${replaceList.total} entries applied.</p>` +
      (replaceList.missing.length ? `<p><strong>No source item found:</strong> ${replaceList.missing.map(esc).join(", ")}</p>` : "") +
      (replaceList.notHandWritten.length ? `<p><strong>Not hand-written (entry has no effect):</strong> ${replaceList.notHandWritten.map(esc).join(", ")}</p>` : "") : "");
  const pages = [{ name: "Summary", html: summary }];
  if (!convertOn) return pages;
  const review = rows.filter(r => r.review).sort((a, b) => a.name.localeCompare(b.name));
  pages.push({
    name: `GM review (${review.length})`,
    html: review.length
      ? `<p>These items were converted with only the features their tooltip supports. Each line below has no conversion rule yet and stays as flavour; decide by hand or add a rule in rules.mjs / convert.mjs.</p>` +
        `<p>Work through them with the <strong>Review board</strong> (button at the top of this journal entry, the Loot Ledger settings, or <code>api.reviewBoard()</code>).</p>` +
        `<table><thead><tr><th>Item</th><th>Quality</th><th>Band</th><th>Needs review</th><th>Status</th></tr></thead><tbody>` +
        review.map(r => `<tr><td>${link(r)}</td><td>${esc(r.quality)}</td><td>${r.band ?? ""}</td><td>${r.reviewLines.map(esc).join("<br>")}</td><td>${esc(r.status ?? "pending")}</td></tr>`).join("") +
        `</tbody></table>`
      : "<p>Nothing to review.</p>"
  });
  const replaced = rows.filter(r => r.replaced).sort((a, b) => a.name.localeCompare(b.name));
  const kept = rows.filter(r => r.kept).sort((a, b) => a.name.localeCompare(b.name));
  pages.push({
    name: `Hand-written (${replaced.length} replaced, ${kept.length} kept)`,
    html: `<h3>Replaced</h3>` + (replaced.length
      ? `<table><thead><tr><th>Item</th><th>Why</th></tr></thead><tbody>` +
        replaced.map(r => `<tr><td>${link(r)}</td><td>${r.replacedWhy.map(esc).join("<br>")}</td></tr>`).join("") + `</tbody></table>`
      : "<p>None.</p>") +
      `<h3>Kept (passes the traceability audit)</h3>` + (kept.length ? `<p>${kept.map(link).join(", ")}</p>` : "<p>None.</p>")
  });
  // Random suffixes (suffix.mjs): the table and how many source items carry the random enchantment line.
  if (suffixes) pages.push({ name: `Random suffixes (${suffixes.sourceCount ?? 0})`, html: suffixPageHtml(suffixes) });
  return pages;
}

export const REPORT_FLAG = { scope: MODULE_ID, key: "buildReport" };

/* -------------------------------------------- */
/*  Hand-written audit (book-day replace list)  */
/* -------------------------------------------- */

/**
 * Audit every hand-written conversion in a set of source items, for filling the replace list.
 * Pure: `audit` is convert.mjs auditHandAuthored(parseSource(doc)), passed in so this file stays Foundry- and
 * converter-free.
 * @param {object[]} docs   source items (plain data or documents); items without hand-written rules are skipped
 * @param {object[]} list   the current replace list
 * @param {(doc:object) => {pass:boolean, problems:{claim:string, text:string}[]}} audit
 * @returns {{handWritten:number, failing:object[], passing:object[], listed:number, unlisted:object[], expected:number|null}}
 *   failing / passing rows: {name, itemId, onList, problems:["claim: text"]}; unlisted = failing rows not on the list.
 */
export function handWrittenAudit(docs, list, audit) {
  const index = indexReplaceList(list);
  const rows = [];
  for (const doc of docs) {
    const f = doc.flags?.[SOURCE_MODULE] ?? {};
    if (!f.handAuthored) continue;
    const a = audit(doc);
    rows.push({
      name: doc.name, itemId: f.itemId ?? f.id ?? null, onList: !!replaceEntry(doc, index), pass: a.pass,
      problems: a.problems.map(x => `${x.claim}: ${x.text}`)
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const failing = rows.filter(r => !r.pass), passing = rows.filter(r => r.pass);
  return {
    handWritten: rows.length, failing, passing,
    listed: rows.filter(r => r.onList).length,
    unlisted: failing.filter(r => !r.onList)
  };
}

/** Replace-list entries (JS source, one per line) for audit rows, ready to paste into scripts/replace-list.mjs. */
export function replaceListSnippet(rows) {
  const q = s => JSON.stringify(String(s));
  return rows.map(r => {
    const claims = [...new Set(r.problems.map(p => p.split(":")[0]))].join(", ");
    const note = claims ? `no backing tooltip line for: ${claims}` : "fails review: hand-written rule names mechanics with no backing tooltip line";
    return `  { name: ${q(r.name)}${r.itemId !== null && r.itemId !== undefined ? `, itemId: ${Number(r.itemId) || q(r.itemId)}` : ""}, note: ${q(note)} },`;
  }).join("\n");
}

/** Journal page HTML for a handWrittenAudit() result. */
export function auditPageHtml(res, { expected = null } = {}) {
  const table = (rows, withProblems) => rows.length
    ? `<table><thead><tr><th>Item</th><th>Item id</th><th>On list</th>${withProblems ? "<th>Unbacked claims</th>" : ""}</tr></thead><tbody>` +
      rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.itemId ?? "")}</td><td>${r.onList ? "yes" : "no"}</td>${withProblems ? `<td>${r.problems.map(esc).join("<br>")}</td>` : ""}</tr>`).join("") +
      "</tbody></table>"
    : "<p>None.</p>";
  return `<p>${res.handWritten} hand-written conversions in the source module; ${res.failing.length} fail the automatic audit, ` +
    `${res.listed} are on the replace list${expected ? ` (review total: ${expected})` : ""}.</p>` +
    `<h3>Failing the audit (${res.failing.length})</h3>${table(res.failing, true)}` +
    `<h3>Passing the audit (${res.passing.length}): read these by hand</h3>` +
    `<p>The replace list exists for hand-written rules that pass the automatic audit but still fail review. Read each one against its tooltip; add failures with <code>api.auditHandWritten({ add: [...] })</code> output or by hand.</p>` +
    table(res.passing, false);
}
