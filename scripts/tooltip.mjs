/**
 * Item tooltip (opt-in client setting `itemTooltip`, off by default): while the setting is on and Shift is held, hovering a
 * dnd5e item anywhere it is shown (actor sheets, the Items sidebar, compendium windows and the dnd5e compendium browser, chat
 * item cards, item content links) shows an MMO-style tooltip with rarity colour, stats, price, weight and a comparison with the
 * hovering user's equipped item in the same slot.
 *
 * One document-level listener set finds the hovered item from its element's data attributes, so no sheet is patched and
 * nothing is written. Item Piles rows carry no ids: their items come from Item Piles' own row hooks, else from the window's pile
 * actor by shown name and image (item-piles-model.mjs). The tooltip is a single fixed-position element outside every application (no layout shift); it ignores
 * the pointer and never takes focus. Model and HTML come from tooltip-data.mjs (pure, tested in Node).
 */
import { MODULE_ID } from "./data.mjs";
import { TOOLTIP_TYPES, buildModel, renderModel, equippedInSlot } from "./tooltip-data.mjs";
import { ITEM_PILES_HOOKS, ROW_SELECTOR, APP_SELECTOR, rowMap, matchRowItem, pileActorOf } from "./item-piles-model.mjs";
import { UI_CLASSES } from "../vendor/wanderers-core/index.mjs";

export const SETTING = "itemTooltip";

/** @type {HTMLElement|null} */
let tip = null;
/** Element under the pointer and last pointer position. */
let hovered = null;
let pointer = { x: 0, y: 0 };
let shown = null; // element the tooltip currently describes
let token = 0; // invalidates stale async lookups
let frame = 0;
let enabled = false;
const ITEM_SELECTOR = `[data-item-uuid], [data-uuid], [data-item-id], .directory-item[data-entry-id], .chat-message .card-header, .chat-message .item-name, ${ROW_SELECTOR}`;
/** Item Piles row element → item, from its hooks (registered while the tooltip is on). */
const pileRows = rowMap();
/** @type {Array<[string, number]>} */
let pileHookIds = [];

/** Create (once) the tooltip element. */
function element() {
  if (tip?.isConnected) return tip;
  tip = document.createElement("aside");
  tip.id = "loot-ledger-tooltip";
  // Core's root classes give the tooltip the shared quality tokens (--wc-q-*) and coin styles; its own CSS keeps the in-world look.
  tip.className = ["loot-ledger-tooltip", ...UI_CLASSES].join(" ");
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("aria-hidden", "true");
  document.body.append(tip);
  return tip;
}

/** The ApplicationV2 (or v1) instance that owns an element. */
function appFor(el) {
  const root = el.closest(".application, .app, .item-piles-app");
  if (!root) return null;
  const v2 = foundry.applications?.instances?.get?.(root.id);
  if (v2) return v2;
  const appId = root.dataset.appid;
  return appId ? (ui.windows?.[appId] ?? null) : null;
}

/** The element and its ancestors up to (and including) `stop`, nearest first. */
function chainTo(el, stop) {
  const out = [];
  for (let n = el; n; n = n.parentElement) {
    out.push(n);
    if (n === stop) break;
  }
  return out;
}

/** The item behind an Item Piles row: the hook map first, else the window's pile actor matched by shown name and image. */
function pileItem(row) {
  const fromHook = pileRows.find(chainTo(row, row.closest(".item-piles-item-row, .grid-item") ?? row));
  if (fromHook) return fromHook;
  const root = row.closest(APP_SELECTOR);
  const actor = pileActorOf(root ? appFor(root) : null);
  if (!actor) return null;
  const name = row.querySelector("a.item-piles-clickable, .item-piles-name-container p, .item-piles-name-container span")?.textContent
    ?? row.getAttribute("data-fast-tooltip") ?? "";
  const img = row.querySelector("img.item-piles-img, img.grid-item-image, img")?.getAttribute("src") ?? "";
  return matchRowItem(actor.items, { name, img });
}

/** Item Piles' merchant rows use `display: contents`, so the hovered cell may sit beside the row's other cells: find the row. */
function pileRowOf(target) {
  return target.closest(ROW_SELECTOR);
}

/** Resolve the item a hovered element stands for. @returns {Promise<Item|null>} */
async function resolveItem(target) {
  const row = target.closest(APP_SELECTOR) ? pileRowOf(target) : null;
  if (row) return pileItem(row);
  // Chat cards: the message knows its item even after the original is deleted.
  const msgEl = target.closest(".chat-message[data-message-id]");
  if (msgEl && target.closest(".card-header, .item-name, .item-icon")) {
    const msg = game.messages?.get(msgEl.dataset.messageId);
    const item = msg?.getAssociatedItem?.() ?? null;
    if (item) return item;
  }
  const el = target.closest("[data-item-uuid], [data-uuid], [data-item-id], .directory-item[data-entry-id]");
  if (!el) return null;
  const uuid = el.dataset.itemUuid ?? el.dataset.uuid;
  if (uuid) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (doc?.documentName === "Item") return doc;
    // dnd5e activity rows carry the activity uuid; its item is the parent.
    if (doc?.item?.documentName === "Item") return doc.item;
    return null;
  }
  const id = el.dataset.itemId ?? el.dataset.entryId;
  const app = appFor(el);
  const fromActor = app?.document?.items?.get?.(id) ?? app?.actor?.items?.get?.(id);
  if (fromActor) return fromActor;
  const collection = app?.collection;
  if (collection?.documentName === "Item") {
    if (typeof collection.getDocument === "function") return (await collection.getDocument(id).catch(() => null)) ?? null;
    return collection.get?.(id) ?? null;
  }
  if (el.closest("#items, .items-sidebar")) return game.items?.get(id) ?? null;
  return null;
}

