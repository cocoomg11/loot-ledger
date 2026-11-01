/**
 * Shared ESLint flat config for wanderers-core and every module that vendors it. No plugins and no packages besides `eslint`
 * itself: the recommended rule list and the globals are written out here, so a module's eslint.config.mjs only imports this file
 * from its vendored copy:
 *
 *   import { wanderersConfig } from "./vendor/wanderers-core/config/eslint.base.mjs";
 *   export default wanderersConfig({ ignores: ["packs/"] });
 *
 * Scripts (scripts/**, src/**) run in the browser with Foundry's globals; tests and tools run in Node.
 */

/** ESLint's "recommended" rules (eslint 10), as errors. */
const RECOMMENDED = [
  "constructor-super", "for-direction", "getter-return", "no-async-promise-executor", "no-case-declarations", "no-class-assign",
  "no-compare-neg-zero", "no-cond-assign", "no-const-assign", "no-constant-binary-expression", "no-constant-condition",
  "no-control-regex", "no-debugger", "no-delete-var", "no-dupe-args", "no-dupe-class-members", "no-dupe-else-if", "no-dupe-keys",
  "no-duplicate-case", "no-empty", "no-empty-character-class", "no-empty-pattern", "no-empty-static-block", "no-ex-assign",
  "no-extra-boolean-cast", "no-fallthrough", "no-func-assign", "no-global-assign", "no-import-assign", "no-invalid-regexp",
  "no-irregular-whitespace", "no-loss-of-precision", "no-misleading-character-class", "no-new-native-nonconstructor",
  "no-nonoctal-decimal-escape", "no-obj-calls", "no-octal", "no-prototype-builtins", "no-redeclare", "no-regex-spaces",
  "no-self-assign", "no-setter-return", "no-shadow-restricted-names", "no-sparse-arrays", "no-this-before-super", "no-undef",
  "no-unexpected-multiline", "no-unreachable", "no-unsafe-finally", "no-unsafe-negation", "no-unsafe-optional-chaining",
  "no-unused-labels", "no-unused-private-class-members", "no-unused-vars", "no-useless-backreference", "no-useless-catch",
  "no-useless-escape", "no-with", "require-yield", "use-isnan", "valid-typeof"
];

/** Globals shared by browsers and Node. */
const COMMON = ["console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "structuredClone", "URL",
  "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal", "fetch", "Response", "Request", "Headers",
  "globalThis", "crypto", "performance", "Blob", "atob", "btoa", "Event", "EventTarget"];
/** Browser globals a Foundry module uses. */
const BROWSER = ["window", "document", "navigator", "location", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement",
  "HTMLFormElement", "Element", "Node", "DocumentFragment", "CustomEvent", "MouseEvent", "KeyboardEvent", "FormData", "File",
  "FileReader", "Image", "HTMLFieldSetElement", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "MutationObserver", "ResizeObserver",
  "IntersectionObserver", "addEventListener", "removeEventListener", "DOMParser", "CSS", "WebSocket"];
/** Foundry VTT globals (v13/v14). Read-only: assigning to one is an error. */
const FOUNDRY = ["game", "ui", "canvas", "CONFIG", "CONST", "Hooks", "foundry", "fromUuid", "fromUuidSync", "Actor", "Item", "Scene",
  "JournalEntry", "JournalEntryPage", "ChatMessage", "Folder", "Macro", "RollTable", "Playlist", "User", "Combat", "Token",
  "TokenDocument", "Note", "NoteDocument", "Tile", "ActiveEffect", "Roll", "PIXI", "TextEditor", "Dialog", "FormApplication",
  "Application", "libWrapper", "socketlib"];
/** Node globals for tests and tools. */
const NODE = ["process", "Buffer", "__dirname", "__filename", "require", "module", "global"];

const ro = (/** @type {string[]} */ names) => Object.fromEntries(names.map(n => [n, "readonly"]));

/**
 * The flat config.
 * @param {{ ignores?: string[], browser?: string[], node?: string[], extraGlobals?: Record<string, "readonly" | "writable"> }} [opts]
 *   browser: globs for Foundry/browser code (default scripts/** and src/**); node: globs for Node code (tests, tools)
 * @returns {object[]}
 */
export function wanderersConfig({ ignores = [], browser = ["scripts/**/*.mjs", "src/**/*.mjs"], node = ["tests/**/*.mjs", "tools/**/*.mjs", "*.mjs", "config/**/*.mjs"], extraGlobals = {} } = {}) {
  const rules = Object.fromEntries(RECOMMENDED.map(r => [r, "error"]));
  return [
    { ignores: ["node_modules/", "dist/", "vendor/", "packs/", "coverage/", ...ignores] },
    {
      files: ["**/*.mjs", "**/*.js"],
      languageOptions: { ecmaVersion: 2024, sourceType: "module" },
      linterOptions: { reportUnusedDisableDirectives: "error" },
      rules: {
        ...rules,
        "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
        "no-empty": ["error", { allowEmptyCatch: true }],
        "no-implicit-globals": "error",
        "no-var": "error",
        "prefer-const": ["error", { destructuring: "all" }],
        "eqeqeq": ["error", "always", { null: "ignore" }],
        "no-eval": "error",
        "no-implied-eval": "error",
        "no-new-func": "error",
        "no-restricted-globals": ["error", { name: "localStorage", message: "Use a client setting instead (cleanup can find it)." }]
      }
    },
    { files: browser, languageOptions: { globals: { ...ro(COMMON), ...ro(BROWSER), ...ro(FOUNDRY), ...extraGlobals } } },
    { files: node, languageOptions: { globals: { ...ro(COMMON), ...ro(NODE), ...extraGlobals } } }
  ];
}

export default wanderersConfig;
