# CLAUDE.md: Loot Ledger

Foundry VTT module (v13/v14, dnd5e) that copies the classic MMO item compendium from the `wow-classic-items` module into world compendiums with sell-accurate prices, and generates rollable loot tables (by quality x level band, item type, mixed drops, creature type). Optionally converts items to 5e. Code only, no item data. Requires `wow-classic-items`. Public repo, MIT.

## File map (`scripts/`)
- `main.mjs` entry: settings (`coinRatio`, `convertOnBuild`, `reviewBoard`, `qualityColours`, `qualityRarityFallback`, `qualityPicker`), the "Build loot pools" settings menu (with a Review board button), feature registration, API registration.
- `data.mjs` pure constants and helpers: qualities, level bands, categories, creature regexes, item parsing, prices, coin formatting.
- `build.mjs` build pipeline: copies source items into world pack "Loot Ledger · Items" (price = 2x vendor sell, so selling pays the original amount), then writes "Loot Ledger · Tables".
- `convert.mjs` converter classic MMO item -> dnd5e 2024 item. Every feature must trace to one source tooltip line; untranslatable lines go to GM review, never invented.
- `api.mjs` public API: `game.modules.get("loot-ledger").api` (build, convertToPack, reviewBoard, setQuality, qualityOf, ...).
- `review-model.mjs` (pure) review statuses, actions, rebuild protection (`protectReviewed`, `carryReview`), table exclusion (`isRejected`), queue filters / counts, `itemView`, shortcuts; `review.mjs` the Review board window (ApplicationV2) and its Build Report button.
- `quality-model.mjs` (pure) quality resolution (explicit flag, then rarity fallback), CSS classes, flag update; `quality.mjs` render hooks, item sheet picker, "Set quality" context entry, Item Piles observer, `setQuality`.
- Also `styles/`, `lang/en.json`.

## Key patterns
- Convert is opt-in code: `api.convertToPack`, not part of Build on main (v0.2.0 state).
- Stat-less items reflavour an official item of the same slot/rarity, copied at build time from the user's installed compendiums; the repo stores names only, never official text.
- Prices are stored as decimals in the largest coin; the 5e converter never raises ability scores.
- No feature registry, health check or update-notes card; settings are minimal.
- `build({ dryRun: true })` runs every stage up to the writes and returns `{ dryRun, plan, report, build (counts), ... }`. Every write path (`applySync`, `clearPack`, folder and table creation, `writeReport`, chat, pack creation, confirm dialog) is skipped and also guarded by `noWrites(dryRun, ...)`, which throws. Any new write in `build()` must be skipped under `dryRun` and guarded the same way; `tests/build.test.mjs` spies on every write call and asserts zero.
- "<Random enchantment>" is flavour: it is not added to the not-converted list.
- **Review decisions** live on the converted item: `flags.loot-ledger.review = {status, note, by, at}` (status pending | accepted | tweaked | skipped | rejected). In `build()`, `protectReviewed` drops accepted/tweaked ids from the converted plan's `replace` unless `force` (removals from the source still happen); `carryReview` copies the review onto rewritten items (force resets accepted/tweaked to pending with `previous`). Rejected ids (read from the converted pack even when conversion is off) are made non-rollable before `planTables`. Keep all three when changing the build.
- **Quality colours** are render-hook only (no per-frame work, no document writes except the GM picker / `setQuality`). Explicit `flags.loot-ledger.quality` (same key Build writes) beats the rarity fallback. Item Piles windows are Svelte: one MutationObserver per open window (hooks `item-piles-openInterface` / `-closeInterface`), matched by item name.
- Settings `reviewBoard`, `qualityColours`, `qualityPicker` need a reload and register nothing when off; `qualityRarityFallback` is live.
- Writes (build, conversion) run from a GM-triggered action; do not add automatic hooks that write documents without an active-GM check.

## Branches
- `main` = released v0.2.0 plus docs. `v030-dev` = v0.3.0 prep (unmerged, unreleased): convert-on-build, incremental/resumable builds (`flags.loot-ledger.hash`), GM review pages, Build Report journal, `scripts/rules.mjs` (all tunable numbers), `scripts/replace-list.mjs`, `scripts/ledger.mjs` (pure bookkeeping), `tests/`, `tools/calibration-report.mjs`, `BOOK-DAY.md`. Do feature work for 0.3.0 there.

## Tests
- `tests/review.test.mjs` (review transitions, queue, build protection / carry / table exclusion incl. dry run) and `tests/quality.test.mjs` (quality resolution, rarity fallback for dnd5e 5 and 6 shapes, explicit override). The windows, hooks, context menu and Item Piles colouring need a live world.
- On main there is no test suite. On `v030-dev`: `npm test` (`node --test tests/*.test.mjs`), `npm run check`, `npm run calibrate`; pure logic (data, rules, ledger, replace list, build planning) is tested in Node with fixtures; `build()` is tested against an in-memory Foundry mock (`tests/_foundry.mjs`, including dry-run write guards); real compendium writes need a live Foundry world.

## Release process
1. Bump `version` in `module.json` and the `download` URL (`.../releases/download/vX.Y.Z/module.zip`); manifest URL stays `.../releases/latest/download/module.json`.
2. Update `CHANGELOG.md`. Merge to main.
3. **Agents never tag or publish.** The user publishes the GitHub release; the Release workflow sets version/URLs and uploads `module.json` and `module.zip` (`module.json scripts styles lang README.md LICENSE`). A new top-level folder must be added to the zip step.

## Rules
- Public repo: no campaign names, no game-publisher (WoW/Blizzard) wording beyond the required source-module name, no private details (IPs, domains, paths).
- No official non-SRD rules text anywhere (code, tests, fixtures, commits, issues); record conventions in your own words and numbers. SRD 5.2 is fine. Never use 5etools or other unofficial rules sites.
- Every option must be a setting that can be turned off; conversion is off by default.
- The README carries an unofficial fan-content disclaimer; keep it.
- Commit author `cocoomg11 <cocoomg11@users.noreply.github.com>`; end commit messages with the attribution trailers given by the session.
