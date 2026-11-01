# CLAUDE.md: Loot Ledger

Foundry VTT module (v13/v14, dnd5e) that copies the classic MMO item compendium from the `wow-classic-items` module into world compendiums with sell-accurate prices, and generates rollable loot tables (by quality x level band, item type, mixed drops, creature type). Optionally converts items to 5e. Code only, no item data. Requires `wow-classic-items`. Public repo, MIT.

## File map (`scripts/`)
- `main.mjs` entry: settings (`coinRatio`, `convertOnBuild`), the "Build loot pools" settings menu, API registration.
- `data.mjs` pure constants and helpers: qualities, level bands, categories, creature regexes, item parsing, prices, coin formatting.
- `build.mjs` build pipeline: copies source items into world pack "Loot Ledger · Items" (price = 2x vendor sell, so selling pays the original amount), then writes "Loot Ledger · Tables".
- `convert.mjs` converter classic MMO item -> dnd5e 2024 item. Every feature must trace to one source tooltip line; untranslatable lines go to GM review, never invented.
- `api.mjs` public API: `game.modules.get("loot-ledger").api` (build, convertToPack, ...).
- `tooltip.mjs` opt-in item tooltip (client setting `itemTooltip`, default off, shown only while Shift is held): document-level pointer/key listeners, item lookup from `data-item-uuid` / `data-uuid` / `data-item-id` / `.directory-item[data-entry-id]` and chat cards (`getAssociatedItem`), one fixed `#loot-ledger-tooltip` element. Read-only.
- `tooltip-data.mjs` pure tooltip model + HTML render (rarity tier, stats, excerpt, g/s/c price, slot compare); tested in `tests/tooltip-data.test.mjs`.
- Also `styles/`, `lang/en.json`.

## Key patterns
- Convert is opt-in code: `api.convertToPack`, not part of Build on main (v0.2.0 state).
- Stat-less items reflavour an official item of the same slot/rarity, copied at build time from the user's installed compendiums; the repo stores names only, never official text.
- Prices are stored as decimals in the largest coin; the 5e converter never raises ability scores.
- No feature registry, health check or update-notes card; settings are minimal.
- Writes (build, conversion) run from a GM-triggered action; do not add automatic hooks that write documents without an active-GM check.

## Branches
- `main` = released v0.2.0 plus docs. `v030-dev` = v0.3.0 prep (unmerged, unreleased): convert-on-build, incremental/resumable builds (`flags.loot-ledger.hash`), GM review pages, Build Report journal, `scripts/rules.mjs` (all tunable numbers), `scripts/replace-list.mjs`, `scripts/ledger.mjs` (pure bookkeeping), `tests/`, `tools/calibration-report.mjs`, `BOOK-DAY.md`. Do feature work for 0.3.0 there.
- `feat/item-tooltip` = 0.2.1 (item tooltip, test/lint setup), branched from main 83f9750, untested in Foundry. **It must later be merged into `v030-dev` too** (expect conflicts in `package.json`, `tests/`, `CHANGELOG.md`, `lang/en.json`, `main.mjs` settings and this file; keep both sides).

## Tests
- CI: `.github/workflows/test.yml` (push/PR to main; actions pinned by SHA) runs `npm install --no-package-lock --ignore-scripts` (eslint is the only dependency, no lockfile), `npm run check`, `npm run lint`, `npm test`. Keep it green; the release workflow is separate.
- `feat/item-tooltip` (0.2.1) adds `package.json`: `npm test` (`node --test tests/*.test.mjs`), `npm run check`, `npm run lint` (`eslint.config.mjs`, recommended rules inlined, no plugins). Only the tooltip's pure logic is tested; the DOM wiring needs a live world.
- On main before 0.2.1 there was no test suite. On `v030-dev`: `npm test` (`node --test tests/*.test.mjs`), `npm run check`, `npm run calibrate`; pure logic (data, rules, ledger, replace list, build planning) is tested in Node with fixtures; `build()` and compendium writes need a live Foundry world and are untested there.

## Release process
1. Bump `version` in `module.json` and the `download` URL (`.../releases/download/vX.Y.Z/module.zip`); manifest URL stays `.../releases/latest/download/module.json`.
2. Update `CHANGELOG.md`. Merge to main.
3. **Agents never tag or publish.** The user publishes the GitHub release; the Release workflow sets version/URLs and uploads `module.json` and `module.zip` (`module.json scripts styles lang README.md LICENSE`). A new top-level folder must be added to the zip step.

