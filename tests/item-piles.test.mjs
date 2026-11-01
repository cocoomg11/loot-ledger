import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ITEM_PILES_HOOKS, ROW_SELECTOR, rowMap, normName, normImg, matchRowItem, pileActorOf } from "../scripts/item-piles-model.mjs";

const item = (name, img, extra = {}) => ({ documentName: "Item", name, img, ...extra });

test("hook names are Item Piles' documented row hooks", () => {
  assert.deepEqual([...ITEM_PILES_HOOKS].sort(), [
    "item-piles-mouseHoverMerchantItem", "item-piles-mouseHoverPileItem", "item-piles-mouseHoverVaultGridItem",
    "item-piles-renderMerchantItem", "item-piles-renderPileItem", "item-piles-renderVaultGridItem"
  ]);
  assert.match(ROW_SELECTOR, /\.item-piles-item-row/);
});

test("rowMap remembers element → item and finds it from the row's chain", () => {
  const rows = rowMap();
  const row = {}, cell = {}, other = {};
  const sword = item("Sword", "icons/sword.webp");
  rows.remember(row, sword);
  rows.remember(other, { name: "not a document" });
  rows.remember(null, sword);
  assert.equal(rows.find([cell, row]), sword);
  assert.equal(rows.find([other]), null);
  assert.equal(rows.find([]), null);
  assert.equal(rows.find(undefined), null);
});

test("normName and normImg", () => {
  assert.equal(normName("  Linen   Cloth (3) "), "linen cloth");
  assert.equal(normName("Arrow (x20)"), "arrow");
  assert.equal(normName("Potion (Greater)"), "potion (greater)");
  assert.equal(normImg("https://host:30000/icons/a%20b.webp?v=2#x"), "icons/a b.webp");
  assert.equal(normImg("/icons/a.webp"), "icons/a.webp");
  assert.equal(normImg("icons/a.webp"), "icons/a.webp");
  assert.equal(normImg("%E0%A4%A"), "%E0%A4%A");
  assert.equal(normImg(null), "");
});

test("matchRowItem: name + image, then name, then image; only a single match", () => {
  const a = item("Sword", "icons/sword.webp");
  const b = item("Sword", "icons/sword-2.webp");
  const c = item("Shield", "icons/shield.webp");
  const d = item("Old Boot", "icons/boot.webp");
  const items = [a, b, c, d];
  assert.equal(matchRowItem(items, { name: "Sword", img: "http://x/icons/sword-2.webp" }), b);
  assert.equal(matchRowItem(items, { name: " shield (2)", img: "icons/other.webp" }), c);
  // Name shown differs (compendium item name), image matches one item.
  assert.equal(matchRowItem(items, { name: "Worn Boot", img: "/icons/boot.webp" }), d);
  // Two swords and no image match: ambiguous.
  assert.equal(matchRowItem(items, { name: "Sword", img: "icons/none.webp" }), null);
  // Exact duplicates cannot be told apart.
  assert.equal(matchRowItem([a, item("Sword", "icons/sword.webp")], { name: "Sword", img: "icons/sword.webp" }), null);
  assert.equal(matchRowItem(items, {}), null);
  assert.equal(matchRowItem(null, { name: "Sword" }), null);
});

test("pileActorOf reads inventory/vault `actor` and merchant `merchant`", () => {
  const actor = { items: [] };
  assert.equal(pileActorOf({ actor }), actor);
  assert.equal(pileActorOf({ merchant: actor }), actor);
  assert.equal(pileActorOf({ actor: { name: "no items" } }), null);
  assert.equal(pileActorOf(null), null);
});

test("tooltip wires the Item Piles hooks and resolves rows before the id lookup", () => {
  const src = readFileSync(new URL("../scripts/tooltip.mjs", import.meta.url), "utf8");
  assert.match(src, /ITEM_PILES_HOOKS\.map\(name => \[name, Hooks\.on\(name/);
  assert.match(src, /Hooks\.off\(name, id\)/);
  assert.match(src, /\.\.\.UI_CLASSES/);
  assert.ok(!/wc-r\d/.test(src), "no literal stylesheet revision");
});
