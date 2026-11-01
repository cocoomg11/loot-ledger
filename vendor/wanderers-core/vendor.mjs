#!/usr/bin/env node
/**
 * wanderers-core vendor tool: copies a pinned version of core into a module and checks that the copy matches its pin.
 * Node 20+ only, no packages. Run from the module's root folder.
 *
 *   node vendor/wanderers-core/vendor.mjs install 0.1.0        download release v0.1.0 and pin it
 *   node vendor/wanderers-core/vendor.mjs update 0.2.0         the same, for a module that already has core (shows what changed)
 *   node <core checkout>/tools/vendor.mjs install --from <core checkout>   pin a local, unreleased copy (source "local")
 *   node vendor/wanderers-core/vendor.mjs verify               the vendored files match the lock (CI runs this)
 *   node vendor/wanderers-core/vendor.mjs verify --remote      ...and the lock matches the published release
 *   node tools/vendor.mjs bundle --out dist                    (core only) build the release asset
 *
 * Options: --dir <folder> (default vendor/wanderers-core), --lock <file> (default wanderers-core.lock.json), --force (replace a
 * vendored copy that was edited by hand), --repo <owner/name> (default cocoomg11/wanderers-core).
 *
 * Content hash: sha256 over the sorted list of "<path>\n<sha256 of the file>\n", with CRLF read as LF (so a Windows checkout with
 * autocrlf hashes the same as Linux CI). The lock file records version, hash and source; the vendored folder holds exactly the
 * bundle's files, nothing more.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BUNDLE_FORMAT = 1;
export const LOCK_VERSION = 1;
export const NAME = "wanderers-core";
export const DEFAULT_REPO = "cocoomg11/wanderers-core";
export const DEFAULT_DIR = "vendor/wanderers-core";
export const DEFAULT_LOCK = "wanderers-core.lock.json";
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** @typedef {Record<string, string>} FileMap path (with "/") → text */
/** @typedef {{ name: string, format: number, version: string, hash: string, files: FileMap }} Bundle */
/** @typedef {{ name: string, lockVersion: number, version: string, hash: string, source: "release" | "local", dir: string, files: number, asset?: string, commit?: string }} Lock */

const sha256 = (/** @type {string} */ s) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Text as hashed and written: CRLF and lone CR become LF.
 * @param {string} s
 * @returns {string}
 */
export const normalize = s => s.replace(/\r\n?/g, "\n");

/**
 * The content hash of a file map: "sha256-<hex>".
 * @param {FileMap} files
 * @returns {string}
 */
export function hashFiles(files) {
  const lines = Object.keys(files).sort().map(p => `${p}\n${sha256(normalize(files[p]))}\n`);
  return `sha256-${sha256(lines.join(""))}`;
}

/**
 * Problems with a bundle's paths and sizes (an empty list when it's safe to write).
 * @param {FileMap} files
 * @returns {string[]}
 */
export function checkPaths(files) {
  const out = [];
  const keys = Object.keys(files ?? {});
  if (!keys.length) out.push("the bundle has no files");
  if (keys.length > MAX_FILES) out.push(`the bundle has ${keys.length} files (limit ${MAX_FILES})`);
  for (const p of keys) {
    if (!PATH_RE.test(p) || p.split("/").some(part => part === "." || part === "..")) out.push(`unsafe path ${JSON.stringify(p)}`);
    if (typeof files[p] !== "string") out.push(`${p} isn't text`);
    else if (Buffer.byteLength(files[p], "utf8") > MAX_FILE_BYTES) out.push(`${p} is larger than ${MAX_FILE_BYTES} bytes`);
  }
  return out;
}

/**
 * Every file under `dir` (relative, "/" separated). Missing dir → {}.
 * @param {string} dir
 * @returns {FileMap}
 */
