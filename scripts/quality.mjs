/**
 * Quality colours: item names in their quality colour on actor sheets, item sheets, chat cards, content links,
 * roll tables and Item Piles windows, plus a GM "Quality" picker on item sheets, a "Set quality" context-menu
 * entry and api.setQuality(). Everything runs from render hooks (no per-frame work). Registered only when the
 * "Quality colours" setting is on.
 */
import { MODULE_ID } from "./data.mjs";
import * as Q from "./quality-model.mjs";

const fallbackOn = () => !!game.settings.get(MODULE_ID, "qualityRarityFallback");
const qualityOf = item => Q.resolveQuality(item, { rarityFallback: fallbackOn(), moduleId: MODULE_ID });

/** Put the quality class on an element (removing any stale one). */
function paint(el, item) {
  if (!el) return;
  el.classList.remove(...Q.ALL_CLASSES);
  const cls = Q.qualityClass(qualityOf(item));
  if (cls) el.classList.add(...cls.split(" "));
}

/** Synchronous lookup of an item (or compendium index entry) from a UUID, without loading documents. */
function itemFromUuid(uuid) {
  if (!uuid) return null;
  try {
    const doc = fromUuidSync(uuid, { strict: false });
    if (!doc) return null;
    if (doc.documentName && doc.documentName !== "Item") return null;
    if (!doc.documentName && !/\.Item\.[^.]+$/.test(uuid)) return null;
    return doc;
  } catch { return null; }
}

/** Colour every content link to an item inside `root`. */
function paintLinks(root) {
  for (const a of root.querySelectorAll?.("a.content-link[data-uuid]") ?? []) {
    const type = a.dataset.type;
    if (type && type !== "Item") continue;
    const item = itemFromUuid(a.dataset.uuid);
    if (item) paint(a, item);
  }
}

/* ---------------- sheets ---------------- */

/** dnd5e 6 actor sheet inventory rows: <li class="item" data-item-id> ... <span class="title">name</span>. */
function onRenderActorSheet(app, element) {
  const actor = app.document ?? app.actor;
  if (!actor?.items) return;
  for (const row of element.querySelectorAll("[data-item-id]")) {
    const item = actor.items.get(row.dataset.itemId);
    if (!item) continue;
    paint(row.querySelector(".item-name .title, .item-name .name, .item-name h4, .name .title") ?? null, item);
  }
  paintLinks(element);
}

/** Item sheet: colour the title and (GM) add the quality picker under the name. */
function onRenderItemSheet(app, element) {
  const item = app.document ?? app.item;
  if (!(item instanceof Item)) return;
  const name = element.querySelector(".sheet-header .document-name") ?? element.querySelector(".document-name");
  paint(name, item);
  paintLinks(element);
  if (!game.user.isGM || !game.settings.get(MODULE_ID, "qualityPicker")) return;
  const host = element.querySelector(".sheet-header .identity-info") ?? element.querySelector(".sheet-header");
  if (!host || host.querySelector(".loot-ledger-quality-picker")) return;
  const current = Q.normalizeQuality(item.getFlag(MODULE_ID, "quality")) ?? "";
  const wrap = document.createElement("div");
  wrap.className = "loot-ledger-quality-picker";
  wrap.innerHTML = `<label>Quality <select>
      <option value="">${fallbackOn() ? "Auto (from rarity)" : "None"}</option>
      ${Q.COLOUR_QUALITIES.map(q => `<option value="${q.key}" class="ll-q ll-q-${q.key}"${q.key === current ? " selected" : ""}>${q.label}</option>`).join("")}
    </select></label>`;
  const select = wrap.querySelector("select");
  select.addEventListener("change", ev => {
    ev.stopPropagation();
    setQuality([item], select.value || null);
  });
  // keep the sheet's own form from treating the select as an item field
  select.removeAttribute("name");
  host.append(wrap);
}

/* ---------------- chat, journals, tables ---------------- */

/** Chat: dnd5e item cards (<div class="item-icon" data-uuid> + <span class="title">) and content links. */
function onRenderChatMessage(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const header of root.querySelectorAll(".card-header")) {
    const uuid = header.querySelector("[data-uuid]")?.dataset.uuid;
    const item = itemFromUuid(uuid);
    if (item) paint(header.querySelector(".title"), item);
  }
  paintLinks(root);
}

/** Any rendered application with content links (journals, roll tables, the sidebar's journal pages). */
function onRenderAnyLinks(app, element) {
  if (element instanceof HTMLElement) paintLinks(element);
}

