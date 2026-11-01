/**
 * Small text helpers shared by every module. Pure: no Foundry calls, tested in Node.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escapes text for HTML (element content and quoted attribute values). `null`/`undefined` become "".
 * @param {unknown} s
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ESC[/** @type {keyof typeof ESC} */ (c)]);
}

/**
 * Plain text from a bit of HTML: tags dropped, the common entities decoded, white space collapsed.
 * Not a sanitiser: never put its result back into HTML without `esc`.
 * @param {unknown} s
 * @returns {string}
 */
export function plain(s) {
  return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/**
 * "1 tab", "3 tabs". `many` defaults to `one` + "s".
 * @param {number} n
 * @param {string} one
 * @param {string} [many]
 * @returns {string}
 */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A slug for file names: lower case letters, digits and single dashes.
 * @param {unknown} s
 * @returns {string}
 */
export function slug(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * A local date as yyyy-mm-dd, or "" for an invalid date.
 * @param {Date | number | string} [date]
 * @returns {string}
 */
export function isoDay(date = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
