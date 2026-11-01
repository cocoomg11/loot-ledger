/**
 * One writing client, socket request routing and hook broadcasts: the Foundry half of the one-writer election (the rules are in
 * ../leader-model.mjs and ../socket-model.mjs, tested in Node). Untested in Node: needs a live world with sockets.
 *
 * Everything is scoped to the host module: the channel is `module.<id>`, request kinds and hook names belong to that module, and all
 * state lives inside the object `createLeader()` returns. Two modules bundling different core versions each get their own leader on
 * their own channel and never see each other's messages.
 *
 * Use: every automatic write runs only when `leader.isLeader()`. Other clients (other GM tabs, players) call
 * `leader.request(kind, data)`; the leader runs the handler registered with `leader.handle(kind, fn)`, passing the sending user as
 * Foundry reports it (never the payload's word). Requests are schema-checked (`defineRequests`) and de-duplicated by request id.
 */
import * as M from "../leader-model.mjs";
import { readRequest, makeRequest, jsonBytes } from "../socket-model.mjs";
import { rateLimiter } from "../rate-model.mjs";

/**
 * @typedef {object} LeaderOptions
 * @property {string} id the host module id (module.json "id"; module.json must have "socket": true)
 * @property {import("../socket-model.mjs").RequestSchemas} [requests] from defineRequests(); kinds not listed are refused.
 *   A schema may have `from: "gm"` to accept the request only from GM users.
 * @property {string[]} [hooks] hook names `broadcastHook` may fire on other clients (each must start with "<id>.")
 * @property {string} [leaderHook] a hook fired on this client when it becomes or stops being the leader ({ leader: boolean })
 * @property {(...args: unknown[]) => void} [log] debug logger (createLogger(id).log)
 * @property {number} [settleMs]
 * @property {number} [heartbeatMs]
 * @property {number} [hookMaxBytes] largest broadcast hook payload (default 16 KiB)
 * @property {{ burst?: number, perSecond?: number } | false} [rateLimit] per-user limit on requests the leader accepts from other
 *   clients (token bucket; default 20 at once, 5 a second). `false` turns it off.
 */

/**
 * @typedef {object} Leader
 * @property {() => void} start call from the "ready" hook on every client
 * @property {() => void} stop stops pinging and listening (for tests and module teardown)
 * @property {() => Promise<void>} settled resolves once this client has heard the other GM clients
 * @property {() => boolean} isLeader true on the one client that writes
 * @property {(fn: () => void) => void} onLeader runs `fn` on the client that becomes the leader (after load settles or on hand-over)
 * @property {(fn: () => void) => void} onBye runs `fn` when this tab is closing (best effort)
 * @property {(kind: string, fn: (data: any, user: any, meta: { rid: string }) => unknown) => void} handle registers the leader's handler
 * @property {(kind: string, data?: Record<string, unknown>) => boolean} request has the leader run `kind`; false when no GM is connected or the data is invalid
 * @property {(name: string, payload?: unknown) => boolean} broadcastHook fires one of our hooks here, and on every other client when
 *   this client is the leader (other clients accept a broadcast hook only from the leader's session of a GM user). Returns whether
 *   it was sent to the other clients.
 * @property {() => any} activeGM the active GM user, or null
 * @property {() => { started: boolean, leader: boolean, sessions: number, self?: string, settled?: boolean }} info for health checks
 */

/**
 * @param {LeaderOptions} opts
 * @returns {Leader}
 */
