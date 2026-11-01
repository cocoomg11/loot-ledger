/**
 * Markup helpers for the shared look (styles/wanderers-ui.css), pure: no Foundry calls, tested in Node. Optional: a module may
 * write the same markup by hand. Every value is escaped with `esc`. Status is shown by an icon plus a word for screen readers,
 * never by a ✓ ⚠ ✗ character or by colour alone.
 *
 * Version safety: the stylesheet applies only inside an element carrying `UI_CLASSES` ("wc-ui wc-r<UI_REVISION>"). Each core
 * release that changes the stylesheet bumps UI_REVISION, so windows built with one copy of core are never restyled by another.
 */
import { esc } from "./text.mjs";
import { level } from "./health-model.mjs";

/** Revision of the stylesheet's class contract. Bumped by every change to styles/wanderers-ui.css (a test checks the file). */
export const UI_REVISION = 3;
/** The root classes a module puts on its window (ApplicationV2 `classes`) or container. */
export const UI_CLASSES = /** @type {const} */ (["wc-ui", `wc-r${UI_REVISION}`]);
/** Path of the stylesheet inside the vendored folder (module.json `styles`: "vendor/wanderers-core/" + this). */
export const UI_STYLESHEET = "styles/wanderers-ui.css";

/**
 * Tones: health levels plus pending (checking), live (recording), accent and none (not checked).
 * icon = Font Awesome classes, word = what a screen reader says.
 * @type {Readonly<Record<string, { icon: string, word: string }>>}
 */
export const TONES = Object.freeze({
  ok: { icon: "fa-solid fa-circle-check", word: "OK" },
  warn: { icon: "fa-solid fa-triangle-exclamation", word: "Warning" },
  bad: { icon: "fa-solid fa-circle-xmark", word: "Problem" },
  info: { icon: "fa-solid fa-circle-info", word: "Info" },
  off: { icon: "fa-solid fa-circle-minus", word: "Off" },
  pending: { icon: "fa-solid fa-spinner fa-spin", word: "Checking" },
  live: { icon: "fa-solid fa-circle-dot", word: "Live" },
  accent: { icon: "fa-solid fa-star", word: "Note" },
  none: { icon: "fa-regular fa-circle", word: "Not checked" }
});

/**
 * A tone name read leniently: a tone as is, a health level or alias ("error" → "bad") through core's `level`, else "info".
 * @param {unknown} t
 * @returns {string}
 */
export function tone(t) {
  const s = String(t ?? "").toLowerCase();
  return Object.hasOwn(TONES, s) ? s : level(s);
}

/** @param {string | undefined} title */
const titleAttr = title => (title ? ` title="${esc(title)}"` : "");
/** @param {string | undefined} cls */
const extra = cls => (cls ? ` ${esc(cls)}` : "");

/**
 * A status icon with its word for screen readers: `<i class="… wc-icon wc-ok" aria-hidden="true"></i><span class="wc-sr">OK:</span>`.
 * @param {string} t tone
 * @param {{ word?: string | false }} [o] word: another screen-reader word, or false for none (when the text says it)
 * @returns {string}
 */
export function icon(t, o = {}) {
  const k = tone(t);
  const word = o.word === false ? "" : (o.word ?? TONES[k].word);
  return `<i class="${TONES[k].icon} wc-icon wc-${k}" aria-hidden="true"></i>${word ? `<span class="wc-sr">${esc(word)}:</span>` : ""}`;
}

/**
 * A badge / pill. The text is the visible word, so no extra screen-reader word is added.
 * @param {string} t tone
 * @param {unknown} text
 * @param {{ title?: string, icon?: boolean, small?: boolean, dot?: boolean, cls?: string }} [o] icon: the tone's icon in front;
 *   dot: a dot in front (a live badge's pulsing dot)
 * @returns {string}
 */
export function badge(t, text, o = {}) {
  const k = tone(t);
  const lead = o.icon ? `<i class="${TONES[k].icon}" aria-hidden="true"></i>` : o.dot ? dot(k) : "";
  return `<span class="wc-badge wc-${k}${o.small ? " wc-badge-sm" : ""}${extra(o.cls)}"${titleAttr(o.title)}>${lead}${esc(text)}</span>`;
}

/**
 * A status dot: filled, hollow for off / none, a pulsing ring for pending, a pulsing filled dot for live. Hidden from screen readers
 * unless `label` is given (then the label is read).
 * @param {string} t tone
 * @param {{ label?: string, title?: string }} [o]
 * @returns {string}
 */
export function dot(t, o = {}) {
  const k = tone(t);
  const span = `<span class="wc-dot wc-${k}" aria-hidden="true"${titleAttr(o.title)}></span>`;
  return o.label ? `${span}<span class="wc-sr">${esc(o.label)}</span>` : span;
}

/**
 * One status line: icon + word + text, as a `<li>` (for `<ul class="wc-lines">`) or a `<p>`.
 * @param {string} t tone
 * @param {unknown} text plain text (escaped)
 * @param {{ tag?: "li" | "p" | "div", html?: string }} [o] html: trusted markup appended after the text (buttons); never user text
 * @returns {string}
 */
export function statusLine(t, text, o = {}) {
  const k = tone(t);
  const tag = o.tag === "p" || o.tag === "div" ? o.tag : "li";
  return `<${tag} class="wc-status wc-${k}">${icon(k)}<span class="wc-grow">${esc(text)}</span>${o.html ?? ""}</${tag}>`;
}

/**
 * A list of status lines from health-report lines (`{ level, text }`).
 * @param {Array<{ level?: unknown, text?: unknown }>} lines
 * @returns {string}
 */
export function statusLines(lines) {
  return `<ul class="wc-lines">${(Array.isArray(lines) ? lines : []).map(l => statusLine(String(l?.level ?? "info"), l?.text)).join("")}</ul>`;
}

/**
 * A sidebar link (a button for ApplicationV2 `actions`). Roving focus is the module's job: pass `tabindex` when it uses one.
 * @param {{ label: unknown, action?: string, page?: string, icon?: string, dot?: string, badge?: { tone: string, text: unknown, title?: string },
 *   active?: boolean, muted?: boolean, aria?: string, tabindex?: number, data?: Record<string, unknown> }} item
 *   icon: Font Awesome classes; dot: a tone shown in place of the icon; aria: the full accessible name (e.g. "Health, 2 warnings")
 * @returns {string}
 */
export function navItem(item) {
  const data = { ...(item.page !== undefined ? { page: item.page } : {}), ...(item.data ?? {}) };
  const attrs = Object.entries(data).filter(([k]) => /^[a-z][a-z0-9-]*$/.test(k)).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");
  const lead = item.dot ? dot(item.dot) : item.icon ? `<i class="${esc(item.icon)}" aria-hidden="true"></i>` : "";
  const end = item.badge ? badge(item.badge.tone, item.badge.text, { small: true, title: item.badge.title }) : "";
  const cls = `wc-nav${item.active ? " active" : ""}${item.muted ? " wc-muted" : ""}`;
  return `<button type="button" class="${cls}" data-action="${esc(item.action ?? "nav")}"${attrs}`
    + `${item.active ? ` aria-current="page"` : ""}${item.tabindex !== undefined ? ` tabindex="${Number(item.tabindex) || 0}"` : ""}`
    + `${item.aria ? ` aria-label="${esc(item.aria)}"` : ""}>${lead}<span class="wc-nav-label">${esc(item.label)}</span>${end}</button>`;
}
