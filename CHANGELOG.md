# Changelog

## 0.2.3 (2026-11-01)

- Fix: tooltip prices were wrong in a world whose currency conversions differ from the **Coin ratio** setting (for example a
  100:1 three-coin world with the setting at 10:1: 2 sp showed "2c", 1 cp showed nothing, 15 sp showed "1s 5c"). The price
  mixed the world's conversions with the setting. It now reads the ratio from the world's own conversions (sp 10 or 100, cp the
  square) and uses the setting only when the world has no usable conversions. Worlds where both agree are unchanged.
  (Prices written into items at build time are not affected: they are stored as a value and a denomination.)

### Untested in Foundry
- In a 100:1 world with the setting at 10:1, an item priced 2 sp shows "2s", 1 cp shows "1c", 15 sp shows "15s", 123 cp shows
  "1s 23c"; in a standard 10:1 world they show "2s", "1c", "1g 5s", "1g 2s 3c".

## 0.2.2 (2026-11-01)

- Fix: the Shift item tooltip now works in **Item Piles** windows (item piles, merchants, vaults; checked against Item Piles
  3.3.4 source). Their rows carry no item id, so the item comes from Item Piles' own documented row hooks
  (`item-piles-renderPileItem` / `-renderMerchantItem` / `-renderVaultGridItem` and the matching hover hooks, which pass the row
  element and its item). For a row drawn before the tooltip was turned on, the window's pile or merchant actor is searched by the
  row's shown name and image (name and image, then name, then image; only a single match is used, so two identical items in one
  pile show nothing).
- Shared look: the module now vendors **wanderers-core 0.5.0** (`vendor/wanderers-core/`, pinned by `wanderers-core.lock.json`).
  The tooltip's rarity colours are core's item quality tokens (`--wc-q-*`, via core `quality()`), and prices are written by core's
  `formatCoins` using the module's *Coin ratio* setting (100:1 or 10:1). The tooltip keeps its own dark in-world surface; quality
  colours are darkened on the light theme by core.
- Dev: CI and the Release workflow check the vendored core against its pin (`vendor.mjs verify --remote`); the release zip
  includes `vendor/` without core's dev-only `config/`, `vendor.mjs` and `testing/`. ESLint skips `vendor/`. New tests in
  `tests/item-piles.test.mjs`.

**Untested in Foundry** (Node tests only):

- Item Piles pile, merchant and vault windows: Shift-hover shows the right item; the hooks fill the row map (merchant rows use
  `display: contents`, so hovering any cell should find the row); the name/image fallback after turning the tooltip on with a
  window already open; the trading window (rows without hooks, not expected to resolve).
- Core stylesheet loads first (`module.json` styles) and the tooltip's quality colours in the dark and light themes, including
  common (near-white on dark, grey on light).
- Prices with the 10:1 coin ratio in a standard-currency world, and with 100:1.
- Turning the tooltip off removes the Item Piles hook listeners.

## 0.2.1 (2026-11-01)

**Untested in Foundry**: written and unit-tested in Node only; not yet run in a live world.

- New: optional item tooltip (client setting *Item tooltip (hold Shift)*, off by default). Hold Shift while hovering a dnd5e
  item on actor sheets, the Items sidebar, compendium windows and browser, or chat item cards to see its rarity-coloured name,
  type and slot, damage / AC / properties, magical bonus, attunement, charges, a short description excerpt, price in g/s/c,
  weight, and a comparison (↑/↓) with your character's equipped item in the same slot. Read-only.
- Dev: `package.json` with `npm test` (`node --test`), `npm run check` and `npm run lint` (ESLint flat config, no plugins);
  tests for the tooltip's pure logic in `tests/tooltip-data.test.mjs`.
- Removed an unused variable in the converter (no behaviour change).

## 0.2.0 (2026-10-30)

- Released before this changelog existed; see the GitHub release notes.
