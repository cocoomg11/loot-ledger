/**
 * ESLint flat config (no plugins, no packages besides eslint): recommended rules plus browser/Foundry globals for scripts/,
 * Node globals for tests. Mirrors the shared config used by the author's other modules.
 */
/** ESLint's "recommended" rules (eslint 10), as errors, written out so no extra package is needed. */
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

const ro = names => Object.fromEntries(names.map(n => [n, "readonly"]));
const COMMON = ["console", "setTimeout", "clearTimeout", "structuredClone", "URL", "globalThis", "performance", "Blob", "Event"];
const BROWSER = ["window", "document", "navigator", "Element", "HTMLElement", "Node", "requestAnimationFrame", "cancelAnimationFrame",
  "getComputedStyle", "MutationObserver", "DOMParser"];
const FOUNDRY = ["game", "ui", "canvas", "CONFIG", "CONST", "Hooks", "foundry", "fromUuid", "fromUuidSync", "Item", "Actor", "RollTable",
  "JournalEntry", "ChatMessage", "Folder", "TextEditor"];
const NODE = ["process", "Buffer"];

export default [
  { ignores: ["node_modules/", "dist/", "vendor/"] },
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    rules: {
      ...Object.fromEntries(RECOMMENDED.map(r => [r, "error"])),
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "eqeqeq": ["error", "always", { null: "ignore" }]
    }
  },
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { ...ro(COMMON), ...ro(BROWSER), ...ro(FOUNDRY) } } },
  { files: ["tests/**/*.mjs", "tools/**/*.mjs", "*.mjs"], languageOptions: { globals: { ...ro(COMMON), ...ro(NODE) } } }
];
