/**
 * Schema-checked socket requests (pure; tested in Node). A request travels as `{ action: "request", kind, rid, data }` on the host
 * module's own channel (`module.<id>`). The receiving client reads it with `readRequest(schemas, msg)` before anything else:
 * unknown kinds, a missing or malformed request id, oversized payloads, unknown fields and wrong types are refused with a reason.
 * Who sent it is never read from the payload: the Foundry half passes Foundry's sender id to the handler.
 *
 * A schema is plain data:
 *   { kind: { fields: { name: Field, … }, maxBytes?, extra?: "reject" | "drop", from?: "gm" | "any" } }
 * `from: "gm"`: the Foundry half accepts the request only from a GM user (checked from Foundry's sender id).
 * Field types:
 *   { type: "string", min?, max?, pattern?, oneOf? }   max defaults to 1000 characters
 *   { type: "number", int?, min?, max? }              finite numbers only
 *   { type: "boolean" }
 *   { type: "id" }                                    a Foundry document id (16 letters and digits)
 *   { type: "uuid", max? }                            a document UUID such as "Scene.abc.Token.def" (letters, digits, ".", "_", "-")
 *   { type: "array", of: Field, max? }                max defaults to 100 items
 *   { type: "object", fields: { … }, extra? }         nested object with its own fields
 * Every field may have `optional: true`. Missing optional fields are left out of the result.
 */
import { ID_RE } from "./leader-model.mjs";

/** Default payload limit, in bytes of JSON. */
export const MAX_BYTES = 16 * 1024;
/** How deep objects and arrays may nest. */
export const MAX_DEPTH = 6;
const KIND_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const DOC_ID_RE = /^[A-Za-z0-9]{16}$/;
const UUID_RE = /^[A-Za-z0-9_.-]{1,}$/;
const TYPES = new Set(["string", "number", "boolean", "id", "uuid", "array", "object"]);

/**
 * @typedef {object} Field
 * @property {"string" | "number" | "boolean" | "id" | "uuid" | "array" | "object"} type
 * @property {boolean} [optional]
 * @property {number} [min]
 * @property {number} [max]
 * @property {boolean} [int]
 * @property {RegExp} [pattern]
 * @property {readonly (string | number)[]} [oneOf]
 * @property {Field} [of]
 * @property {Record<string, Field>} [fields]
 * @property {"reject" | "drop"} [extra]
 */
/** @typedef {{ fields: Record<string, Field>, maxBytes?: number, extra?: "reject" | "drop", from?: "gm" | "any" }} RequestSchema */
/** @typedef {Record<string, RequestSchema>} RequestSchemas */
/** @typedef {{ ok: true, kind: string, rid: string, data: Record<string, unknown> } | { ok: false, reason: string, kind?: string, rid?: string }} ReadResult */

/**
 * Checks a schema table once, at definition time, and returns it frozen. Throws on a programming mistake (a bad kind name, an
 * unknown field type), so it fails in tests rather than in a live world.
 * @template {RequestSchemas} S
 * @param {S} schemas
 * @returns {Readonly<S>}
 */
export function defineRequests(schemas) {
  if (!schemas || typeof schemas !== "object") throw new Error("defineRequests(): expected { kind: { fields } }");
  const field = (/** @type {Field} */ f, /** @type {string} */ path) => {
    if (!f || typeof f !== "object" || !TYPES.has(f.type)) throw new Error(`defineRequests(): ${path} has no known type`);
    if (f.type === "array") field(/** @type {Field} */ (f.of), `${path}[]`);
    if (f.type === "object") for (const [k, sub] of Object.entries(f.fields ?? {})) field(sub, `${path}.${k}`);
  };
  for (const [kind, s] of Object.entries(schemas)) {
    if (!KIND_RE.test(kind)) throw new Error(`defineRequests(): "${kind}" isn't a usable request kind`);
    if (!s || typeof s.fields !== "object") throw new Error(`defineRequests(): ${kind} needs fields`);
    if (s.from !== undefined && s.from !== "gm" && s.from !== "any") throw new Error(`defineRequests(): ${kind} from should be "gm" or "any"`);
    for (const [k, f] of Object.entries(s.fields)) field(f, `${kind}.${k}`);
  }
  return Object.freeze({ ...schemas });
}

/**
 * The size of a value as JSON in bytes (UTF-8), or Infinity when it can't be serialised (cycles, BigInt).
 * @param {unknown} v
 * @returns {number}
 */
export function jsonBytes(v) {
  try { const s = JSON.stringify(v); return s === undefined ? 0 : new TextEncoder().encode(s).length; } catch { return Infinity; }
}

/**
 * Reads one value against a field: { ok, value } or { ok: false, reason }.
 * @param {Field} f
 * @param {unknown} v
 * @param {string} path
 * @param {number} depth
 * @returns {{ ok: true, value: unknown } | { ok: false, reason: string }}
 */
