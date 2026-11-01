/**
 * Item Piles rows → items, pure (no Foundry globals; tested in Node, tests/item-piles.test.mjs).
 *
 * Item Piles (checked against 3.3.4) draws its pile, merchant and vault rows with Svelte. The rows carry no item id or uuid
 * (`.item-piles-item-row`, the name link `a.item-piles-clickable`, vault cells `.grid-item`), but Item Piles fires documented
 * hooks with the row element and its item document: `item-piles-renderPileItem` / `-renderMerchantItem` /
 * `-renderVaultGridItem` when a row is drawn (and again when its item changes), and `item-piles-mouseHover*Item` on hover.
 * `rowMap()` keeps that element → item link (weakly, so closed windows are dropped), which gives the exact item.
 *
 * Fallback (a row drawn before the tooltip was turned on, or a later Item Piles that stops firing the hooks): the window's pile
 * actor (`app.actor` / `app.merchant`) and the row's shown name and image are matched against the actor's items
 * (`matchRowItem`). Item Piles may show the name and image of a matching compendium item instead of the item's own, and a
 * merchant name can carry " (N)" for price bundles, so the match is: name and image → name only → image only, each only when
 * it picks exactly one item. Two items with the same name and image cannot be told apart; then nothing is shown.
 */

/** Hooks Item Piles fires with `(element, item)`. */
export const ITEM_PILES_HOOKS = Object.freeze([
  "item-piles-renderPileItem", "item-piles-mouseHoverPileItem",
  "item-piles-renderMerchantItem", "item-piles-mouseHoverMerchantItem",
  "item-piles-renderVaultGridItem", "item-piles-mouseHoverVaultGridItem"
]);

/** A hovered element inside one of these is an Item Piles item row (or vault cell). */
export const ROW_SELECTOR = ".item-piles-item-row, .item-piles-merchant-item-container, .grid-item";

/** Window root of an Item Piles interface (its v1 Svelte apps carry `item-piles-app`). */
export const APP_SELECTOR = ".item-piles-app, .item-piles";

/** Element → item, filled from the hooks. WeakMap: a removed row and its item are forgotten with it. */
export function rowMap() {
  const map = new WeakMap();
  return {
    /** Remember a hook's `(element, item)`; ignores anything that is not an element and an Item. */
    remember(element, item) {
      if (element && typeof element === "object" && item && typeof item === "object" && item.documentName === "Item") map.set(element, item);
    },
    /** The item for the first remembered element in `chain` (the row and its ancestors, nearest first), or null. */
    find(chain) {
      for (const el of chain ?? []) {
        const item = el ? map.get(el) : undefined;
        if (item) return item;
      }
      return null;
    }
  };
}

/** Lower-case, trimmed, whitespace collapsed; drops a trailing " (N)" or "(xN)" count. */
export function normName(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().replace(/\s*\(x?\d+\)$/i, "").toLowerCase();
}

/** An image path without origin, query or hash, decoded, for comparing `img.src` with `item.img`. */
export function normImg(src) {
  let s = String(src ?? "").trim();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/^\/+/, "");
  try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  return s;
}

/**
 * The item a row stands for, from the pile actor's items and what the row shows.
 * @param {Iterable<{name?:string, img?:string}>} items  the pile / merchant / vault actor's items
 * @param {{name?:string, img?:string}} row               the row's shown name and image src
 * @returns {object|null} the single match, or null when none or more than one
 */
export function matchRowItem(items, { name = "", img = "" } = {}) {
  const list = [...(items ?? [])].filter(Boolean);
  const n = normName(name), i = normImg(img);
  const one = arr => (arr.length === 1 ? arr[0] : null);
  const byName = n ? list.filter(it => normName(it.name) === n) : [];
  const byImg = i ? list.filter(it => normImg(it.img) === i) : [];
  if (n && i) {
    const both = byName.filter(it => normImg(it.img) === i);
    if (both.length) return one(both);
  }
  return one(byName) ?? (byName.length ? null : one(byImg));
}

/** The pile actor of an Item Piles window instance (inventory and vault: `actor`; merchant: `merchant`). */
export function pileActorOf(app) {
  const a = app?.actor ?? app?.merchant ?? null;
  return a?.items ? a : null;
}
