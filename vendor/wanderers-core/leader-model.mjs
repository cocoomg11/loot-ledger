/**
 * "Exactly one client acts": the pure half of the one-writer election (no Foundry calls; tested in Node). The Foundry half is
 * src/foundry/leader.mjs.
 *
 * Foundry's active GM is a user, but one GM user can be logged in on several clients (two tabs, a laptop and a desktop). Each of
 * those clients would think it is the active GM, so every automatic write would happen once per tab. Each GM client therefore takes
 * a random session id at load and announces it over the module socket; among the live sessions of the active GM user, the one that
 * started first (ties: the lowest id) is the leader, and only the leader writes.
 *
 * Liveness: a client pings every HEARTBEAT_MS and every other GM client answers "here" at once. A peer counts as alive when it was
 * heard after this client's previous ping (minus a grace). Measuring against our own pings, not the wall clock, keeps a background
 * tab (whose timers the browser slows to once a minute) from being declared dead: it still answers pings straight away, because
 * socket messages are not throttled. A tab that closes says "bye" (hand-over at once); one that crashes drops out after two missed
 * pings. A lone client always counts itself, so it leads once the short settle window has passed.
 */

/** How often a GM client pings the others (ms). */
export const HEARTBEAT_MS = 2000;
/** Slack for a reply to arrive after a ping (ms). */
export const GRACE_MS = 1000;
/** How long ready-time work waits to hear the other sessions (ms). */
export const SETTLE_MS = 800;
/** How many request ids a client remembers. */
export const SEEN_MAX = 200;

