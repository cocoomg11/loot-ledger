/**
 * The GM's Merchants window (ApplicationV2). Loaded on demand by merchants.mjs `open()`, so nothing here runs at import in Node.
 */
import * as MM from "./merchants-model.mjs";
import { esc, UI_CLASSES } from "../vendor/wanderers-core/index.mjs";
import { ip, merchantActors, readMap, readDefaults, plan, apply, restock, setMapping, unmap, removeData } from "./merchants.mjs";


const { ApplicationV2 } = foundry.applications.api;

/** The GM's Merchants window. */
export class MerchantsApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "loot-ledger-merchants",
    classes: ["loot-ledger", "loot-ledger-merchants", ...UI_CLASSES],
    tag: "div",
    window: { title: "Loot Ledger: Merchants", icon: "fa-solid fa-store", resizable: true },
    position: { width: 900, height: 680 },
    actions: {
      run: MerchantsApp.#onRun,
      bulk: MerchantsApp.#onBulk,
      unmap: MerchantsApp.#onUnmap,
      removeData: MerchantsApp.#onRemove
    }
  };

  /** Band used for wandering merchants on the next Apply (window state only). */
  wanderBand = "";

  async _renderHTML() {
    const api = ip();
    if (!api) return `<section class="ll-m"><p class="wc-alert">Item Piles is not active. The Merchants window needs it.</p></section>`;
    const d = readDefaults();
    const map = readMap();
    const p = plan({ band: this.wanderBand ? Number(this.wanderBand) : null });
    const rows = new Map(p.rows.map(r => [r.id, r]));
    const bandOpts = sel => `<option value="">–</option>${d.bands.map(b => `<option value="${b.band}" ${sel === b.band ? "selected" : ""}>${esc(MM.bandLabel(d, b.band))}</option>`).join("")}`;
    const sizeOpts = sel => MM.SIZES.map(s => `<option value="${s}" ${sel === s ? "selected" : ""}>${esc(MM.SIZE_LABELS[s])}</option>`).join("");
    const typeOpts = sel => MM.VENDOR_TYPES.map(t => `<option value="${t.key}" ${sel.includes(t.key) ? "selected" : ""}>${esc(t.label)}</option>`).join("");
    const groups = new Map();
    for (const a of merchantActors(api)) {
      const f = a.folder?.name ?? "(no folder)";
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f).push(a);
    }
    const status = (a, e) => {
      if (!e) return `<span class="wc-muted">not mapped</span>`;
      const r = rows.get(a.id);
      if (!r) return "";
      if (!r.ok) return `<span class="wc-warn">${esc(r.reason)}</span>`;
      if (r.reason === "hand-stocked") return `<span class="wc-muted">hand-stocked</span>`;
      const tip = r.missing.length ? ` title="${esc(r.missing.join("\n"))}"` : "";
      return `<span class="${r.missing.length ? "wc-warn" : "wc-ok"}"${tip}>${r.found.length} found, ${r.missing.length} missing</span>`;
    };
    const body = [...groups.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([folder, actors]) => {
      const ids = actors.map(a => a.id).join(",");
      const trs = actors.sort((x, y) => x.name.localeCompare(y.name)).map(a => {
        const e = map.merchants[a.id];
        const ce = MM.cleanEntry(e ?? {});
        return `<tr data-id="${a.id}">
          <td>${esc(a.name)}</td>
          <td><select multiple size="3" data-field="types">${typeOpts(ce.types)}</select></td>
          <td><select data-field="band">${bandOpts(ce.band)}</select></td>
          <td><select data-field="size">${sizeOpts(ce.size)}</select></td>
          <td><input type="number" step="0.05" min="0" max="10" data-field="buy" value="${ce.buy ?? ""}" placeholder="def." aria-label="Buy modifier"></td>
          <td><input type="number" step="0.05" min="0" max="10" data-field="sell" value="${ce.sell ?? ""}" placeholder="def." aria-label="Sell modifier"></td>
          <td>${status(a, e)}</td>
          <td class="ll-m-btns">
            <button type="button" class="wc-btn wc-btn-sm" data-action="run" data-what="apply" data-ids="${a.id}" title="Apply tables">Apply</button>
            <button type="button" class="wc-btn wc-btn-sm" data-action="run" data-what="restock" data-ids="${a.id}" title="Restock now">Restock</button>
            <button type="button" class="wc-btn wc-btn-sm wc-btn-ghost" data-action="run" data-what="dry" data-ids="${a.id}" title="Dry run">Dry</button>
            ${e ? `<button type="button" class="wc-btn wc-btn-sm wc-btn-ghost" data-action="unmap" data-ids="${a.id}" title="Forget this merchant's mapping">×</button>` : ""}
          </td></tr>`;
      }).join("");
      return `<section class="ll-m-folder" data-ids="${ids}">
        <h3>${esc(folder)} <span class="wc-muted">(${actors.length})</span></h3>
        <div class="ll-m-bulk">
          <label>Set folder: <select data-bulk="type"><option value="">type…</option>${typeOpts([])}</select></label>
          <select data-bulk="band" aria-label="Band">${bandOpts(null)}</select>
          <select data-bulk="size" aria-label="Size"><option value="">size…</option>${sizeOpts("")}</select>
          <button type="button" class="wc-btn wc-btn-sm" data-action="bulk">Set</button>
          <button type="button" class="wc-btn wc-btn-sm" data-action="run" data-what="apply" data-ids="${ids}">Apply folder</button>
          <button type="button" class="wc-btn wc-btn-sm" data-action="run" data-what="restock" data-ids="${ids}">Restock folder</button>
        </div>
        <table class="wc-table"><thead><tr><th>Merchant</th><th>Types</th><th>Band</th><th>Size</th><th>Buy ×</th><th>Sell ×</th><th>Tables</th><th></th></tr></thead><tbody>${trs}</tbody></table>
      </section>`;
    }).join("") || `<p class="wc-muted">No Item Piles merchants among the world's actors.</p>`;
    const missing = p.missing.length
      ? `<details><summary class="wc-warn">${p.missing.length} shop table${p.missing.length === 1 ? "" : "s"} missing</summary><ul class="ll-m-missing">${p.missing.map(n => `<li>${esc(n)}</li>`).join("")}</ul></details>`
      : `<p class="wc-ok">Every table the mapping needs exists.</p>`;
    return `<section class="ll-m">
      <p class="wc-hint">Tables are found by name in the world's Roll Tables (folder "${esc(MM.TABLE_FOLDER)}" by convention): <code>${esc(MM.tableName("weapons", 2, "stock"))}</code>. Loot Ledger does not create them yet. Restock keeps items flagged <em>Keep on merchant</em>, deletes the rest and rolls the tables again.</p>
      ${missing}
      <div class="ll-m-top">
        <label>Band for wandering merchants: <select data-wander>${bandOpts(this.wanderBand ? Number(this.wanderBand) : null)}</select></label>
        <button type="button" class="wc-btn" data-action="run" data-what="apply" data-ids="">Apply all</button>
        <button type="button" class="wc-btn" data-action="run" data-what="restock" data-ids="">Restock all</button>
        <button type="button" class="wc-btn wc-btn-ghost" data-action="run" data-what="dry" data-ids="">Dry run all</button>
        <button type="button" class="wc-btn wc-btn-ghost wc-btn-danger" data-action="removeData">Remove merchant data</button>
      </div>
      ${body}
    </section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    const root = this.element;
    root.querySelectorAll("tr[data-id] [data-field]").forEach(el => el.addEventListener("change", ev => this.#onField(ev)));
    root.querySelector("[data-wander]")?.addEventListener("change", ev => { this.wanderBand = ev.currentTarget.value; this.render(); });
    // Foundry's pause key listens on the document: Space in our fields stays here.
    root.addEventListener("keydown", ev => { if (ev.key === " " && ev.target.closest?.("input, select, button")) ev.stopPropagation(); });
  }

  async #onField(ev) {
    const el = ev.currentTarget;
    const id = el.closest("tr").dataset.id;
    const f = el.dataset.field;
    let value;
    if (f === "types") value = [...el.selectedOptions].map(o => o.value);
    else if (f === "band") value = el.value === "" ? null : Number(el.value);
    else if (f === "buy" || f === "sell") value = el.value === "" ? null : Number(el.value);
    else value = el.value;
    await setMapping([id], { [f]: value });
    this.render();
  }

  static async #onRun(event, target) {
    const ids = target.dataset.ids ? target.dataset.ids.split(",") : null;
    const what = target.dataset.what;
    target.disabled = true;
    try {
      if (what === "apply") await apply(ids, { band: this.wanderBand || null });
      else if (what === "restock") await restock(ids);
      else { await apply(ids, { dryRun: true, band: this.wanderBand || null }); await restock(ids, { dryRun: true }); }
    } finally {
      this.render();
    }
  }

  static async #onBulk(event, target) {
    const sec = target.closest(".ll-m-folder");
    const ids = sec.dataset.ids.split(",");
    const type = sec.querySelector("[data-bulk=type]").value;
    const band = sec.querySelector("[data-bulk=band]").value;
    const size = sec.querySelector("[data-bulk=size]").value;
    const fields = {};
    if (type) fields.types = [type];
    if (band) fields.band = Number(band);
    if (size) fields.size = size;
    if (!Object.keys(fields).length) { ui.notifications.info("Loot Ledger: pick a type, band or size to set."); return; }
    await setMapping(ids, fields);
    this.render();
  }

  static async #onUnmap(event, target) {
    await unmap(target.dataset.ids.split(","));
    this.render();
  }

  static async #onRemove() {
    if (await removeData()) this.render();
  }
}

