/**
 * Loot Ledger: entry point. Registers settings, the "Build loot pools" menu and the API.
 */
import { MODULE_ID, SOURCE_MODULE, BANDS } from "./data.mjs";
import { build, ITEMS_PACK, CONVERTED_PACK, TABLES_PACK } from "./build.mjs";
import { createApi } from "./api.mjs";
import { ReviewBoard, registerReviewBoard } from "./review.mjs";
import { registerQualityColours } from "./quality.mjs";
import { registerSuffixSettings, registerSuffixHooks, isActiveGM } from "./suffix-hooks.mjs";
import { registerDropHook } from "./events.mjs";
import { registerTooltipSetting, setTooltipEnabled, SETTING as TOOLTIP_SETTING } from "./tooltip.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** Small settings-menu window with an explanation and the build button. */
class BuildMenu extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "loot-ledger-build",
    classes: ["loot-ledger"],
    tag: "div",
    window: { title: "LOOTLEDGER.Menu.Title", icon: "fa-solid fa-coins" },
    position: { width: 480, height: "auto" },
    actions: { build: BuildMenu.#onBuild, reviewBoard: () => ReviewBoard.open() }
  };

  async _renderHTML() {
    const i18n = k => game.i18n.localize(k);
    const ratio = game.settings.get(MODULE_ID, "coinRatio");
    const source = game.packs.get(`${SOURCE_MODULE}.items`);
    const items = game.packs.get(`world.${ITEMS_PACK.name}`);
    const tables = game.packs.get(`world.${TABLES_PACK.name}`);
    const converted = game.packs.get(`world.${CONVERTED_PACK.name}`);
    const convertOn = game.settings.get(MODULE_ID, "convertOnBuild");
    const bands = BANDS.map(b => `<li>Band ${b.band}: item level ${b.max === Infinity ? `${b.min}+` : `${b.min}–${b.max}`} → ${b.levels}</li>`).join("");
    return `
      <section class="loot-ledger-menu">
        <p>${i18n("LOOTLEDGER.Menu.Intro")}</p>
        <ul class="loot-ledger-status">
          <li><strong>${i18n("LOOTLEDGER.Menu.Source")}:</strong> ${source ? `${source.index.size} items` : i18n("LOOTLEDGER.Menu.Missing")}</li>
          <li><strong>${i18n("LOOTLEDGER.Menu.Ratio")}:</strong> ${ratio === "10" ? i18n("LOOTLEDGER.Settings.Ratio.Ten") : i18n("LOOTLEDGER.Settings.Ratio.Hundred")}</li>
          <li><strong>${i18n("LOOTLEDGER.Menu.Convert")}:</strong> ${convertOn ? i18n("LOOTLEDGER.Menu.On") : i18n("LOOTLEDGER.Menu.Off")}</li>
          <li><strong>${ITEMS_PACK.label}:</strong> ${items ? `${items.index.size} items` : i18n("LOOTLEDGER.Menu.NotBuilt")}</li>
          ${convertOn || converted ? `<li><strong>${CONVERTED_PACK.label}:</strong> ${converted ? `${converted.index.size} items` : i18n("LOOTLEDGER.Menu.NotBuilt")}</li>` : ""}
          <li><strong>${TABLES_PACK.label}:</strong> ${tables ? `${tables.index.size} tables` : i18n("LOOTLEDGER.Menu.NotBuilt")}</li>
        </ul>
        <details><summary>${i18n("LOOTLEDGER.Menu.Bands")}</summary><ul>${bands}</ul></details>
        <footer class="form-footer">
          ${game.settings.get(MODULE_ID, "reviewBoard") ? `<button type="button" data-action="reviewBoard" ${converted ? "" : "disabled"}>
            <i class="fa-solid fa-clipboard-check"></i> Review board
          </button>` : ""}
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

  // Off on the v0.3.0 development branch; book day flips the default once the rules are calibrated.
  game.settings.register(MODULE_ID, "convertOnBuild", {
    name: "LOOTLEDGER.Settings.Convert.Name",
    hint: "LOOTLEDGER.Settings.Convert.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // Review board (GM window over the converted items that need review). Off: nothing is registered.
  game.settings.register(MODULE_ID, "reviewBoard", {
    name: "Review board",
    hint: "A GM window for working through converted items that need review (Accept / Tweak / Skip / Reject, with notes). Opens from these settings, the Build Report journal and api.reviewBoard(). Needs a reload.",
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true
  });

  // Quality colours. Off: no hooks, no picker, no context-menu entry.
  game.settings.register(MODULE_ID, "qualityColours", {
    name: "Quality colours",
    hint: "Show item names in their quality colour (grey, white, green, blue, purple, orange, ...) on actor and item sheets, chat cards, content links, roll tables, the Items sidebar and compendiums, and Item Piles windows. Needs a reload.",
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true
  });
  game.settings.register(MODULE_ID, "qualityRarityFallback", {
    name: "Colour by 5e rarity when no quality is set",
    hint: "Items without a quality are coloured by their dnd5e rarity (common white, uncommon green, rare blue, very rare purple, legendary orange, artifact gold). An explicit quality always wins.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "qualityPicker", {
    name: "Quality picker for GMs",
    hint: 'Adds a "Quality" dropdown to item sheet headers and a "Set quality" entry to the Items sidebar and compendium context menus (GM only). Needs a reload.',
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true
  });

  if (game.settings.get(MODULE_ID, "reviewBoard")) registerReviewBoard();
  if (game.settings.get(MODULE_ID, "qualityColours")) registerQualityColours();
  // The picker without the colours would be invisible; it is part of the colours feature.
  registerSuffixSettings();
  registerTooltipSetting();

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
  registerSuffixHooks();
  registerDropHook(isActiveGM);
  setTooltipEnabled(game.settings.get(MODULE_ID, TOOLTIP_SETTING));
  Hooks.callAll(`${MODULE_ID}.ready`, game.modules.get(MODULE_ID)?.api);
});