## Focus tagging (research)
Researched 2026-11-01 against dnd5e 6.1.0 (branch `6.1.x`, commit `0a247dd`, read-only; no code written). Permalinks are pinned to that commit (`https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/` = `https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/`).

- **Yes, there is a Focus item property.** It is the item property key `foc` ("Focus"), declared in `CONFIG.DND5E.itemProperties` ([`module/config.mjs` L1960-L1962](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/config.mjs#L1960-L1962)); label `DND5E.ITEM.Property.Focus` = "Focus" ([`lang/en.json` L3913](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/lang/en.json#L3913)).
- **Storage:** a plain string in the item's `system.properties` Set (`SetField(StringField)`), so an item is a focus when `item.system.properties.has("foc")`. There is no separate boolean or system field. Source data stores it as an array: `system.properties: ["foc"]` (e.g. [SRD Staff, `staff.yml` L79-L81](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/packs/_source/equipment24/adventuring-gear/spellcasting-focuses/arcane-focus/staff.yml#L79-L81), `["foc","ver"]`, a weapon-type staff; [`wand-of-web.yml` L58-L60](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/packs/_source/items/wand/wand-of-web.yml#L58-L60), `["foc","mgc"]`, equipment subtype `wand`). Schemas: [`equipment.mjs` L64](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/data/item/equipment.mjs#L64), [`weapon.mjs` L71](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/data/item/weapon.mjs#L71), [`tool.mjs` L59](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/data/item/tool.mjs#L59).
- **Item types that may carry it** (`CONFIG.DND5E.validProperties`, [`module/config.mjs` L2051-L2106](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/config.mjs#L2051-L2106)): **equipment** (L2063-L2068), **weapon** (L2076-L2094) and **tool** (L2102-L2105). Not valid for **loot** (L2073, only `mgc`), consumable (L2055, `mgc`), container (L2058), feat, spell or class. `validProperties` is applied by the sheet and the compendium browser filter ([`item-description.mjs` L38-L43](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/data/item/templates/item-description.mjs#L38-L43), [L95](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/data/item/templates/item-description.mjs#L95)); the data field itself is an unrestricted string set, so a script could store `foc` on a loot item, but the sheet would not show it and dnd5e does not support it (inference from the code, not tested). Ammo consumables gain only properties flagged `isPhysical` ([`consumable.mjs` L176-L185](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/data/item/consumable.mjs#L176-L185)); `foc` is not one.
- **No mechanics are driven by it.** Nothing in the system code reads `foc` other than config and the property filter (no spell component or casting check uses it); it is a tag shown on the item and filterable in the compendium browser. Equipment subtype does not matter (valid for any `equipment` type, `trinket` included).
- **Separate from the property:** `CONFIG.DND5E.focusTypes` (arcane / druidic / holy, each mapping to SRD 5.2 item UUIDs; [`module/config.mjs` L1825-L1853](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/config.mjs#L1825-L1853)) is only used by the starting-equipment "focus" choice ([`starting-equipment.mjs` L148-L151](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/module/data/item/templates/starting-equipment.mjs#L148-L151)). dnd5e's own SRD focus items are inconsistent: the Staff carries `foc`, but Crystal, Sprig of Mistletoe and Amulet are equipment type `trinket` with `properties: []` (e.g. [`crystal.yml` L47](https://github.com/foundryvtt/dnd5e/blob/0a247dd7d88d4646930ac140d73363282d25b24e/packs/_source/equipment24/adventuring-gear/spellcasting-focuses/arcane-focus/crystal.yml#L47)). In dnd5e's `items` pack source, 43 items have `foc`: 30 equipment (wands, rods and similar) and 13 weapons (staffs).
- **Implication for Loot Ledger:** to tag a converted item as a focus, add `"foc"` to `system.properties` on `equipment`, `weapon` or `tool` items only. Items that become `loot` cannot carry it, so a focus-like item (wand, staff, orb) must be converted to equipment/weapon, not loot. Do not store it as a flag.

## Rules
- Public repo: no campaign names, no game-publisher (WoW/Blizzard) wording beyond the required source-module name, no private details (IPs, domains, paths).
- No official non-SRD rules text anywhere (code, tests, fixtures, commits, issues); record conventions in your own words and numbers. SRD 5.2 is fine. Never use 5etools or other unofficial rules sites.
- Every option must be a setting that can be turned off; conversion is off by default.
- The README carries an unofficial fan-content disclaimer; keep it.
- Commit author `cocoomg11 <cocoomg11@users.noreply.github.com>`; end commit messages with the attribution trailers given by the session.