export function createLeader(opts) {
  const id = opts?.id;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error("createLeader(): needs the module id");
  const channel = `module.${id}`;
  const schemas = opts.requests ?? {};
  const hookNames = new Set((opts.hooks ?? []).filter(h => typeof h === "string" && h.startsWith(`${id}.`)));
  const log = opts.log ?? (() => {});
  const settleMs = opts.settleMs ?? M.SETTLE_MS;
  const heartbeatMs = opts.heartbeatMs ?? M.HEARTBEAT_MS;
  const hookMax = opts.hookMaxBytes ?? 16 * 1024;
  const warn = (/** @type {unknown[]} */ ...a) => console.warn(`${id} |`, ...a);

  /** @type {{ self: M.Session | null, peers: M.Session[], lastPing: number | null, prevPing: number | null, started: boolean, settled: boolean, leader: string | null | undefined, leaderFor: string | null, settle: Promise<void> | null, timer: any, listener: any, connected: number | null }} */
  const S = { self: null, peers: [], lastPing: null, prevPing: null, started: false, settled: false, leader: null, leaderFor: null, settle: null, timer: null, listener: null, connected: null };
  /** @type {(() => void)[]} */ const leaderFns = [];
  /** @type {(() => void)[]} */ const byeFns = [];
  /** @type {Map<string, (data: any, user: any, meta: { rid: string }) => unknown>} */ const handlers = new Map();
  const seen = M.seenCache();
  const limiter = opts.rateLimit === false ? null : rateLimiter(opts.rateLimit ?? {});
  const helloLimiter = rateLimiter({ burst: 3, perSecond: 0.2 });
  let reqN = 0;

  const g = () => /** @type {any} */ (globalThis).game;
  const activeGM = () => {
    try { const users = g()?.users; return M.pickActiveGM(users?.contents ?? [...(users ?? [])], users?.activeGM ?? null); } catch { return null; }
  };
  const cutoff = () => M.aliveCutoff(S.prevPing);
  const emit = (/** @type {object} */ msg) => { try { g().socket.emit(channel, msg); return true; } catch { return false; } };
  const emitSession = (/** @type {"ping" | "here" | "bye"} */ op) => S.self && emit({ action: "leader", op, sid: S.self.id, since: S.self.since });

  function changed() {
    const me = !!S.self && S.leader === S.self.id;
    if (opts.leaderHook) { try { /** @type {any} */ (globalThis).Hooks?.callAll(opts.leaderHook, { leader: me }); } catch (e) { warn("leader hook", e); } }
    if (me) for (const fn of leaderFns) { try { fn(); } catch (e) { warn("leader change", e); } }
  }
  function recompute() {
    if (!S.started || !S.self) return;
    S.peers = M.prune(S.peers, cutoff());
    const was = S.leader; const gm = activeGM();
    S.leaderFor = gm?.id ?? null;
    S.leader = gm ? M.leaderOf(S.peers, { gmUserId: gm.id, cutoff: cutoff(), self: S.self }) : null;
    if (was === S.leader) return;
    log(`leader: ${S.leader ?? "none"}${S.leader === S.self.id ? " (this client)" : ""}`);
    if (S.settled) changed();
  }
  function ping() { S.prevPing = S.lastPing; S.lastPing = Date.now(); emitSession("ping"); recompute(); }

  /** The session this client counts as the leader. GM clients take part in the election; others (players) follow the GM sessions'
   * pings passively, with a longer cut-off. */
  function leaderSession() {
    if (S.self) { if (S.leaderFor !== activeGM()?.id) recompute(); return S.peers.find(p => p.id === S.leader) ?? (S.leader === S.self.id ? S.self : null); }
    const gm = activeGM(); if (!gm) return null;
    const live = M.prune(S.peers, Date.now() - M.PASSIVE_MAX_AGE_MS);
    const sid = M.leaderOf(live, { gmUserId: gm.id });
    return live.find(p => p.id === sid) ?? null;
  }

  function isLeader() {
    const gm = activeGM(); if (!gm || gm.id !== g()?.user?.id) return false;
    if (!S.started) return true;
    if (!S.settled || !S.self) return false;
    if (S.leaderFor !== gm.id) recompute();
    return S.leader === S.self.id;
  }

  /** @param {any} msg @param {string} senderId */
  async function onRequest(msg, senderId) {
    const gm = activeGM();
    if (!gm || gm.id !== g()?.user?.id) return;
    if (!S.settled) await settled();
    if (!isLeader()) return;
    // The sender is Foundry's sender id only: never a field in the payload. Unknown senders are refused.
    const user = typeof senderId === "string" ? g().users.get(senderId) : null; if (!user) return log("request from an unknown user refused");
    if (limiter && !limiter.take(user.id)) return log(`request from ${user.id} refused: too many requests`);
    const r = readRequest(schemas, msg);
    if (!r.ok) return log(`request refused: ${r.reason}`);
    if (!M.parseRequestId(r.rid)) return log("request refused: unreadable request id");
    if (schemas[r.kind].from === "gm" && !user.isGM) return log(`request ${r.kind} from a player refused`);
    if (!seen.firstTime(r.rid)) return log("duplicate request skipped", r.rid);
    const h = handlers.get(r.kind); if (!h) return log(`no handler for ${r.kind}`);
    try { await h(r.data, user, { rid: r.rid }); } catch (e) { warn(`request ${r.kind}`, e); }
  }

  /** @param {any} msg @param {string} senderId */
  function onMessage(msg, senderId) {
    if (!msg || typeof msg !== "object") return;
    if (msg.action === "leader" && msg.op === "hello") {
      // A client that just loaded asks who leads; the leader answers with its session. Rate-limited like requests.
      const sender = typeof senderId === "string" ? g().users.get(senderId) : null;
      if (sender && S.self && isLeader() && helloLimiter.take(sender.id)) emitSession("here");
      return;
    }
    if (msg.action === "leader") {
      const m = M.readSessionMessage(msg); if (!m || m.sid === S.self?.id) return;
      const sender = typeof senderId === "string" ? g().users.get(senderId) : null; if (!sender?.isGM) return;
      S.peers = M.applySessionMessage(S.peers, m, sender.id, Date.now());
      if (!S.started || !S.self) { S.peers = M.prune(S.peers, Date.now() - M.PASSIVE_MAX_AGE_MS); return; }
      if (m.op === "ping") emitSession("here");
      recompute();
      return;
    }
    if (msg.action === "request") { onRequest(msg, senderId).catch(e => warn("request", e)); return; }
    if (msg.action === "hook") {
      const m = M.readHookMessage(msg);
      const sender = typeof senderId === "string" ? g().users.get(senderId) ?? null : null;
      const ok = M.acceptHook(m, { sender, leader: leaderSession(), names: hookNames });
      if (!ok.ok) return log(ok.reason);
      if (jsonBytes(m?.payload) > hookMax) return log("hook payload too large");
      try { /** @type {any} */ (globalThis).Hooks.callAll(/** @type {any} */ (m).name, /** @type {any} */ (m).payload); } catch (e) { warn("hook", e); }
    }
  }

  function settled() { return S.started && !S.settled && S.settle ? S.settle : Promise.resolve(); }

  return {
    start() {
      if (S.listener) return;
      S.listener = onMessage;
      g().socket.on(channel, S.listener);
      if (!g().user?.isGM) { emit({ action: "leader", op: "hello" }); return; }
      S.self = { id: M.newId(), userId: g().user.id, since: Date.now() };
      S.started = true;
      S.settle = new Promise(res => setTimeout(() => { S.settled = true; S.leader = undefined; recompute(); res(); }, settleMs));
      ping();
      S.timer = setInterval(ping, heartbeatMs);
      globalThis.addEventListener?.("pagehide", () => { for (const fn of byeFns) { try { fn(); } catch { /* closing anyway */ } } emitSession("bye"); });
      S.connected = /** @type {any} */ (globalThis).Hooks.on("userConnected", (/** @type {any} */ user) => { if (user?.isGM) setTimeout(recompute, 0); });
    },
    stop() {
      if (S.timer) clearInterval(S.timer);
      if (S.self) emitSession("bye");
      try { if (S.listener) g().socket.off(channel, S.listener); } catch { /* socket gone */ }
      try { if (S.connected !== null) /** @type {any} */ (globalThis).Hooks.off("userConnected", S.connected); } catch { /* hooks gone */ }
      limiter?.clear(); helloLimiter.clear();
      Object.assign(S, { self: null, peers: [], started: false, settled: false, leader: null, timer: null, listener: null, connected: null });
    },
    settled,
    isLeader,
    onLeader(fn) { if (typeof fn === "function") leaderFns.push(fn); },
    onBye(fn) { if (typeof fn === "function") byeFns.push(fn); },
    handle(kind, fn) {
      if (!Object.hasOwn(schemas, kind)) throw new Error(`${id}: no request schema for "${kind}" (add it to defineRequests)`);
      handlers.set(kind, fn);
    },
    request(kind, data = {}) {
      const rid = M.makeRequestId(S.self?.id ?? String(g()?.user?.id ?? "user"), ++reqN);
      let msg;
      try { msg = makeRequest(schemas, kind, rid, data); } catch (e) { warn(e); return false; }
      if (isLeader()) {
        seen.firstTime(rid);
        const h = handlers.get(kind);
        if (h) Promise.resolve().then(() => h(msg.data, g().user, { rid })).catch(e => warn(kind, e));
        return true;
      }
      if (!activeGM()) return false;
      return emit(msg);
    },
    broadcastHook(name, payload = {}) {
      if (!hookNames.has(name)) throw new Error(`${id}: "${name}" isn't one of this module's broadcast hooks`);
      try { /** @type {any} */ (globalThis).Hooks.callAll(name, payload); } catch (e) { warn("hook", e); }
      if (!S.self || !isLeader()) { log(`hook ${name}: fired here only (this client isn't the leader)`); return false; }
      if (jsonBytes(payload) > hookMax) { warn(`hook ${name}: payload too large to broadcast`); return false; }
      return emit({ action: "hook", name, sid: S.self.id, payload });
    },
    activeGM,
    info() {
      if (!S.started || !S.self) return { started: false, leader: isLeader(), sessions: 0 };
      const self = S.self;
      const mine = M.prune(S.peers, cutoff()).filter(p => p.userId === self.userId);
      return { started: true, self: self.id, sessions: mine.length + 1, leader: S.leader === self.id, settled: S.settled };
    }
  };
}
