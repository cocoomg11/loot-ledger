/**
 * Synthetic source items in the shape the wow-classic-items module uses (a tooltip block in the description).
 * Names and numbers are made up for tests; no item data is copied from the source module.
 */
const COLOR = { poor: "#9d9d9d", common: "#ffffff", uncommon: "#1eff00", rare: "#0070dd", epic: "#a335ee", legendary: "#ff8000" };

/**
 * @param {object} o
 * @param {string} o.name
 * @param {string} [o.quality="uncommon"]
 * @param {string[]} o.lines   tooltip lines after the name
 * @param {string} [o.type="equipment"]  source document type
 * @param {string} [o.pre=""]  hand-written rules HTML the source module put before the tooltip
 * @param {number} [o.sell=1234] vendor sell price in copper
 */
export function srcItem({ name, quality = "uncommon", lines, type = "equipment", pre = "", sell = 1234, id = null, wowId = null, sysType = "" }) {
  const tip = `<div style="background:#0b0b10;"><div style="color: ${COLOR[quality]}; font-size: 1.08em">${name}</div>${lines.map(l => `<div>${l}</div>`).join("")}</div>`;
  return {
    _id: id ?? `src${name.replace(/\W/g, "").slice(0, 13)}`.padEnd(16, "x").slice(0, 16),
    name, type, img: "icons/svg/item-bag.svg",
    system: { description: { value: pre + tip }, type: { value: sysType } },
    flags: { "wow-classic-items": { vendorPrice: { totalCopper: sell }, ...(pre ? { handAuthored: true } : {}), ...(wowId ? { itemId: wowId } : {}) } }
  };
}

export const FIXTURES = [
  srcItem({ name: "Test Longblade", quality: "rare", type: "weapon", lines: ["Binds when picked up", "One-Hand", "Sword", "40 - 75 Damage", "Speed 2.60", "+8 Strength", "+5 Stamina", "Item Level 40", "Requires Level 35"] }),
  srcItem({ name: "Test Flame Edge", quality: "uncommon", type: "weapon", lines: ["One-Hand", "Axe", "20 - 38 Damage", "Speed 2.50", "Chance on hit: Blasts the enemy for 90 Fire damage.", "Item Level 30"] }),
  srcItem({ name: "Test Quick Dagger", quality: "epic", type: "weapon", lines: ["One-Hand", "Dagger", "30 - 56 Damage", "Speed 1.80", "Chance on hit: Grants 1 extra attack on your next swing.", "+10 Agility", "Item Level 60"] }),
  srcItem({ name: "Test Chainmail", quality: "rare", lines: ["Chest", "Mail", "300 Armor", "+12 Stamina", "+15 Fire Resistance", "Item Level 50"] }),
  srcItem({ name: "Test Robe of the Owl", quality: "uncommon", lines: ["Chest", "Cloth", "40 Armor", "+6 Intellect", "+6 Spirit", "Item Level 25"] }),
  srcItem({ name: "Test Lucky Charm", quality: "rare", lines: ["Trinket", "+7 Agility", "Item Level 45"] }),
  srcItem({ name: "Test Odd Ring", quality: "epic", lines: ["Finger", "Equip: Your attacks summon a friendly squirrel.", "Item Level 60"] }),
  srcItem({ name: "Test Grey Club", quality: "poor", type: "weapon", lines: ["Two-Hand", "Mace", "5 - 9 Damage", "Speed 3.00", "Item Level 5"] }),
  srcItem({ name: "Test Healing Draught", quality: "common", type: "consumable", lines: ["Use: Restores 280 to 360 health.", "Item Level 25"], sysType: "potion" }),
  srcItem({ name: "Test Gnawed Bone", quality: "poor", type: "loot", lines: ["Item Level 3"], sell: 4 }),
  srcItem({ name: "Test Hand-Written Blade", quality: "rare", type: "weapon",
    pre: "<p><strong>Frost Bite.</strong> When you hit, the target takes an extra 1d6 cold damage.</p>",
    lines: ["One-Hand", "Sword", "30 - 55 Damage", "Speed 2.40", "Chance on hit: Strikes the target for 60 Frost damage.", "Item Level 42"] }),
  srcItem({ name: "Test Fibbing Headdress", quality: "rare",
    pre: "<p><strong>Starlight.</strong> You have Resistance to Fire damage and a +1 bonus to Armor Class.</p>",
    lines: ["Head", "Leather", "90 Armor", "+10 Intellect", "Item Level 48"] })
];
