/**
 * Version strings: reading, comparing, release tags. Pure: no Foundry calls, tested in Node.
 */

/** The version of this copy of wanderers-core. The test suite checks it equals package.json. */
export const CORE_VERSION = "0.5.2";

/**
 * @typedef {{ parts: number[], pre: string }} ParsedVersion
 */

/**
 * "v1.2.3", "1.2", "1.2.3-beta.1" → { parts: [1, 2, 3], pre: "beta.1" }; null when there is no usable version.
 * Build metadata after "+" is ignored.
 * @param {unknown} v
 * @returns {ParsedVersion | null}
 */
export function parseVersion(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/^v(?=\d)/i, "").replace(/\+.*$/, "");
  const m = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(s);
  if (!m) return null;
  return { parts: m[1].split(".").map(Number), pre: m[2] ?? "" };
}

/** Compares two pre-release strings by semver rules (numeric identifiers numerically, numbers before words). */
function comparePre(/** @type {string} */ a, /** @type {string} */ b) {
  const A = a.split("."), B = b.split(".");
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i], y = B[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { const d = Number(x) - Number(y); if (d) return d < 0 ? -1 : 1; continue; }
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * -1 (a older), 0 (same), 1 (a newer), or null when either is missing or unreadable. Missing trailing parts count as 0
 * (1.2 = 1.2.0). A pre-release is older than the same version without one (1.2.0-beta.1 < 1.2.0).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1 | 0 | 1 | null}
 */
export function compareVersions(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  if (!A || !B) return null;
  for (let i = 0; i < Math.max(A.parts.length, B.parts.length); i++) {
    const x = A.parts[i] ?? 0, y = B.parts[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return /** @type {-1 | 0 | 1} */ (comparePre(A.pre, B.pre));
}

/** The only release tag shape the house accepts: vMAJOR.MINOR.PATCH (v1.24.0, never 1.24 or v1.24). */
export const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Whether a tag is a valid release tag.
 * @param {unknown} tag
 * @returns {boolean}
 */
export function isReleaseTag(tag) { return typeof tag === "string" && RELEASE_TAG.test(tag); }

/**
 * "v1.2.3" → "1.2.3"; null when the tag isn't a release tag.
 * @param {unknown} tag
 * @returns {string | null}
 */
export function tagVersion(tag) { return isReleaseTag(tag) ? String(tag).slice(1) : null; }