/** Roll table sheet: document results are listed by name; colour those that point at items. */
function onRenderRollTableSheet(app, element) {
  const table = app.document;
  if (!table?.results) return;
  for (const row of element.querySelectorAll("[data-result-id]")) {
    const r = table.results.get(row.dataset.resultId);
    const uuid = r?.documentUuid;
    if (!uuid || !/\.Item\./.test(uuid) && !uuid.startsWith("Item.")) continue;
    const item = itemFromUuid(uuid);
    if (!item) continue;
    const target = row.querySelector("a.content-link, .result-name, .name, input[name$='.name'], .result-text") ?? null;
    paint(target, item);
  }
  paintLinks(element);
}

/** Sidebar Items directory and compendium windows: colour entry names (cheap: index data only). */
function onRenderDirectory(app, element) {
  const coll = app.collection;
  if (!coll || coll.documentName !== "Item") return;
  for (const li of element.querySelectorAll("[data-entry-id]")) {
    const doc = coll.get?.(li.dataset.entryId) ?? coll.index?.get?.(li.dataset.entryId);
    if (!doc) continue;
    paint(li.querySelector(".entry-name, .document-name, a") ?? null, doc);
  }
}

/* ---------------- Item Piles ---------------- */

/**
 * Item Piles windows (pile, merchant, vault) are Svelte apps that render item names in `.item-piles-name` blocks
 * and re-render rows themselves, so a MutationObserver on that one window colours rows as they appear. It is
 * disconnected when the window closes.
 */
function onItemPilesOpen(app, actor) {
  const owner = actor ?? app?.actor ?? app?.merchant;
  if (!owner?.items) return;
  const byName = () => {
    const m = new Map();
    for (const i of owner.items) if (!m.has(i.name)) m.set(i.name, i);
    return m;
  };
  const scan = root => {
    const items = byName();
    for (const box of root.querySelectorAll(".item-piles-name-container")) {
      const target = box.querySelector("a.item-piles-clickable, p, span") ?? box;
      const name = target.textContent.trim();
      const item = items.get(name);
      if (item) paint(target, item);
    }
    for (const cell of root.querySelectorAll(".grid-item[data-fast-tooltip]")) {
      const item = items.get(cell.dataset.fastTooltip);
      if (item) paint(cell, item);
    }
  };
  let tries = 0;
  const attach = () => {
    const el = app?.element?.[0] ?? app?.element;
    if (!(el instanceof HTMLElement)) { if (tries++ < 20) setTimeout(attach, 100); return; }
    scan(el);
    let queued = false;
    const obs = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; scan(el); });
    });
    obs.observe(el, { childList: true, subtree: true });
    app._llQualityObserver = obs;
  };
  attach();
}

function onItemPilesClose(app) {
  app?._llQualityObserver?.disconnect();
  if (app) app._llQualityObserver = null;
}

/* ---------------- setting the quality ---------------- */

/**
 * Set (or clear, with null) the quality of one or more items: flags["loot-ledger"].quality. GM only.
 * Works on world items, embedded items and compendium items (the compendium must be unlocked).
 * @param {Item|Item[]|string|string[]} items  documents or UUIDs
 * @param {string|null} quality  poor | common | uncommon | rare | epic | legendary | artifact | heirloom, or null
 * @returns {Promise<number>} how many items were updated
 */
export async function setQuality(items, quality) {
  if (!game.user.isGM) throw new Error("Loot Ledger: only a GM can set item quality.");
  const update = Q.qualityUpdate(quality, MODULE_ID);
  const list = Array.isArray(items) ? items : [items];
  let n = 0;
  for (const ref of list) {
    const item = typeof ref === "string" ? await fromUuid(ref) : ref;
    if (!(item instanceof Item)) continue;
    if (item.pack && game.packs.get(item.pack)?.locked) {
      ui.notifications.warn(`Loot Ledger: ${game.packs.get(item.pack).title} is locked; unlock it to set quality.`);
      continue;
    }
    await item.update(update);
    n++;
  }
  return n;
}

