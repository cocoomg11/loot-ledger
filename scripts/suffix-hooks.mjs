/**
 * Random suffix enchantments: Foundry side (settings, hooks, API calls). The rules and the update itself are
 * pure (suffix.mjs). Needs a live world: none of this runs in Node tests.
 *
 * - Off unless BOTH "Convert items to 5e when building" and "Random suffix enchantments" are on. When off,
 *   no hook is registered (checked at ready; both settings ask for a reload).
 * - Only the active GM's client writes: when an item flagged `randomSuffix` and not yet rolled is created on
 *   an actor (a character, an NPC, or an Item Piles pile / merchant, which are actors too), it either rolls
 *   a suffix ("roll on drop") or whispers the GMs that one is waiting ("GM picks").
 * - Items keep `flags.loot-ledger.suffix` when moved between actors, so a rolled item never rolls again.
 */
import { MODULE_ID } from "./data.mjs";
import { suffixUpdate, canRoll, isRolled, suffixTable, SUFFIX_GROUPS } from "./suffix.mjs";

/** Pure active-GM pick: the lowest-id active GM. */
export function activeGMId(users) {
  const gms = [...users].filter(u => u.isGM && u.active).map(u => u.id).sort();
  return gms[0] ?? null;
}

export function isActiveGM() {
  if (!game.user?.isGM) return false;
  const core = game.users?.activeGM;
  if (core) return core.id === game.user.id;
  return activeGMId(game.users ?? []) === game.user.id;
}

export function suffixesEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, "convertOnBuild") && game.settings.get(MODULE_ID, "randomSuffixes") !== false;
  } catch { return false; }
}

export function registerSuffixSettings() {
  game.settings.register(MODULE_ID, "randomSuffixes", {
    name: "Random suffix enchantments",
    hint: "Converted items with a random enchantment line roll a suffix (\"of the Bear\", \"of Fire Resistance\", ...) when they land on an actor or loot pile: new name, small 5e effects and a slightly higher price. Only works while \"Convert items to 5e when building\" is on. Turn off to disable every suffix hook.",
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true
  });
  game.settings.register(MODULE_ID, "suffixMode", {
    name: "Random suffixes: who picks",
    hint: "Roll on drop: the active GM's client rolls a suffix as soon as the item is created on an actor or pile. GM picks: nothing is rolled automatically; the GMs get a whisper and choose with the item's Reroll suffix action or api.rollSuffix(item, { suffixId }).",
    scope: "world", config: true, type: String, default: "roll",
    choices: { roll: "Roll on drop", gm: "GM picks" }
  });
}

/** Write a suffix to an Item document. Active GM (automatic) or any GM (API). */
export async function applySuffix(item, options = {}) {
  if (!game.user.isGM) throw new Error("Loot Ledger: only a GM can roll suffixes.");
  const data = item.toObject();
  const res = suffixUpdate(data, options);
  if (!res) return null;
  await item.update(res.update);
  if (res.removeEffects.length) await item.deleteEmbeddedDocuments("ActiveEffect", res.removeEffects);
  if (res.effects.length) await item.createEmbeddedDocuments("ActiveEffect", res.effects);
  return { id: res.suffix.id, label: res.suffix.label, power: res.power, name: res.update.name };
}

/** api.rollSuffix(item, { suffixId }): a deliberate GM action, so it (re)rolls even an already rolled item. */
export async function rollSuffix(item, { suffixId = null } = {}) {
  if (!suffixesEnabled()) {
    ui.notifications.warn("Loot Ledger: random suffixes are off (needs conversion and the Random suffix enchantments setting).");
    return null;
  }
  if (typeof item === "string") item = await fromUuid(item);
  if (!item || !canRoll(item)) {
    ui.notifications.warn("Loot Ledger: this item has no random enchantment line.");
    return null;
  }
  return applySuffix(item, { suffixId, reroll: true });
}

/** api.suffixes(): the suffix table with each effect at the lowest and highest power. */
export function listSuffixes() {
  return suffixTable();
}

async function onCreateItem(item) {
  // createItem fires for every item anywhere: cheapest checks first.
  if (!(item.parent instanceof Actor) || !canRoll(item) || isRolled(item) || !isActiveGM()) return;
  try {
    if (game.settings.get(MODULE_ID, "suffixMode") === "gm") {
      await ChatMessage.create({
        content: `<p><strong>Loot Ledger:</strong> ${item.name} on ${item.parent.name} can take a random suffix. Use the item's <em>Reroll suffix</em> action, or <code>api.rollSuffix(item, { suffixId })</code> (ids: <code>api.suffixes()</code>).</p>`,
        whisper: game.users.filter(u => u.isGM).map(u => u.id), speaker: { alias: "Loot Ledger" }
      });
      return;
    }
    await applySuffix(item);
  } catch (err) {
    console.error(`${MODULE_ID} | suffix roll failed for ${item.name}`, err);
  }
}

/** Register the hooks (call at ready). Nothing is registered when the feature is off. */
export function registerSuffixHooks() {
  if (!suffixesEnabled()) return false;
  Hooks.on("createItem", onCreateItem);
  // dnd5e item context menu (actor sheets / inventory): GM-only "Reroll suffix".
  Hooks.on("dnd5e.getItemContextOptions", (item, options) => {
    if (!game.user.isGM || !canRoll(item)) return;
    options.push({
      name: isRolled(item) ? "Reroll suffix" : "Roll suffix", icon: '<i class="fa-solid fa-dice"></i>',
      callback: () => rollSuffix(item)
    });
  });
  return true;
}

export { SUFFIX_GROUPS };