export function readTree(dir) {
  /** @type {FileMap} */
  const out = {};
  if (!existsSync(dir)) return out;
  const walk = (/** @type {string} */ d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

/**
 * What goes into a module from a core checkout: src/** (at the top of the vendored folder, so src/styles/wanderers-ui.css ships
 * as vendor/wanderers-core/styles/wanderers-ui.css, which Foundry loads from a module.json `styles` entry), config/**,
 * tools/vendor.mjs (as vendor.mjs) and LICENSE. Text normalised to LF.
 * @param {string} coreRoot
 * @returns {FileMap}
 */
export function coreFiles(coreRoot) {
  /** @type {FileMap} */
  const files = {};
  for (const [p, text] of Object.entries(readTree(join(coreRoot, "src")))) files[p] = normalize(text);
  for (const [p, text] of Object.entries(readTree(join(coreRoot, "config")))) files[`config/${p}`] = normalize(text);
  files["vendor.mjs"] = normalize(readFileSync(join(coreRoot, "tools", "vendor.mjs"), "utf8"));
  files["LICENSE"] = normalize(readFileSync(join(coreRoot, "LICENSE"), "utf8"));
  return files;
}

/**
 * The release bundle for a core checkout.
 * @param {string} coreRoot
 * @returns {Bundle}
 */
export function buildBundle(coreRoot) {
  const pkg = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8"));
  if (pkg.name !== NAME || !VERSION_RE.test(pkg.version)) throw new Error(`${coreRoot} isn't a ${NAME} checkout with a release version`);
  const files = coreFiles(coreRoot);
  const problems = checkPaths(files);
  if (problems.length) throw new Error(problems.join("; "));
  return { name: NAME, format: BUNDLE_FORMAT, version: pkg.version, hash: hashFiles(files), files };
}

/**
 * Checks a downloaded bundle: shape, version, safe paths, and that its declared hash is its content's hash.
 * @param {unknown} b
 * @param {string} [version] the version asked for
 * @returns {string[]} problems
 */
export function checkBundle(b, version) {
  const x = /** @type {any} */ (b);
  if (!x || typeof x !== "object" || x.name !== NAME || x.format !== BUNDLE_FORMAT) return ["not a wanderers-core bundle (or an unknown bundle format)"];
  if (version && x.version !== version) return [`the bundle is version ${x.version}, not ${version}`];
  const problems = checkPaths(x.files);
  if (problems.length) return problems;
  if (hashFiles(x.files) !== x.hash) return ["the bundle's files don't match its hash"];
  return [];
}

/**
 * Compares the vendored folder with a lock: { ok, problems, added, removed, changed }.
 * @param {FileMap} tree the vendored folder (readTree)
 * @param {Lock | null} lock
 * @param {FileMap} [expected] the bundle's files, when known, to name which files differ
 */
export function verifyTree(tree, lock, expected) {
  /** @type {string[]} */
  const problems = [];
  if (!lock) return { ok: false, problems: ["no lock file"], added: [], removed: [], changed: [] };
  if (lock.name !== NAME || lock.lockVersion !== LOCK_VERSION) problems.push("the lock file isn't a wanderers-core lock this tool reads");
  if (!VERSION_RE.test(String(lock.version))) problems.push(`the lock's version ${JSON.stringify(lock.version)} isn't X.Y.Z`);
  const count = Object.keys(tree).length;
  if (!count) problems.push(`${lock.dir ?? DEFAULT_DIR} is missing or empty`);
  const hash = hashFiles(tree);
  if (count && hash !== lock.hash) problems.push(`the vendored files don't match the pin (lock ${lock.hash}, files ${hash}): something was edited, added or removed by hand. Run the vendor tool's install with the pinned version (and --force) to restore it`);
  if (count && lock.files !== count) problems.push(`the lock lists ${lock.files} files, the folder has ${count}`);
  const d = expected ? diff(expected, tree) : { added: [], removed: [], changed: [] };
  return { ok: problems.length === 0, problems, ...d };
}

/**
 * Files added, removed and changed going from `a` to `b` (paths).
 * @param {FileMap} a
 * @param {FileMap} b
 */
export function diff(a, b) {
  const added = Object.keys(b).filter(p => !(p in a)).sort();
  const removed = Object.keys(a).filter(p => !(p in b)).sort();
  const changed = Object.keys(b).filter(p => p in a && normalize(a[p]) !== normalize(b[p])).sort();
  return { added, removed, changed };
}

/**
 * The release asset URL for a version.
 * @param {string} version
 * @param {string} [repo]
 * @returns {string}
 */
export const assetUrl = (version, repo = DEFAULT_REPO) => `https://github.com/${repo}/releases/download/v${version}/${NAME}-${version}.json`;

/**
 * Writes a bundle's files into `dir` (which is emptied first) and returns the lock.
 * @param {string} root module root
 * @param {string} dir vendored folder, relative to root
 * @param {Bundle} bundle
 * @param {{ source: "release" | "local", asset?: string, commit?: string }} meta
 * @returns {Lock}
 */
export function writeVendored(root, dir, bundle, meta) {
  const target = resolve(root, dir);
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`--dir ${dir} is outside the module folder`);
  rmSync(target, { recursive: true, force: true });
  for (const [p, text] of Object.entries(bundle.files)) {
    const full = join(target, ...p.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, normalize(text));
  }
  /** @type {Lock} */
  const lock = { name: NAME, lockVersion: LOCK_VERSION, version: bundle.version, hash: bundle.hash, source: meta.source, dir, files: Object.keys(bundle.files).length };
  if (meta.asset) lock.asset = meta.asset;
  if (meta.commit) lock.commit = meta.commit;
  return lock;
}

/**
 * Reads the lock file, or null.
 * @param {string} file
 * @returns {Lock | null}
 */
export function readLock(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

/**
 * Downloads and checks a release bundle.
 * @param {string} version
 * @param {string} repo
 * @returns {Promise<Bundle>}
 */
export async function fetchBundle(version, repo) {
  const url = assetUrl(version, repo);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`couldn't download ${url} (HTTP ${res.status}). Is v${version} published?`);
  const text = await res.text();
  /** @type {unknown} */ let b;
  try { b = JSON.parse(text); } catch { throw new Error(`${url} isn't JSON`); }
  const problems = checkBundle(b, version);
  if (problems.length) throw new Error(`${url}: ${problems.join("; ")}`);
  return /** @type {Bundle} */ (b);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const o = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force" || a === "--remote") o[a.slice(2)] = true;
    else if (a.startsWith("--")) { o[a.slice(2)] = argv[i + 1] ?? ""; i++; }
    else pos.push(a);
  }
  return { cmd: pos[0], arg: pos[1], o };
}

