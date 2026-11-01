/**
 * Per-user rate limits for socket requests (pure; tested in Node). A token bucket per key: each key starts with `burst` tokens, every
 * request takes one, and tokens come back at `perSecond`. A key with no tokens left is refused until one comes back.
 */

/** Default bucket size: requests a user may send at once. */
export const RATE_BURST = 20;
/** Default refill: requests per second a user may keep sending. */
export const RATE_PER_SECOND = 5;

/**
 * @typedef {object} RateLimiter
 * @property {(key: string, now?: number) => boolean} take true when `key` may go ahead (and uses one token), false when refused
 * @property {(key: string, now?: number) => number} left tokens `key` has now
 * @property {() => void} clear
 * @property {number} size keys remembered
 */

/**
 * A token-bucket rate limiter. Throws on a bad configuration (a programming mistake), never when used.
 * @param {{ burst?: number, perSecond?: number, maxKeys?: number }} [opts] maxKeys: the oldest keys are forgotten past it
 * @returns {RateLimiter}
 */
export function rateLimiter({ burst = RATE_BURST, perSecond = RATE_PER_SECOND, maxKeys = 1000 } = {}) {
  if (!(Number.isFinite(burst) && burst >= 1)) throw new Error("rateLimiter(): burst should be a number of at least 1");
  if (!(Number.isFinite(perSecond) && perSecond > 0)) throw new Error("rateLimiter(): perSecond should be a number above 0");
  /** @type {Map<string, { tokens: number, at: number }>} */
  const buckets = new Map();
  const fill = (/** @type {string} */ key, /** @type {number} */ now) => {
    const b = buckets.get(key);
    if (!b) return { tokens: burst, at: now };
    const tokens = Math.min(burst, b.tokens + Math.max(0, now - b.at) / 1000 * perSecond);
    return { tokens, at: Math.max(b.at, now) };
  };
  return {
    take(key, now = Date.now()) {
      const k = String(key);
      const b = fill(k, now);
      const ok = b.tokens >= 1;
      if (ok) b.tokens -= 1;
      buckets.delete(k); buckets.set(k, b);
      while (buckets.size > maxKeys) buckets.delete(/** @type {string} */ (buckets.keys().next().value));
      return ok;
    },
    left(key, now = Date.now()) { return Math.floor(fill(String(key), now).tokens); },
    clear() { buckets.clear(); },
    get size() { return buckets.size; }
  };
}
