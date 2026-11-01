/**
 * Coins: copper / silver / gold amounts, pure (no Foundry calls, tested in Node).
 *
 * An amount is a whole number of copper, the smallest coin. Gold, silver and copper are `ratio` apart: 1 silver = `ratio` copper and
 * 1 gold = `ratio` silver. The default `ratio` is 100 (100 copper to the silver, 100 silver to the gold: 1 gold = 10000 copper), the
 * three-coin economy of the Wayfarer's Toolkit module, so a module switching to these helpers keeps its amounts. For a 10-to-1
 * economy pass `{ ratio: 10 }`. Platinum and electrum are not handled here.
 */
import { esc } from "./text.mjs";

/** Copper per silver, and silver per gold, unless a call says otherwise. */
export const COIN_RATIO = 100;

/** @typedef {{ gp?: number, sp?: number, cp?: number }} CoinPurse */
/** @typedef {{ ratio?: number }} RatioOption */

/** @param {unknown} r @returns {number} */
const ratioOf = r => (Number.isFinite(r) && /** @type {number} */ (r) >= 1 ? /** @type {number} */ (r) : COIN_RATIO);
/** @param {unknown} v @returns {number} */
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Gold, silver and copper → whole copper (rounded, never below 0). Missing or bad fields count as 0.
 * @param {CoinPurse | null | undefined} purse
 * @param {RatioOption} [o]
 * @returns {number}
 */
export function toCopper(purse, o = {}) {
  const r = ratioOf(o.ratio);
  const p = purse && typeof purse === "object" ? purse : {};
  return Math.max(0, Math.round(num(p.gp) * r * r + num(p.sp) * r + num(p.cp)));
}

/**
 * A copper amount → `{ gp, sp, cp }` whole numbers with the most gold and silver possible (the amount is rounded; below 0 or not a
 * number reads as 0).
 * @param {number} copper
 * @param {RatioOption} [o]
 * @returns {{ gp: number, sp: number, cp: number }}
 */
export function fromCopper(copper, o = {}) {
  const r = ratioOf(o.ratio);
  let a = Math.max(0, Math.round(num(copper)));
  const gp = Math.floor(a / (r * r)); a -= gp * r * r;
  const sp = Math.floor(a / r); a -= sp * r;
  return { gp, sp, cp: a };
}

const SHORT = { gp: "g", sp: "s", cp: "c" };
const LONG = { gp: "gold", sp: "silver", cp: "copper" };

/**
 * The parts of an amount, most valuable first: `[key, count]` for the non-zero ones, all three with `zero`, and "0 copper" alone for
 * nothing.
 * @param {number | CoinPurse} amount copper, or a purse (normalised through copper, so 120 silver shows as 1 gold 20 silver)
 * @param {{ zero?: boolean, ratio?: number }} o
 * @returns {Array<["gp" | "sp" | "cp", number]>}
 */
function parts(amount, o) {
  const c = fromCopper(typeof amount === "number" ? amount : toCopper(amount, o), o);
  const all = /** @type {Array<["gp" | "sp" | "cp", number]>} */ ([["gp", c.gp], ["sp", c.sp], ["cp", c.cp]]);
  if (o.zero) return all;
  const some = all.filter(([, n]) => n > 0);
  return some.length ? some : [["cp", 0]];
}

/**
 * An amount as text: "12g 46s 8c" (`style: "short"`, the default) or "12 gold, 46 silver, 8 copper" (`"long"`). Zero parts are left
 * out unless `zero: true`; an amount of nothing reads "0c" / "0 copper". Never throws.
 * @param {number | CoinPurse} amount copper, or `{ gp, sp, cp }`
 * @param {{ style?: "short" | "long", zero?: boolean, ratio?: number }} [o]
 * @returns {string}
 */
export function formatCoins(amount, o = {}) {
  const long = o.style === "long";
  return parts(amount, o).map(([k, n]) => (long ? `${n} ${LONG[k]}` : `${n}${SHORT[k]}`)).join(long ? ", " : " ");
}

/**
 * An amount as markup: `<span class="wc-coins">` with one `.wc-coin.wc-coin-<gp|sp|cp>` per part, each a CSS-drawn coin dot
 * (`.wc-coin-icon`, hidden from screen readers), the number, and the coin's word for screen readers. Shown only inside the shared
 * stylesheet root (docs/ui.md). Zero parts are left out unless `zero: true` (then they carry `wc-zero` and are dimmed).
 * @param {number | CoinPurse} amount copper, or `{ gp, sp, cp }`
 * @param {{ zero?: boolean, ratio?: number, cls?: string }} [o]
 * @returns {string}
 */
export function coins(amount, o = {}) {
  const inner = parts(amount, o).map(([k, n]) =>
    `<span class="wc-coin wc-coin-${k}${n ? "" : " wc-zero"}"><span class="wc-coin-icon" aria-hidden="true"></span>${n}<span class="wc-sr">${LONG[k]}</span></span>`).join("");
  return `<span class="wc-coins${o.cls ? ` ${esc(o.cls)}` : ""}" title="${esc(formatCoins(amount, { ...o, style: "long" }))}">${inner}</span>`;
}
