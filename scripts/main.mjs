/**
 * Loot Ledger: entry point. Registers settings, the "Build loot pools" menu and the API.
 */
import { MODULE_ID, SOURCE_MODULE, BANDS } from "./data.mjs";
import { build, ITEMS_PACK, TABLES_PACK } from "./build.mjs";
import { createApi } from "./api.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** Small settings-menu window with an explanation and the build button. */
class BuildMenu extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "loot-ledger-build",
    classes: ["loot-ledger"],
    tag: "div",
    window: { title: "LOOTLEDGER.Menu.Title", icon: "fa-solid fa-coins" },
    position: { width: 480, height: "auto" },
    actions: { build: BuildMenu.#onBuild }
  };

  async _renderHTML() {
    const i18n = k => game.i18n.localize(k);
    const ratio = game.settings.get(MODULE_ID, "coinRatio");
    const source = game.packs.get(`${SOURCE_MODULE}.items`);
    const items = game.packs.get(`world.${ITEMS_PACK.name}`);
    const tables = game.packs.get(`world.${TABLES_PACK.name}`);
    const bands = BANDS.map(b => `<li>Band ${b.band}: item level ${b.max === Infinity ? `${b.min}+` : `${b.min}–${b.max}`} → ${b.levels}</li>`).join("");
    return `
      <section class="loot-ledger-menu">
        <p>${i18n("LOOTLEDGER.Menu.Intro")}</p>
        <ul class="loot-ledger-status">
          <li><strong>${i18n("LOOTLEDGER.Menu.Source")}:</strong> ${source ? `${source.index.size} items` : i18n("LOOTLEDGER.Menu.Missing")}</li>
          <li><strong>${i18n("LOOTLEDGER.Menu.Ratio")}:</strong> ${ratio === "10" ? i18n("LOOTLEDGER.Settings.Ratio.Ten") : i18n("LOOTLEDGER.Settings.Ratio.Hundred")}</li>
          <li><strong>${ITEMS_PACK.label}:</strong> ${items ? `${items.index.size} items` : i18n("LOOTLEDGER.Menu.NotBuilt")}</li>
          <li><strong>${TABLES_PACK.label}:</strong> ${tables ? `${tables.index.size} tables` : i18n("LOOTLEDGER.Menu.NotBuilt")}</li>
        </ul>
        <details><summary>${i18n("LOOTLEDGER.Menu.Bands")}</summary><ul>${bands}</ul></details>
        <footer class="form-footer">
          <button type="button" data-action="build" ${source ? "" : "disabled"}>
            <i class="fa-solid fa-hammer"></i> ${i18n("LOOTLEDGER.Menu.Build")}
          </button>
        </footer>
      </section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #onBuild(event, target) {
    target.disabled = true;
    try {
      const summary = await build({ confirm: true });
      if (summary) this.render();
    } finally {
      target.disabled = false;
    }
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "coinRatio", {
    name: "LOOTLEDGER.Settings.Ratio.Name",
    hint: "LOOTLEDGER.Settings.Ratio.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "100": "LOOTLEDGER.Settings.Ratio.Hundred",
      "10": "LOOTLEDGER.Settings.Ratio.Ten"
    },
    default: "100"
  });

  game.settings.registerMenu(MODULE_ID, "build", {
    name: "LOOTLEDGER.Menu.Name",
    label: "LOOTLEDGER.Menu.Build",
    hint: "LOOTLEDGER.Menu.Hint",
    icon: "fa-solid fa-hammer",
    type: BuildMenu,
    restricted: true
  });

  const module = game.modules.get(MODULE_ID);
  if (module) module.api = createApi();
});

Hooks.once("ready", () => {
  Hooks.callAll(`${MODULE_ID}.ready`, game.modules.get(MODULE_ID)?.api);
});
