/**
 * Review board: a GM-only window for working through converted items that need GM review.
 * Reads the converted items compendium; every decision is written to the item itself as
 * flags["loot-ledger"].review = {status, note, by, at} (see review-model.mjs for the rules).
 */
import { MODULE_ID, QUALITIES, CATEGORIES } from "./data.mjs";
import { CONVERTED_PACK } from "./build.mjs";
import * as R from "./review-model.mjs";
import * as Q from "./quality-model.mjs";

const { ApplicationV2 } = foundry.applications.api;
const esc = R.esc;
const LIST_LIMIT = 300;
const STATUS_LABEL = { pending: "Pending", accepted: "Accepted", tweaked: "Tweaked", skipped: "Skipped", rejected: "Rejected" };

/** The converted pack, or null. */
function convertedPack() {
  return game.packs.get(`world.${CONVERTED_PACK.name}`) ?? null;
}

export class ReviewBoard extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "loot-ledger-review-board",
    classes: ["loot-ledger", "loot-ledger-review-board"],
    tag: "div",
    window: { title: "Loot Ledger: Review board", icon: "fa-solid fa-clipboard-check", resizable: true },
    position: { width: 980, height: 720 },
    actions: {
      pick: ReviewBoard.#onPick,
      accept() { this.decide("accept"); },
      tweak() { this.tweak(); },
      skip() { this.decide("skip"); },
      reject() { this.decide("reject"); },
      reset() { this.decide("reset"); },
      prev() { this.step(-1); },
      next() { this.step(1); },
      reload() { this.load(true); },
      open() { this.openSheet(); }
    }
  };

  /** The open board (one per client). */
  static instance = null;

  /** Open (or focus) the board. GM only. */
  static async open() {
    if (!game.user.isGM) {
      ui.notifications.warn("Loot Ledger: the review board is for GMs.");
      return null;
    }
    if (!convertedPack()) {
      ui.notifications.warn(`Loot Ledger: no ${CONVERTED_PACK.label} compendium yet. Turn on "Convert items to 5e when building" and build first.`);
      return null;
    }
    ReviewBoard.instance ??= new ReviewBoard();
    await ReviewBoard.instance.render({ force: true });
    ReviewBoard.instance.bringToFront?.();
    return ReviewBoard.instance;
  }

  entries = null;          // all board entries (boardEntry rows)
  current = null;          // id of the item shown
  view = null;             // itemView() of the current item
  filters = { status: "todo", quality: "", category: "", slot: "", reason: "", search: "" };
  #tweakHook = null;

  /** Read the converted pack index (once, or again with `force`). */
  async load(force = false) {
    if (this.entries && !force) return;
    const pack = convertedPack();
    const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}`, "img"] });
    const rows = [];
    for (const e of index) {
      const f = foundry.utils.getProperty(e, `flags.${MODULE_ID}`) ?? {};
      if (R.onBoard(f)) rows.push(R.boardEntry(e._id, e.name, f, e.img));
    }
    this.entries = rows;
    if (force) { this.view = null; this.render(); }
  }

  /** The filtered, sorted queue. */
  queue() {
    return R.sortQueue(R.filterQueue(this.entries ?? [], this.filters));
  }

  async show(id) {
    this.current = id;
    this.view = null;
    if (id) {
      const doc = await convertedPack()?.getDocument(id);
      this.view = doc ? R.itemView(doc.toObject()) : null;
    }
    this.render();
  }

  step(dir) {
    const id = R.neighbour(this.queue(), this.current, dir);
    if (id && id !== this.current) this.show(id);
  }

  /** Write a decision to the item and move on. */
  async decide(action, { advance = true } = {}) {
    if (!game.user.isGM || !this.current) return;
    const pack = convertedPack();
    if (pack.locked) {
      ui.notifications.warn(`Loot Ledger: ${CONVERTED_PACK.label} is locked. Unlock it (right-click the compendium) to record review decisions.`);
      return;
    }
    const before = this.queue();
    const id = this.current;
    const entry = this.entries.find(e => e.id === id);
    const doc = await pack.getDocument(id);
    if (!doc || !entry) return;
    const note = this.element?.querySelector("textarea[name=note]")?.value;
    const review = R.applyAction(doc.getFlag(MODULE_ID, "review") ?? null, action, { by: game.user.name, at: new Date().toISOString(), note });
    await doc.update({ [`flags.${MODULE_ID}.review`]: review });
    entry.status = review.status;
    entry.note = review.note;
    if (advance && action !== "note") {
      const after = this.queue();
      const stillThere = after.some(e => e.id === id);
      return this.show(stillThere ? R.neighbour(after, id, 1) : (R.nextAfter(before, id) ?? after[0]?.id ?? null));
    }
    this.render();
  }

  /** Open the converted item's sheet; when it closes, mark the item tweaked. */
  async tweak() {
    if (!this.current) return;
    const doc = await convertedPack()?.getDocument(this.current);
    if (!doc) return;
    const id = this.current;
    if (this.#tweakHook !== null) Hooks.off("closeApplicationV2", this.#tweakHook);
    this.#tweakHook = Hooks.on("closeApplicationV2", app => {
      if (app.document?.uuid !== doc.uuid) return;
      Hooks.off("closeApplicationV2", this.#tweakHook);
      this.#tweakHook = null;
      if (this.current !== id) this.current = id;
      this.decide("tweak");
    });
    doc.sheet.render({ force: true });
  }

  async openSheet() {
    const doc = this.current ? await convertedPack()?.getDocument(this.current) : null;
    doc?.sheet.render({ force: true });
  }

  static #onPick(event, target) {
    const id = target.closest("[data-id]")?.dataset.id;
    if (id) this.show(id);
  }

  /* ---------------- rendering ---------------- */

  async _prepareContext() {
    await this.load();
    const queue = this.queue();
    if (!this.current || (!queue.some(e => e.id === this.current) && !this.view)) {
      const first = queue[0]?.id ?? null;
      if (first !== this.current) { this.current = first; this.view = null; }
    }
    if (this.current && !this.view) {
      const doc = await convertedPack()?.getDocument(this.current);
      this.view = doc ? R.itemView(doc.toObject()) : null;
    }
    return { queue };
  }

  async _renderHTML({ queue }) {
    const all = this.entries ?? [];
    const c = R.countStatuses(all);
    const f = this.filters;
    const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(label)}</option>`;
    const reasons = new Map();
    for (const e of all) for (const r of e.reasons) reasons.set(r, (reasons.get(r) ?? 0) + 1);
    const topReasons = [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 60);
    const slots = [...new Set(all.map(e => e.slot).filter(Boolean))].sort();
    const entry = all.find(e => e.id === this.current) ?? null;

    const filtersHtml = `
      <div class="llrb-filters">
        <select name="status">${opt("todo", "To do (pending + skipped)", f.status)}${opt("all", "All", f.status)}${R.STATUSES.map(s => opt(s, STATUS_LABEL[s], f.status)).join("")}</select>
        <select name="quality">${opt("", "Any quality", f.quality)}${QUALITIES.map(q => opt(q.key, q.label, f.quality)).join("")}</select>
        <select name="category">${opt("", "Any item type", f.category)}${CATEGORIES.map(x => opt(x.key, x.label, f.category)).join("")}</select>
        <select name="slot">${opt("", "Any slot", f.slot)}${slots.map(s => opt(s, s, f.slot)).join("")}</select>
        <select name="reason">${opt("", "Any reason", f.reason)}${topReasons.map(([r, n]) => opt(r, `${r.length > 60 ? r.slice(0, 59) + "…" : r} (${n})`, f.reason)).join("")}</select>
        <input type="search" name="search" placeholder="Search name, line or note" value="${esc(f.search)}">
        <button type="button" data-action="reload" data-tooltip="Re-read the compendium"><i class="fa-solid fa-rotate"></i></button>
      </div>`;

    const progress = `
      <div class="llrb-progress">
        <span><strong>${c.done}</strong> / ${c.total} decided</span>
        ${R.STATUSES.map(s => `<span class="llrb-st llrb-st-${s}">${STATUS_LABEL[s]}: ${c[s]}</span>`).join("")}
        <span class="llrb-shown">${queue.length} shown</span>
      </div>`;

    const list = queue.slice(0, LIST_LIMIT).map(e => `
      <li data-id="${e.id}" data-action="pick" class="${e.id === this.current ? "active" : ""}">
        <span class="llrb-name ${Q.qualityClass(e.quality)}">${esc(e.name)}</span>
        <span class="llrb-st llrb-st-${e.status}">${STATUS_LABEL[e.status]}</span>
      </li>`).join("") + (queue.length > LIST_LIMIT ? `<li class="llrb-more">+${queue.length - LIST_LIMIT} more: narrow the filters</li>` : "");

    let detail = `<div class="llrb-empty"><p>Nothing to review with these filters.</p></div>`;
    const v = this.view;
    if (entry && v) {
      const lines = v.sourceLines.map(l => `<li class="${l.flagged ? "llrb-flagged" : ""}">${esc(l.text)}</li>`).join("");
      const why = v.reviewLines.map(r => `<li><em>${esc(r.line)}</em>: ${esc(r.why)}</li>`).join("");
      const facts = [
        v.summary && `<li><strong>Result:</strong> ${esc(v.summary)}</li>`,
        v.bonus ? `<li><strong>Bonus:</strong> +${v.bonus}</li>` : "",
        `<li><strong>Activities:</strong> ${v.activities.length ? v.activities.map(esc).join(", ") : "none"}</li>`,
        v.riders.length ? `<li><strong>Riders:</strong> ${v.riders.map(esc).join("; ")}</li>` : "",
        v.notConverted.length ? `<li><strong>Not converted:</strong> ${v.notConverted.map(esc).join("; ")}</li>` : ""
      ].filter(Boolean).join("");
      detail = `
        <header class="llrb-head">
          <h2 class="${Q.qualityClass(entry.quality)}">${esc(entry.name)}</h2>
          <span class="llrb-meta">${esc(QUALITIES.find(q => q.key === entry.quality)?.label ?? entry.quality)}${entry.slot ? ` · ${esc(entry.slot)}` : ""}${entry.band ? ` · band ${entry.band}` : ""}</span>
          <span class="llrb-st llrb-st-${entry.status}">${STATUS_LABEL[entry.status]}</span>
          <button type="button" data-action="open" data-tooltip="Open the item sheet (no status change)"><i class="fa-solid fa-up-right-from-square"></i></button>
        </header>
        <div class="llrb-cols">
          <section class="llrb-source"><h3>Source tooltip</h3><ul>${lines}</ul>
            <h3>Needs review</h3><ul class="llrb-why">${why || "<li>None (decided earlier)</li>"}</ul></section>
          <section class="llrb-result"><h3>Converted 5e item</h3><ul class="llrb-facts">${facts}</ul>
            <div class="llrb-rules">${v.rulesHtml}</div></section>
        </div>
        <label class="llrb-note">GM note <textarea name="note" rows="2" placeholder="Optional: what you decided and why">${esc(entry.note)}</textarea></label>
        <footer class="llrb-actions">
          <button type="button" data-action="prev" data-tooltip="Previous (←)"><i class="fa-solid fa-arrow-left"></i></button>
          <button type="button" data-action="accept"><i class="fa-solid fa-check"></i> <u>A</u>ccept</button>
          <button type="button" data-action="tweak"><i class="fa-solid fa-pen"></i> <u>T</u>weak</button>
          <button type="button" data-action="skip"><i class="fa-solid fa-forward"></i> <u>S</u>kip</button>
          <button type="button" data-action="reject"><i class="fa-solid fa-ban"></i> <u>R</u>eject</button>
          <button type="button" data-action="reset" data-tooltip="Back to pending"><i class="fa-solid fa-rotate-left"></i></button>
          <button type="button" data-action="next" data-tooltip="Next (→)"><i class="fa-solid fa-arrow-right"></i></button>
        </footer>
        <p class="llrb-help">Accept: fine as converted. Tweak: edit the item; marked tweaked when you close its sheet. Accepted and tweaked items are not overwritten by later builds (unless <code>build({ force: true })</code>). Skip: come back later. Reject: left out of the roll tables from the next build.</p>`;
    }

    return `${progress}${filtersHtml}<div class="llrb-body"><ol class="llrb-list">${list}</ol><div class="llrb-detail">${detail}</div></div>`;
  }

  _replaceHTML(result, content) {
    const active = document.activeElement;
    const focusName = content.contains(active) ? active?.name : null;
    const caret = focusName === "search" ? active.selectionStart : null;
    content.innerHTML = result;
    if (focusName) {
      const el = content.querySelector(`[name="${focusName}"]`);
      el?.focus();
      if (caret !== null && el?.setSelectionRange) el.setSelectionRange(caret, caret);
    }
    content.querySelector(".llrb-list li.active")?.scrollIntoView({ block: "nearest" });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    for (const el of root.querySelectorAll(".ll-q")) Q.syncTheme(el);
    for (const el of root.querySelectorAll(".llrb-filters select")) {
      el.addEventListener("change", () => { this.filters[el.name] = el.value; this.view = null; this.current = null; this.render(); });
    }
    const search = root.querySelector(".llrb-filters input[name=search]");
    let t = null;
    search?.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { this.filters.search = search.value; this.view = null; this.current = null; this.render(); }, 250);
    });
    root.querySelector("textarea[name=note]")?.addEventListener("change", () => this.decide("note", { advance: false }));
    if (!this._keysBound) {
      this._keysBound = true;
      root.addEventListener("keydown", ev => {
        if (ev.target.closest("input, textarea, select, [contenteditable]")) return;
        const cmd = R.shortcutFor(ev);
        if (!cmd) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (cmd === "next") this.step(1);
        else if (cmd === "prev") this.step(-1);
        else if (cmd === "tweak") this.tweak();
        else this.decide(cmd);
      });
      root.tabIndex = -1;
    }
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
  }

  async close(options) {
    if (this.#tweakHook !== null) { Hooks.off("closeApplicationV2", this.#tweakHook); this.#tweakHook = null; }
    const r = await super.close(options);
    ReviewBoard.instance = null;
    return r;
  }
}

/** Register the board's entry points (called only when the "Review board" setting is on). */
export function registerReviewBoard() {
  // A button on the Build Report journal entry (header control and a bar above the pages).
  const isReport = app => !!app.document?.getFlag?.(MODULE_ID, "buildReport");
  Hooks.on("getHeaderControlsJournalEntrySheet", (app, controls) => {
    if (!game.user.isGM || !isReport(app)) return;
    controls.unshift({ icon: "fa-solid fa-clipboard-check", label: "Review board", action: "llReviewBoard", onClick: () => ReviewBoard.open() });
  });
  Hooks.on("renderJournalEntrySheet", (app, element) => {
    if (!game.user.isGM || !isReport(app)) return;
    const host = element.querySelector(".window-content") ?? element;
    if (host.querySelector(".loot-ledger-report-bar")) return;
    const bar = document.createElement("div");
    bar.className = "loot-ledger-report-bar";
    bar.innerHTML = `<button type="button"><i class="fa-solid fa-clipboard-check"></i> Open the Review board</button>`;
    bar.querySelector("button").addEventListener("click", () => ReviewBoard.open());
    host.prepend(bar);
  });
}
