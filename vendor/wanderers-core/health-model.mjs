/**
 * The read-only health check, pure (tested in Node). Every module returns the same report shape, so a hub can show them together:
 *   [{ title, lines: [{ level: "ok" | "warn" | "bad" | "off" | "info", text, fix? }] }]   (text is plain text)
 * `fix` (0.5.0, optional) is what a hub such as the Wanderer's Satchel offers as a Fix button: a function, an action id string, or
 * `{ label, run | action, confirm? }` (see `readFix`). The check itself still changes nothing; the fix runs only when a GM clicks.
 * Checks are added through a collector that wraps each one: a check that throws becomes one "warn" line and never stops the others,
 * and nothing in a check may change the world.
 */
import { plain } from "./text.mjs";

/** @typedef {"ok" | "warn" | "bad" | "off" | "info"} Level */
/**
 * @typedef {object} HealthFix a line's fix, as read by `readFix`
 * @property {string} label button label, plain text (default "Fix")
 * @property {(ctx?: any) => any} [run] a function to run (never stored: see `storableReport`)
 * @property {string} [action] an action id the hub looks up in the module's registration `fixes`
 * @property {string} [confirm] a question the GM answers first, plain text
 */
/** @typedef {((ctx?: any) => any) | string | { label?: string, run?: (ctx?: any) => any, action?: string, confirm?: string }} FixInput */
/** @typedef {{ level: Level, text: string, fix?: HealthFix }} HealthLine */
/** @typedef {{ title: string, lines: HealthLine[] }} HealthSection */

export const LEVELS = /** @type {const} */ (["ok", "warn", "bad", "off", "info"]);
/** @type {Record<string, Level>} */
const ALIAS = { error: "bad", fail: "bad", failed: "bad", warning: "warn", good: "ok", pass: "ok", disabled: "off", note: "info" };

/**
 * A level name read leniently ("error" → "bad"); anything unknown is "info".
 * @param {unknown} l
 * @returns {Level}
 */
export function level(l) {
  const s = String(l ?? "").toLowerCase();
  return /** @type {readonly string[]} */ (LEVELS).includes(s) ? /** @type {Level} */ (s) : ALIAS[s] ?? "info";
}

/** Action ids: letters, digits and `_ . : -`, 1 to 64 characters (the Satchel's contract). */
export const FIX_ACTION_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Longest fix label and confirm text kept. */
export const FIX_LABEL_MAX = 60;
export const FIX_CONFIRM_MAX = 500;

/**
 * A line's fix read leniently into one shape, or null (no fix, or one that can't be used). Accepted: a function (label "Fix"), an
 * action id string, or `{ label?, run | action, confirm? }` (`run` wins over `action`). Labels and confirm texts become plain text
 * and are cut to 60 / 500 characters. Never throws. Same rules as the Wanderer's Satchel's own reader, so a line passes through
 * unchanged.
 * @param {unknown} f
 * @returns {HealthFix | null}
 */
export function readFix(f) {
  try {
    const id = (/** @type {unknown} */ v) => (typeof v === "string" && FIX_ACTION_RE.test(v) ? v : null);
    const label = (/** @type {unknown} */ v) => (typeof v === "string" && plain(v) ? plain(v).slice(0, FIX_LABEL_MAX) : "Fix");
    if (typeof f === "function") return { label: "Fix", run: /** @type {any} */ (f) };
    if (id(f)) return { label: "Fix", action: /** @type {string} */ (f) };
    if (!f || typeof f !== "object") return null;
    const o = /** @type {any} */ (f);
    const confirm = typeof o.confirm === "string" && plain(o.confirm) ? { confirm: plain(o.confirm).slice(0, FIX_CONFIRM_MAX) } : {};
    if (typeof o.run === "function") return { label: label(o.label), run: o.run, ...confirm };
    if (id(o.action)) return { label: label(o.label), action: o.action, ...confirm };
    return null;
  } catch { return null; }
}