function readField(f, v, path, depth) {
  const bad = (/** @type {string} */ why) => ({ ok: /** @type {const} */ (false), reason: `${path} ${why}` });
  if (depth > MAX_DEPTH) return bad("is nested too deeply");
  switch (f.type) {
    case "string": {
      if (typeof v !== "string") return bad("should be text");
      if (v.length < (f.min ?? 0)) return bad(`is shorter than ${f.min} characters`);
      if (v.length > (f.max ?? 1000)) return bad(`is longer than ${f.max ?? 1000} characters`);
      if (f.pattern && !f.pattern.test(v)) return bad("doesn't have the expected form");
      if (f.oneOf && !f.oneOf.includes(v)) return bad(`should be one of ${f.oneOf.join(", ")}`);
      return { ok: true, value: v };
    }
    case "number": {
      if (typeof v !== "number" || !Number.isFinite(v)) return bad("should be a number");
      if (f.int && !Number.isInteger(v)) return bad("should be a whole number");
      if (f.min !== undefined && v < f.min) return bad(`should be at least ${f.min}`);
      if (f.max !== undefined && v > f.max) return bad(`should be at most ${f.max}`);
      if (f.oneOf && !f.oneOf.includes(v)) return bad(`should be one of ${f.oneOf.join(", ")}`);
      return { ok: true, value: v };
    }
    case "boolean": return typeof v === "boolean" ? { ok: true, value: v } : bad("should be true or false");
    case "id": return typeof v === "string" && DOC_ID_RE.test(v) ? { ok: true, value: v } : bad("should be a document id");
    case "uuid": return typeof v === "string" && v.length <= (f.max ?? 300) && UUID_RE.test(v) && v.includes(".") ? { ok: true, value: v } : bad("should be a document UUID");
    case "array": {
      if (!Array.isArray(v)) return bad("should be a list");
      if (v.length > (f.max ?? 100)) return bad(`has more than ${f.max ?? 100} items`);
      const out = [];
      for (let i = 0; i < v.length; i++) {
        const r = readField(/** @type {Field} */ (f.of), v[i], `${path}[${i}]`, depth + 1);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case "object": return readObject(f.fields ?? {}, v, path, depth + 1, f.extra);
    default: return bad("has an unknown type in the schema");
  }
}

/**
 * @param {Record<string, Field>} fields
 * @param {unknown} v
 * @param {string} path
 * @param {number} depth
 * @param {"reject" | "drop"} [extra]
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, reason: string }}
 */
function readObject(fields, v, path, depth, extra = "reject") {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return { ok: false, reason: `${path} should be an object` };
  const src = /** @type {Record<string, unknown>} */ (v);
  if (extra !== "drop") for (const k of Object.keys(src)) if (!Object.hasOwn(fields, k)) return { ok: false, reason: `${path}.${k} isn't expected` };
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, f] of Object.entries(fields)) {
    if (!Object.hasOwn(src, k) || src[k] === undefined) {
      if (f.optional) continue;
      return { ok: false, reason: `${path}.${k} is missing` };
    }
    const r = readField(f, src[k], `${path}.${k}`, depth);
    if (!r.ok) return r;
    out[k] = r.value;
  }
  return { ok: true, value: out };
}

/**
 * Reads a socket request against the schemas. Never throws. The result carries the `kind` and `rid` when they were readable, so a
 * refusal can be answered or logged.
 * @param {RequestSchemas} schemas
 * @param {unknown} msg
 * @returns {ReadResult}
 */
export function readRequest(schemas, msg) {
  try {
    const m = /** @type {any} */ (msg);
    if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, reason: "not a request" };
    if (m.action !== "request") return { ok: false, reason: "not a request" };
    if (typeof m.kind !== "string" || !Object.hasOwn(schemas, m.kind)) return { ok: false, reason: `unknown request kind ${JSON.stringify(String(m.kind ?? "")).slice(0, 80)}` };
    const kind = m.kind; const s = schemas[kind];
    if (typeof m.rid !== "string" || !ID_RE.test(m.rid)) return { ok: false, kind, reason: "missing or malformed request id" };
    const rid = m.rid;
    const size = jsonBytes(m.data ?? {});
    if (size > (s.maxBytes ?? MAX_BYTES)) return { ok: false, kind, rid, reason: `payload too large (${size} bytes, limit ${s.maxBytes ?? MAX_BYTES})` };
    const r = readObject(s.fields, m.data ?? {}, "data", 0, s.extra);
    if (!r.ok) return { ok: false, kind, rid, reason: r.reason };
    return { ok: true, kind, rid, data: r.value };
  } catch (e) {
    return { ok: false, reason: `unreadable request (${String(/** @type {any} */ (e)?.message ?? e)})` };
  }
}

/**
 * Builds the request envelope a client sends. Throws when `data` wouldn't pass the receiver's checks, so a sender bug shows up
 * where it is made.
 * @param {RequestSchemas} schemas
 * @param {string} kind
 * @param {string} rid
 * @param {Record<string, unknown>} data
 * @returns {{ action: "request", kind: string, rid: string, data: Record<string, unknown> }}
 */
export function makeRequest(schemas, kind, rid, data = {}) {
  const msg = { action: /** @type {const} */ ("request"), kind, rid, data };
  const r = readRequest(schemas, msg);
  if (!r.ok) throw new Error(`request ${kind}: ${r.reason}`);
  return { ...msg, data: r.data };
}
