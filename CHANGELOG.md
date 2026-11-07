# Changelog

## 0.2.5 (2026-11-07)

Security and speed. Nothing to do after updating.

- **The API is GM only where it matters.** `build`, `convertToPack`, `roll`, `findTable` and `auditHandAuthored` on
  `game.modules.get("loot-ledger").api` now check for a GM when called: on a player's client they show a warning and return
  `undefined` without doing anything. The pure helpers (`convert`, `sellPrice`, `bandForLevel`, `formatCoins`) and the constant
  lists stay open to everyone.
- **Faster conversion.** `convertToPack` reads each official and SRD compendium's index once per run instead of once per item.
- **Faster table lookups.** `roll` / `findTable` keep the tables compendium's index between calls; it is read again after any
  roll table is created, changed or deleted.
- Under the hood: new `scripts/gm.mjs` (`gateApi`), `GM_ONLY` list in `api.mjs`, lang key `LOOTLEDGER.Notice.GmOnly`, tests in
  `tests/api-gate.test.mjs`. The Release workflow now has a read-only build job and a separate upload job (the only one that can
  write), with every action pinned by commit SHA.

### Untested in Foundry
- [ ] As a player, in the console: `game.modules.get("loot-ledger").api.roll({ level: 5 })` shows "Loot Ledger: only a GM can do
  that." and returns `undefined`; the same for `build()`, `convertToPack()`, `findTable()`, `auditHandAuthored(item)`.
  `api.sellPrice(item)` and `api.formatCoins(150)` still work for the player.
- [ ] As a GM: `api.roll({ level: 5, chat: true })` still draws to chat; a second roll right after is quick (no new index read).
- [ ] As a GM: Build loot pools, then `api.roll(...)` immediately afterwards finds the new tables (the cache was cleared by the
  rebuild). Edit one table, roll from it again: works.
- [ ] As a GM: `api.convertToPack({ names: [...a few reflavoured items...] })` still links the official/SRD base items; the run is
  no slower with many items.

## 0.2.4 (2026-11-01)

- Fix: the tooltip description no longer repeats the price. A trailing "Sell Price: ..." line from the item's own text is left
  out of the tooltip (display only; the item is not changed). The footer still shows Price and Sells for.
- Fix: chest armour now compares with what the character wears on the body. Armour of any weight, natural armour and clothing
  count as one body slot, and so do items flagged as Chest, so a cloth vest compares with equipped leather armour or clothes.
  Items flagged Finger compare with rings. Other slots (head, legs, trinket and so on) still compare only within their own slot.
- Fix: for players, price and sells-for are hidden on unidentified items, like the stats. GMs still see them.
- New: a one-time hint. Players who have the item tooltip off get a notification, once per browser, saying it exists and where
  to turn it on (Configure Settings, hold Shift). A new world setting, **Tell players about the item tooltip** (on by default),
  switches the hint off. The tooltip itself stays off by default and is never turned on for anyone.

### Untested in Foundry
- Everything here is covered by Node tests only. In a world: the Thick Cloth Vest tooltip shows a comparison with equipped
  Leather Armor and with Clothes; a description ending "Sell Price: 1s" no longer shows it; an unidentified item shows no
  price to a player; a player with the tooltip off sees the notification once after loading, and not again after a reload.

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
