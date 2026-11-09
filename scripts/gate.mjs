/**
 * GM-only gating for the public API (pure; tested in Node). A player calling a gated member gets a notice and
 * `undefined`; nothing runs. `isGM` and `notify` are functions so the check happens at call time.
 */
export const GM_NOTICE = "Loot Ledger: GM only.";

const defaultIsGM = () => !!globalThis.game?.user?.isGM;
const defaultNotify = msg => globalThis.ui?.notifications?.warn(msg);

/** True when the user id belongs to a GM user (the userId a document hook receives is set by the server). */
export function isGmUser(userId, users) {
  if (!userId) return false;
  const u = typeof users?.get === "function" ? users.get(userId) : [...(users ?? [])].find(x => x.id === userId);
  return u?.isGM === true;
}

/** Wrap one function: non-GM gets a notice and undefined. */
export function gmOnly(fn, { isGM = defaultIsGM, notify = defaultNotify } = {}) {
  return (...args) => {
    if (!isGM()) { notify(GM_NOTICE); return undefined; }
    return fn(...args);
  };
}

/** Explicit check for use inside a function: returns true for a GM, else notifies and returns false. */
export function requireGM({ isGM = defaultIsGM, notify = defaultNotify } = {}) {
  if (isGM()) return true;
  notify(GM_NOTICE);
  return false;
}

/** Copy of `api` with the named function members wrapped in gmOnly; other members (and absent ones) are left as they are. */
export function gateMembers(api, names, opts) {
  const out = { ...api };
  for (const name of names) if (typeof out[name] === "function") out[name] = gmOnly(out[name], opts);
  return out;
}