/** The hovering user's character: an owned, controlled token's actor first, then the assigned character. */
function viewerActor() {
  const controlled = canvas?.tokens?.controlled?.find(t => t.actor?.isOwner)?.actor;
  return controlled ?? game.user?.character ?? null;
}

/** Light or dark, from the nearest themed ancestor, then the body / interface setting. */
function themeFor(el) {
  const themed = el.closest(".theme-light, .theme-dark");
  if (themed) return themed.classList.contains("theme-light") ? "light" : "dark";
  return document.body.classList.contains("theme-light") ? "light" : "dark";
}

function hide() {
  token++;
  shown = null;
  if (!tip) return;
  tip.classList.remove("active");
  tip.setAttribute("aria-hidden", "true");
}

/** Keep the tooltip inside the viewport, beside the pointer. */
function place() {
  frame = 0;
  if (!tip || !shown) return;
  // Foundry's own tooltip may activate after its hover delay; keep only one visible.
  if (game.tooltip?.tooltip?.classList?.contains("active")) game.tooltip.deactivate();
  const pad = 16, w = tip.offsetWidth, h = tip.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = pointer.x + pad, y = pointer.y + pad;
  if (x + w > vw - 4) x = Math.max(4, pointer.x - pad - w);
  if (y + h > vh - 4) y = Math.max(4, vh - 4 - h);
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function schedulePlace() {
  if (!frame) frame = requestAnimationFrame(place);
}

/** Show the tooltip for an element if it is an item. */
async function show(target) {
  const mine = ++token;
  const item = await resolveItem(target);
  if (mine !== token || !enabled) return;
  // Every hooked place already lists only items the user may see, so no extra permission check; unidentified items are masked in buildModel.
  if (!item || !TOOLTIP_TYPES.has(item.type)) return hide();
  const actor = viewerActor();
  const equipped = actor ? equippedInSlot(item, actor.items) : null;
  const ratio = (() => { try { return game.settings.get(MODULE_ID, "coinRatio"); } catch { return "100"; } })();
  const t = key => game.i18n.localize(key);
  const model = buildModel(item, { dnd5e: CONFIG.DND5E, t, ratio, isGM: game.user.isGM, equipped });
  const el = element();
  el.innerHTML = renderModel(model, t);
  el.classList.toggle("theme-light", themeFor(target) === "light");
  el.classList.toggle("theme-dark", themeFor(target) !== "light");
  shown = target;
  game.tooltip?.deactivate?.();
  el.classList.add("active");
  el.setAttribute("aria-hidden", "false");
  place();
}

function itemTarget(node) {
  return node instanceof Element ? node.closest(ITEM_SELECTOR) : null;
}

function onPointerOver(event) {
  hovered = itemTarget(event.target);
  pointer = { x: event.clientX, y: event.clientY };
  if (!event.shiftKey || !hovered) return hide();
  if (hovered !== shown) show(hovered);
}

function onPointerMove(event) {
  pointer = { x: event.clientX, y: event.clientY };
  if (shown) {
    if (!event.shiftKey) return hide();
    schedulePlace();
  }
}

function onKeyDown(event) {
  if (event.key !== "Shift" || event.repeat) return;
  if (hovered?.isConnected && hovered !== shown) show(hovered);
}

function onKeyUp(event) {
  if (event.key === "Shift") hide();
}

const LISTENERS = [
  [document, "pointerover", onPointerOver],
  [document, "pointermove", onPointerMove],
  [document, "pointerdown", hide],
  [document, "keydown", onKeyDown],
  [document, "keyup", onKeyUp],
  [window, "blur", hide],
  [document, "wheel", hide]
];

/** Turn the listeners on or off to match the setting. */
export function setTooltipEnabled(on) {
  on = !!on;
  if (on === enabled) return;
  enabled = on;
  for (const [target, type, fn] of LISTENERS) {
    if (on) target.addEventListener(type, fn, { passive: true, capture: type !== "pointerover" });
    else target.removeEventListener(type, fn, { capture: type !== "pointerover" });
  }
  if (on) pileHookIds = ITEM_PILES_HOOKS.map(name => [name, Hooks.on(name, (element, item) => pileRows.remember(element, item))]);
  else {
    for (const [name, id] of pileHookIds) Hooks.off(name, id);
    pileHookIds = [];
    hide(); tip?.remove(); tip = null; hovered = null;
  }
}

/** Register the client setting (called from init). */
export function registerTooltipSetting() {
  game.settings.register(MODULE_ID, SETTING, {
    name: "LOOTLEDGER.Settings.Tooltip.Name",
    hint: "LOOTLEDGER.Settings.Tooltip.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: value => setTooltipEnabled(value)
  });
}