const say = (/** @type {string} */ s) => process.stdout.write(`${s}\n`);
const fail = (/** @type {string} */ s) => { process.stderr.write(`${process.env.GITHUB_ACTIONS ? "::error title=wanderers-core::" : "error: "}${s}\n`); process.exit(1); };

/** @param {string[]} argv */
export async function main(argv) {
  const { cmd, arg, o } = parseArgs(argv);
  const root = process.cwd();
  const dir = String(o.dir || DEFAULT_DIR);
  const lockFile = resolve(root, String(o.lock || DEFAULT_LOCK));
  const repo = String(o.repo || DEFAULT_REPO);

  if (cmd === "bundle") {
    const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const out = resolve(root, String(o.out || "dist"));
    const b = buildBundle(coreRoot);
    mkdirSync(out, { recursive: true });
    const file = join(out, `${NAME}-${b.version}.json`);
    writeFileSync(file, JSON.stringify(b, null, 1) + "\n");
    writeFileSync(`${file}.sha256`, `${b.hash}\n`);
    say(`${relative(root, file)}: ${Object.keys(b.files).length} files, ${b.hash}`);
    return;
  }

  if (cmd === "install" || cmd === "update") {
    const before = readLock(lockFile);
    const tree = readTree(resolve(root, dir));
    if (Object.keys(tree).length && !o.force) {
      const v = verifyTree(tree, before);
      if (!v.ok) fail(`${dir} doesn't match ${relative(root, lockFile)} (${v.problems.join("; ")}). Pass --force to replace it.`);
    }
    /** @type {Bundle} */ let bundle; /** @type {Lock} */ let lock;
    if (o.from) {
      const coreRoot = resolve(root, String(o.from));
      bundle = buildBundle(coreRoot);
      if (arg && arg !== bundle.version) fail(`${coreRoot} is version ${bundle.version}, not ${arg}`);
      let commit = "";
      try { const head = readFileSync(join(coreRoot, ".git", "HEAD"), "utf8").trim(); commit = head.startsWith("ref: ") ? readFileSync(join(coreRoot, ".git", ...head.slice(5).split("/")), "utf8").trim() : head; } catch { /* not a git checkout */ }
      lock = writeVendored(root, dir, bundle, { source: "local", ...(commit ? { commit } : {}) });
    } else {
      if (!arg || !VERSION_RE.test(arg)) fail(`${cmd} needs a version like 0.1.0 (or --from <core checkout>)`);
      bundle = await fetchBundle(String(arg), repo);
      lock = writeVendored(root, dir, bundle, { source: "release", asset: assetUrl(bundle.version, repo) });
    }
    writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
    const d = diff(tree, bundle.files);
    say(`${NAME} ${before?.version ?? "(none)"} → ${bundle.version} in ${dir} (${lock.source}, ${lock.hash})`);
    if (Object.keys(tree).length) say(`  added ${d.added.length}, removed ${d.removed.length}, changed ${d.changed.length}${[...d.added.map(p => `\n  + ${p}`), ...d.removed.map(p => `\n  - ${p}`), ...d.changed.map(p => `\n  ~ ${p}`)].join("")}`);
    say(`Read core's CHANGELOG for ${bundle.version}, run your tests, and commit ${dir} together with ${relative(root, lockFile)}.`);
    return;
  }

  if (cmd === "verify") {
    const lock = readLock(lockFile);
    if (!lock) fail(`no lock file at ${relative(root, lockFile)}`);
    const l = /** @type {Lock} */ (lock);
    const tree = readTree(resolve(root, o.dir ? dir : l.dir || dir));
    /** @type {FileMap | undefined} */ let expected;
    const remote = o.remote === true || o.remote === "true";
    if (remote) {
      if (l.source !== "release") say(`${process.env.GITHUB_ACTIONS ? "::warning title=wanderers-core::" : "warning: "}the pin is a local, unreleased copy (${l.commit ?? "no commit"}); only the vendored files were checked. Pin a published release before releasing the module.`);
      else {
        const b = await fetchBundle(l.version, repo);
        if (b.hash !== l.hash) fail(`the lock's hash ${l.hash} isn't release v${l.version}'s hash ${b.hash}`);
        expected = b.files;
      }
    }
    const v = verifyTree(tree, l, expected);
    if (!v.ok) fail([...v.problems, ...v.added.map(p => `extra file ${p}`), ...v.removed.map(p => `missing file ${p}`), ...v.changed.map(p => `edited file ${p}`)].join("\n"));
    say(`${NAME} ${l.version} OK: ${v.problems.length ? "" : `${l.files} files match ${l.hash}`}${expected ? " (and the published release)" : ""}`);
    return;
  }

  say("usage: vendor.mjs install <version> | update <version> | install --from <core checkout> | verify [--remote] | bundle --out <dir>");
  if (cmd) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(e => fail(String(e?.message ?? e)));
}
