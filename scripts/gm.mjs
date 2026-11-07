/**
 * GM gate for the public API (pure: game access only through the injectable defaults).
 */

/**
 * Wrap every function of `api` so that it runs only for a GM. A player gets a warning notification and `undefined`; the wrapped
 * function is never called. The check is made at call time (the API is set up at init, before `game.user` exists).
 * Non-function members are copied as they are.
 * @param {object} api
 * @param {{isGM?: () => boolean, notify?: (msg: string) => void, message?: () => string}} [opts]
 * @returns {object}
 */
export function gateApi(api, {
  isGM = () => !!game.user?.isGM,
  notify = msg => ui.notifications?.warn(msg),
  message = () => game.i18n?.localize("LOOTLEDGER.Notice.GmOnly") ?? "Loot Ledger: only a GM can do that."
} = {}) {
  const out = {};
  for (const [name, fn] of Object.entries(api)) {
    out[name] = typeof fn === "function"
      ? (...args) => { if (!isGM()) { notify(message()); return undefined; } return fn(...args); }
      : fn;
  }
  return out;
}