/** Session and request ids: 4 to 64 letters, digits, "_" or "-". */
export const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const ABC = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {string} userId Foundry's sender id for that session, never the message's own word
 * @property {number} since when it started (its own clock)
 * @property {number} [seen] when this client last heard it (this client's clock)
 */
/** @typedef {{ id: string, isGM?: boolean, active?: boolean }} UserLike */

/**
 * A random id of letters and digits. `rand` is for tests.
 * @param {() => number} [rand]
 * @param {number} [length]
 * @returns {string}
 */
export function newId(rand = Math.random, length = 16) {
  let s = "";
  for (let i = 0; i < length; i++) s += ABC[Math.floor(rand() * ABC.length) % ABC.length];
  return s;
}

/**
 * Ordering of sessions: earliest start first, then lowest id.
 * @param {Session} a
 * @param {Session} b
 * @returns {number}
 */
export function compareSessions(a, b) {
  if (a.since !== b.since) return a.since < b.since ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The cut-off for "still alive": heard after this client's previous ping, minus a grace. `prevPing` null: everyone counts.
 * @param {number | null | undefined} prevPing
 * @param {number} [grace]
 * @returns {number}
 */
export function aliveCutoff(prevPing, grace = GRACE_MS) {
  return typeof prevPing === "number" && Number.isFinite(prevPing) ? prevPing - grace : -Infinity;
}

/**
 * The leader's session id among `sessions` for GM user `gmUserId`, or null. Sessions last seen before `cutoff` are ignored; `self`
 * always counts while it belongs to that user.
 * @param {Session[]} sessions
 * @param {{ gmUserId?: string | null, cutoff?: number, self?: Session | null }} opts
 * @returns {string | null}
 */
export function leaderOf(sessions = [], { gmUserId, cutoff = -Infinity, self = null } = {}) {
  if (!gmUserId) return null;
  const live = sessions.filter(s => s && s.userId === gmUserId && s.id !== self?.id && (s.seen ?? -Infinity) >= cutoff);
  if (self && self.userId === gmUserId) live.push(self);
  return live.sort(compareSessions)[0]?.id ?? null;
}

/**
 * Whether `self` leads.
 * @param {Session[]} sessions
 * @param {{ gmUserId?: string | null, cutoff?: number, self?: Session | null }} opts
 * @returns {boolean}
 */
export function isLeader(sessions, { gmUserId, cutoff, self }) {
  return !!self && self.userId === gmUserId && leaderOf(sessions, { gmUserId, cutoff, self }) === self.id;
}

/**
 * Drops sessions last seen before `cutoff`.
 * @param {Session[]} sessions
 * @param {number} [cutoff]
 * @returns {Session[]}
 */
export function prune(sessions = [], cutoff = -Infinity) { return sessions.filter(s => (s.seen ?? -Infinity) >= cutoff); }

/** @typedef {{ op: "ping" | "here" | "bye", sid: string, since: number }} SessionMessage */

/**
 * A session socket message `{ action: "leader", op: "ping" | "here" | "bye", sid, since }` read safely, or null.
 * @param {unknown} msg
 * @returns {SessionMessage | null}
 */
export function readSessionMessage(msg) {
  const m = /** @type {any} */ (msg);
  if (!m || typeof m !== "object" || m.action !== "leader" || !["ping", "here", "bye"].includes(m.op)) return null;
  if (typeof m.sid !== "string" || !ID_RE.test(m.sid)) return null;
  const since = Number(m.since);
  return { op: m.op, sid: m.sid, since: Number.isFinite(since) ? since : 0 };
}

/**
 * Applies a session message from `userId` (Foundry's sender id, never the message's word) at `now`. Returns the new table.
 * @param {Session[]} sessions
 * @param {SessionMessage | null} m
 * @param {string | null | undefined} userId
 * @param {number} [now]
 * @returns {Session[]}
 */
export function applySessionMessage(sessions = [], m, userId, now = 0) {
  if (!m || !userId) return sessions;
  const rest = sessions.filter(s => s.id !== m.sid);
  if (m.op === "bye") return rest;
  return [...rest, { id: m.sid, userId, since: m.since, seen: now }];
}

/**
 * The active GM user: Foundry's pick when it is an active GM, else the active GM with the lowest id, else null.
 * @template {UserLike} U
 * @param {Iterable<U>} users
 * @param {U | null} [declared] Foundry's `game.users.activeGM`
 * @returns {U | null}
 */
export function pickActiveGM(users = [], declared = null) {
  if (declared && declared.isGM && declared.active) return declared;
  return [...users].filter(u => u?.isGM && u.active).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
}

/**
 * @typedef {object} SeenCache
 * @property {(id: unknown) => boolean} firstTime true the first time an id is passed (and remembers it), false after; non-strings pass
 * @property {(id: string) => boolean} has
 * @property {number} size
 */

/**
 * A bounded "seen before" cache for request ids. The oldest ids drop off past `max`.
 * @param {number} [max]
 * @returns {SeenCache}
 */
export function seenCache(max = SEEN_MAX) {
  /** @type {Set<string>} */
  const ids = new Set();
  return {
    firstTime(id) {
      if (typeof id !== "string" || !id) return true;
      if (ids.has(id)) return false;
      ids.add(id);
      while (ids.size > max) ids.delete(/** @type {string} */ (ids.values().next().value));
      return true;
    },
    has: id => ids.has(id),
    get size() { return ids.size; }
  };
}

/**
 * A request id from a socket message, or null.
 * @param {unknown} msg
 * @returns {string | null}
 */
export function requestId(msg) {
  const rid = /** @type {any} */ (msg)?.rid;
  return typeof rid === "string" && ID_RE.test(rid) ? rid : null;
}

/** The shape `makeRequestId` produces: `<prefix>-<n>-<time in base 36>`. */
const RID_PARTS_RE = /^([A-Za-z0-9_-]{4,}?)-(\d{1,15})-([0-9a-z]{1,12})$/;

/**
 * Splits a request id made by `makeRequestId` into its parts, or null when it doesn't have that shape (the leader refuses those).
 * @param {unknown} rid
 * @returns {{ prefix: string, n: number, time: number } | null}
 */
export function parseRequestId(rid) {
  if (typeof rid !== "string" || !ID_RE.test(rid)) return null;
  const m = RID_PARTS_RE.exec(rid); if (!m) return null;
  const n = Number(m[2]); const time = parseInt(m[3], 36);
  return Number.isSafeInteger(n) && Number.isSafeInteger(time) ? { prefix: m[1], n, time } : null;
}

/**
 * A fresh request id: `<prefix>-<n>-<time>` cut to the id rules. Unique per client as long as `n` counts up.
 * @param {string} prefix this client's session id (or user id)
 * @param {number} n
 * @param {number} [now]
 * @returns {string}
 */
export function makeRequestId(prefix, n, now = Date.now()) {
  const s = `${String(prefix ?? "").padEnd(4, "x")}-${n}-${now.toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "");
  return s.slice(0, 64);
}

/** How long a client that doesn't take part in the election (a player) still counts a GM session it last heard (ms). Longer than a
 * background tab's slowed timers (about a minute), so a quiet leader tab isn't forgotten. */
export const PASSIVE_MAX_AGE_MS = 75_000;

/**
 * A broadcast hook message `{ action: "hook", name, sid, payload }` read safely, or null. `sid` is the sending GM session.
 * @param {unknown} msg
 * @returns {{ name: string, sid: string, payload: unknown } | null}
 */
export function readHookMessage(msg) {
  const m = /** @type {any} */ (msg);
  if (!m || typeof m !== "object" || m.action !== "hook") return null;
  if (typeof m.name !== "string" || !m.name || m.name.length > 200) return null;
  if (typeof m.sid !== "string" || !ID_RE.test(m.sid)) return null;
  return { name: m.name, sid: m.sid, payload: m.payload ?? {} };
}

/**
 * Whether a broadcast hook from another client may fire here. Every rule must hold; the first that fails is the reason.
 * The sender is Foundry's sender user (never a payload field): unknown senders and players are refused, and the hook must come
 * from the session this client currently counts as the leader.
 * @param {{ name: string, sid: string } | null} m from readHookMessage
 * @param {{ sender?: UserLike | null, leader?: Session | null, names?: Set<string> }} ctx sender: `game.users.get(senderId)`;
 *   leader: the session this client counts as the leader (its `userId` is Foundry's sender id for that session)
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function acceptHook(m, { sender = null, leader = null, names = new Set() } = {}) {
  if (!m) return { ok: false, reason: "not a hook message" };
  if (!names.has(m.name)) return { ok: false, reason: `hook ${m.name} isn't one of this module's broadcast hooks` };
  if (!sender) return { ok: false, reason: "hook from an unknown user refused" };
  if (!sender.isGM) return { ok: false, reason: "hook from a player refused" };
  if (!leader || m.sid !== leader.id || leader.userId !== sender.id) return { ok: false, reason: "hook from a session that isn't the leader refused" };
  return { ok: true };
}