/** The dialog behind the "Set quality" context-menu entry. Returns the chosen key, "" to clear, or null (cancelled). */
async function askQuality(count, current = "") {
  const { DialogV2 } = foundry.applications.api;
  const opts = [`<option value="">${fallbackOn() ? "Auto (from rarity)" : "None"}</option>`,
    ...Q.COLOUR_QUALITIES.map(q => `<option value="${q.key}" class="ll-q ll-q-${q.key}"${q.key === current ? " selected" : ""}>${q.label}</option>`)].join("");
  return DialogV2.wait({
    window: { title: "Loot Ledger: set quality" },
    content: `<p>${count > 1 ? `${count} selected items` : "This item"}: pick the quality colour. An explicit quality always wins over the rarity colour.</p>
      <div class="form-group"><label>Quality</label><select name="quality">${opts}</select></div>`,
    buttons: [
      { action: "ok", label: "Set", icon: "fa-solid fa-check", default: true, callback: (event, button) => button.form.elements.quality.value },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  }).then(v => (v === "cancel" ? null : v));
}

/** Selected entry ids in a directory / compendium window (core may mark them .selected), else just the clicked one. */
function selectedIds(app, li) {
  const id = li.dataset.entryId;
  const root = app.element instanceof HTMLElement ? app.element : li.closest(".directory, .compendium");
  const sel = [...(root?.querySelectorAll("[data-entry-id].selected") ?? [])].map(e => e.dataset.entryId);
  return sel.includes(id) ? sel : [id];
}

/** "Set quality" in the Items sidebar and Item compendium context menus (core hook getItemContextOptions). */
function onItemContextOptions(app, entries) {
  if (!game.user.isGM || !game.settings.get(MODULE_ID, "qualityPicker")) return;
  const coll = app.collection;
  if (coll && coll.documentName && coll.documentName !== "Item") return;
  const run = async li => {
    const ids = selectedIds(app, li);
    const pack = coll instanceof foundry.documents.collections.CompendiumCollection ? coll : null;
    const docs = (await Promise.all(ids.map(id => pack ? pack.getDocument(id) : game.items.get(id)))).filter(Boolean);
    if (!docs.length) return;
    const current = docs.length === 1 ? (Q.normalizeQuality(docs[0].getFlag(MODULE_ID, "quality")) ?? "") : "";
    const choice = await askQuality(docs.length, current);
    if (choice === null || choice === undefined) return;
    const n = await setQuality(docs, choice || null);
    if (n) ui.notifications.info(`Loot Ledger: quality ${choice || "cleared"} on ${n} item${n === 1 ? "" : "s"}.`);
  };
  // v14 entries: {label, icon (classes), visible(li), onClick(event, li)}; v13: {name, icon (HTML), condition(li), callback(li)}.
  if ((game.release?.generation ?? 13) >= 14) {
    entries.push({ label: "Set quality", icon: "fa-solid fa-palette", group: "system", visible: () => game.user.isGM, onClick: (event, li) => run(li) });
  } else {
    entries.push({ name: "Set quality", icon: '<i class="fa-solid fa-palette"></i>', group: "system", condition: () => game.user.isGM, callback: li => run(li instanceof HTMLElement ? li : li?.[0]) });
  }
}

/** Re-render open views of an item after its quality changed (sheets re-render themselves; refresh directories). */
function onUpdateItem(item, change) {
  if (!foundry.utils.hasProperty(change, `flags.${MODULE_ID}`)) return;
  if (item.pack) game.packs.get(item.pack)?.apps?.forEach(a => a.rendered && a.render());
  else if (!item.parent) ui.items?.render();
}

/** Register everything (called only when the "Quality colours" setting is on). */
export function registerQualityColours() {
  // Index the fields the colours need, so directory and compendium entries colour without loading documents.
  const fields = CONFIG.Item.compendiumIndexFields;
  for (const f of [`flags.${MODULE_ID}.quality`, "system.rarity", "system.rarities"]) if (!fields.includes(f)) fields.push(f);
  Hooks.on("renderActorSheetV2", onRenderActorSheet);
  Hooks.on("renderItemSheetV2", onRenderItemSheet);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("renderJournalEntrySheet", onRenderAnyLinks);
  Hooks.on("renderJournalEntryPageSheet", onRenderAnyLinks);
  Hooks.on("renderRollTableSheet", onRenderRollTableSheet);
  Hooks.on("renderItemDirectory", onRenderDirectory);
  Hooks.on("renderCompendium", onRenderDirectory);
  Hooks.on("getItemContextOptions", onItemContextOptions);
  Hooks.on("updateItem", onUpdateItem);
  if (game.modules.get("item-piles")?.active) {
    Hooks.on("item-piles-openInterface", onItemPilesOpen);
    Hooks.on("item-piles-closeInterface", onItemPilesClose);
  }
}