/**
 * A copy of a report that is safe to store or send (chat-card flags, settings, socket payloads, JSON): fixes with a `run` function
 * lose the function (a fix that has an `action` id keeps it; a fix with only a function is dropped). Everything else is kept. The
 * live report, with its functions, is what a hub reads.
 * @param {HealthSection[]} report
 * @returns {HealthSection[]}
 */
export function storableReport(report) {
  return (Array.isArray(report) ? report : []).map(s => ({
    title: String(s?.title ?? ""),
    lines: (Array.isArray(s?.lines) ? s.lines : []).map(l => {
      const { fix, ...rest } = l ?? /** @type {any} */ ({});
      if (!fix) return { ...rest };
      if (typeof fix.action !== "string") return { ...rest };
      return { ...rest, fix: { label: fix.label, action: fix.action, ...(fix.confirm ? { confirm: fix.confirm } : {}) } };
    })
  }));
}

/**
 * A line object for a report: level read leniently, text made plain, the fix read with `readFix` (kept only when usable). For a
 * module's own report builder that doesn't use the collector, or a plain-text conversion (`toPlain`-style) that must keep the fix.
 * Returns null when the text is empty.
 * @param {unknown} l level @param {unknown} text @param {unknown} [fix]
 * @returns {HealthLine | null}
 */
export function healthLine(l, text, fix) {
  const t = plain(/** @type {any} */ (text));
  if (!t) return null;
  const f = fix === undefined ? null : readFix(fix);
  return { level: level(l), text: t, ...(f ? { fix: f } : {}) };
}

/**
 * @typedef {object} HealthCollector
 * @property {(level: Level, text: string, fix?: FixInput) => void} add a line in the current section (optional fix)
 * @property {(title: string) => void} section starts a new section
 * @property {(fn: (add: (level: Level, text: string, fix?: FixInput) => void) => void) => void} check runs one check, wrapped
 * @property {(title: string, fn: (add: (level: Level, text: string, fix?: FixInput) => void) => (void | Promise<void>)) => Promise<void>} checkAsync
 *   runs one async check in its own section, wrapped and time-limited
 * @property {() => HealthSection[]} report the sections so far (empty sections dropped)
 */

/**
 * A collector for one module's report.
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {HealthCollector}
 */
export function healthCollector({ timeoutMs = 5000 } = {}) {
  /** @type {HealthSection[]} */
  const sections = [{ title: "", lines: [] }];
  const cur = () => sections[sections.length - 1];
  const add = (/** @type {Level} */ l, /** @type {string} */ text, /** @type {FixInput | undefined} */ fix = undefined) => { const line = healthLine(l, text, fix); if (line) cur().lines.push(line); };
  const failed = (/** @type {unknown} */ e) => add("warn", `A check failed to run: ${plain(/** @type {any} */ (e)?.message ?? e)}`);
  return {
    add,
    section(title) { sections.push({ title: plain(title), lines: [] }); },
    check(fn) { try { fn(add); } catch (e) { failed(e); } },
    async checkAsync(title, fn) {
      this.section(title);
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs); });
      try { await Promise.race([Promise.resolve().then(() => fn(add)), limit]); } catch (e) { failed(e); } finally { clearTimeout(timer); }
    },
    report() { return sections.filter(s => s.lines.length).map(s => ({ title: s.title, lines: s.lines.map(l => ({ ...l })) })); }
  };
}

/**
 * The worst level in a report: "bad" > "warn" > "ok" > "info"/"off".
 * @param {HealthSection[]} report
 * @returns {Level}
 */
export function worst(report) {
  const all = report.flatMap(s => s.lines.map(l => l.level));
  return all.includes("bad") ? "bad" : all.includes("warn") ? "warn" : all.includes("ok") ? "ok" : "info";
}

/**
 * Counts per level.
 * @param {HealthSection[]} report
 * @returns {Record<Level, number>}
 */
export function counts(report) {
  /** @type {Record<Level, number>} */
  const c = { ok: 0, warn: 0, bad: 0, off: 0, info: 0 };
  for (const s of report) for (const l of s.lines) c[l.level] += 1;
  return c;
}
