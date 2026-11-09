/**
 * The user's 0.4.0 conversion decisions (2026-11-08), on made-up fixtures (invented names; classic tooltip shapes):
 *   - main stats default to the stat variant; ability-score bases only for items picked as score items;
 *   - a base never also gets a variant for something it already covers; a picked score item never gets its own
 *     ability's variant;
 *   - a base covers a main stat only via score:X (picked) or the item's own chosen variant's tag;
 *   - damage-over-time procs become a bleed; over-time tails fold into the damage line;
 *   - "lowering all stats" clauses add a Bane-shaped debuff (setting statDebuff).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../scripts/base-match.mjs";
import { convertItem, bleedDice } from "../scripts/convert.mjs";
import { BLEED_RULE, STAT_DEBUFF_RULE, VARIANT_BASES, LINE_WEIGHT } from "../scripts/rules.mjs";
import { lineWeight } from "../scripts/variants.mjs";
import { srcItem } from "./_fixtures.mjs";

const ae = (...changes) => [{ name: "fx", transfer: true, system: { changes: changes.map(([key, value, type = "add"]) => ({ key, type, value: String(value), phase: "initial", priority: null })) } }];
const entry = (id, name, o = {}) => ({
  _id: id, name, type: "equipment",
  system: { rarities: [o.rarity ?? "uncommon"], type: { value: o.t ?? "clothing", baseItem: "" }, attunement: o.attune ? "required" : "",
    source: { rules: "2024" }, description: { value: o.text ?? "" } },
  effects: o.effects ?? [], _stats: { modifiedTime: 1 }
});
const name = (kind, slot) => VARIANT_BASES.find(r => r.kind === kind && r.slot === slot).name;
const index = () => M.indexBases([{ pack: "t", entries: [
  entry("cl", name("variant", "Back"), { effects: ae(["system.skills.ste.roll.bonus", "+ 5"]) }),
  entry("bt", name("variant", "Feet"), { effects: ae(["system.skills.ste.roll.bonus", "+ 5"]) }),
  entry("am", name("score", "Neck"), { attune: true, effects: ae(["system.abilities.con.value", 19, "upgrade"]) }),
  entry("hb", name("score", "Head"), { attune: true, effects: ae(["system.abilities.int.value", 19, "upgrade"]) }),
  entry("ga", name("score", "Hands"), { attune: true, effects: ae(["system.abilities.str.value", 19, "upgrade"]) })
] }]);
const conv = (src, o = {}) => convertItem(src, { dnd5eMajor: 6, bases: index(), ...o });
const F = c => c.data.flags["loot-ledger"];
const riders = c => F(c).riders;
const rider = (c, type) => riders(c).find(r => r.type === type);
const keys = c => c.data.effects.flatMap(e => (e.system?.changes ?? []).map(x => x.key));

/* ---------- (a)+(b) score items: variant by default, score base only when picked ---------- */

const collar = () => srcItem({ name: "Test Hound Collar", quality: "epic", lines: ["Neck", "+17 Stamina", "Equip: Increases your chance to dodge an attack by 1%.", "Equip: Improves your chance to get a critical strike by 1%.", "Item Level 71"] });

test("a big main stat gets its variant, not a score base (Con saves +2, parry and crit dice kept)", () => {
  const c = conv(collar());
  assert.equal(F(c).base, undefined, "no automatic score base");
  assert.equal(F(c).converted.route, "convert-auto");
  const v = rider(c, "variant");
  assert.deepEqual([v.variant, v.value], ["conSaves", 2]);
  assert.ok(keys(c).includes("system.abilities.con.save.roll.bonus"));
  assert.ok(rider(c, "parry") && rider(c, "critDice"), "parry reaction and crit dice kept");
  assert.equal(rider(c, "critDice").formula, "2d6");
});

test("a picked score item gets the score base at the raised rarity, and never its own ability's variant", () => {
  const c = conv(collar(), { overrides: { scoreItem: true } });
  const f = F(c);
  assert.equal(f.base.name, name("score", "Neck"));
  assert.equal(f.base.status, "accept");
  assert.equal(f.base.scoreItem, "con");
  assert.ok(!f.gapFills.some(g => g.kind === "variant"), "no Con variant on top of the score base");
  assert.deepEqual(f.gapFills.map(g => g.kind).sort(), ["critDice", "parry"], "the other lines stay as gap-fills");
  // Rarity step: an Uncommon score base needs at least a Rare item.
  const green = srcItem({ name: "Test Hound Torc", quality: "uncommon", lines: ["Neck", "+12 Stamina", "Item Level 40"] });
  assert.equal(F(conv(green, { overrides: { scoreItem: true } })).base, undefined, "stepsUp: no base on a green item");
  // Setting off: no score bases even when picked.
  assert.equal(F(conv(collar(), { overrides: { scoreItem: true }, scoreItems: false })).base, undefined);
});

test("head / hands score shapes fall back to their variant unless picked", () => {
  const cap = srcItem({ name: "Test Sage Cap", quality: "rare", lines: ["Head", "Cloth", "+16 Intellect", "Item Level 40"] });
  const grip = srcItem({ name: "Test Bone Grips", quality: "rare", lines: ["Hands", "Plate", "+13 Strength", "Item Level 45"] });
  assert.equal(rider(conv(cap), "variant").variant, "arcana");
  assert.equal(F(conv(cap)).base, undefined);
  assert.equal(rider(conv(grip), "variant").variant, "grapple");
  assert.equal(F(conv(grip)).base, undefined);
  const picked = conv(grip, { overrides: { scoreItem: true } });
  assert.equal(F(picked).base.name, name("score", "Hands"));
  assert.equal(F(picked).gapFills.length, 0, "no grapple variant on top of the score base");
});

/* ---------- coverage: tags, not need keys ---------- */

test("a base gets no variant for what it already covers (stealth cloak shape)", () => {
  const cape = srcItem({ name: "Test Kin Cape", quality: "uncommon", lines: ["Back", "+6 Agility", "Item Level 30"] });
  const c = conv(cape);
  assert.equal(F(c).base.name, name("variant", "Back"));
  assert.equal(F(c).base.status, "accept");
  assert.deepEqual(F(c).gapFills, [], "no Stealth +1 on top of the cloak");
  assert.equal(c.data.effects.length, 0);
});

test("uncoveredRiders compares the base's own tags; riderTags(variant) includes score:<ability>", () => {
  const v = { type: "variant", variant: "acrobatics", ability: "dex", value: 1 };
  assert.deepEqual(M.riderTags(v), ["skill:acr", "score:dex"]);
  assert.deepEqual(M.uncoveredRiders([v], { source: "compendium", tags: new Set(["stealth"]) }), [v], "stealth does not cover Acrobatics");
  assert.deepEqual(M.uncoveredRiders([v], { source: "compendium", tags: new Set(["score:dex"]) }), [], "a score base covers the variant");
  assert.deepEqual(M.uncoveredRiders([v], { source: "compendium", covered: ["stat:dex"], tags: new Set() }), [v], "need keys are never used");
  assert.deepEqual(M.uncoveredRiders([v], { source: "compendium", tags: new Set(), scoreAbility: "dex" }), []);
});

test("free scoring: Agility boots (Acrobatics) are not covered by stealth boots; still a board suggestion; picking it adds no gap-fill", () => {
  const boots = srcItem({ name: "Test Scout Boots", quality: "uncommon", lines: ["Feet", "Leather", "69 Armor", "+8 Agility", "+4 Stamina", "Item Level 34"] });
  const c = conv(boots);
  const f = F(c);
  assert.equal(f.base?.status === "accept", false, "no accepted base");
  assert.equal(f.converted.route, "convert-auto");
  const v = rider(c, "variant");
  assert.deepEqual([v.variant, v.value], ["acrobatics", 1], "Nimble: Acrobatics +1");
  assert.ok(keys(c).includes("system.skills.acr.roll.bonus"));
  const cand = (f.baseCandidates ?? []).find(x => x.name === name("variant", "Feet"));
  assert.ok(cand?.uuid, "the stealth boots are listed for the board's Use this base");
  const pinned = conv(boots, { overrides: { base: cand.uuid } });
  assert.equal(F(pinned).base.name, name("variant", "Feet"));
  assert.equal(F(pinned).base.status, "accept");
  assert.deepEqual(F(pinned).gapFills, [], "choosing it adds no variant gap-fill");
  // Main-stat coverage only through stat:X, the chosen variant's tag or a picked score: tag.
  const item = { p: { stats: { dex: 8 }, statLines: { dex: "+8 Agility" }, itemLevel: 34, effects: [], resist: {} }, shape: "gear", tier: 1, variant: "acrobatics" };
  assert.deepEqual(M.itemNeeds(item)[0].tags, ["stat:dex", "skill:acr"]);
  assert.deepEqual(M.itemNeeds({ ...item, scoreItem: true })[0].tags, ["stat:dex", "skill:acr", "score:dex"]);
});

/* ---------- (d) bleeds ---------- */

const axe = (q, line, dmg = "136 - 205 Damage") => srcItem({ name: "Test Gore Axe", quality: q, type: "weapon", lines: ["Two-Hand", "Axe", dmg, "Speed 3.60", line, "Item Level 49"] });

test("a damage-over-time proc becomes a bleed: blast band 6d6 -> 2d6 per turn, 2/LR, DC 17, attunement", () => {
  const c = conv(axe("epic", "Chance on hit: Wounds the target causing them to bleed for 560 damage over 30 sec."));
  const b = rider(c, "bleed");
  assert.equal(rider(c, "burstDamage"), undefined, "not an instant blast");
  assert.deepEqual([b.band, b.bandFormula, b.formula, b.uses, b.recovery, b.damageType], ["blast", "6d6", "2d6", 2, "lr", "slashing"]);
  assert.deepEqual(b.save, { ability: "con", dc: 17, timing: "endOfTurn", ends: true });
  assert.deepEqual([b.damageTiming, b.duration.minutes, b.stacking], ["startOfTurn", 1, "refresh"]);
  assert.equal(c.data.system.attunement, "required");
  assert.equal(c.data.system.uses.max, "2");
  const text = c.result.features.find(x => /Wound/.test(x.text)).text;
  assert.match(text, /start of each of its turns/); assert.match(text, /DC 17 Constitution saving throw/); assert.match(text, /instead of stacking/);
  assert.ok(F(c).converted.review.some(r => /560 damage over 30 sec/.test(r) && /bleed/.test(r)), "review line keeps the source over-time text");
});

test("bleed dice and DCs by rule", () => {
  assert.equal(bleedDice("6d6"), "2d6"); assert.equal(bleedDice("8d6"), "3d6"); assert.equal(bleedDice("3d6"), "1d6");
  assert.equal(bleedDice("1d6"), "1d6", "minimum 1d6"); assert.equal(bleedDice("1d4"), "1d6", "minimum 1d6");
  assert.deepEqual([BLEED_RULE.dc.uncommon, BLEED_RULE.dc.rare, BLEED_RULE.dc.epic, BLEED_RULE.dc.legendary], [13, 15, 17, 19]);
  assert.deepEqual([BLEED_RULE.dc.common, BLEED_RULE.dc.artifact], [11, 21]);
  const small = conv(axe("uncommon", "Chance on hit: Wounds the target causing them to bleed for 30 damage over 30 sec.", "30 - 50 Damage"));
  const b = rider(small, "bleed");
  assert.deepEqual([b.band, b.formula, b.save.dc, b.uses], ["crit", "1d6", 13, 1]);
  assert.equal(lineWeight(b), LINE_WEIGHT.extraDamage);
  assert.equal(lineWeight({ type: "bleed", band: "blast" }), LINE_WEIGHT.burstDamage);
});

test("an over-time tail folds into the damage line (small tail: instant damage; big tail: a bleed); not flagged as a part", () => {
  const brand = conv(axe("rare", "Chance on hit: Hurls a fiery ball that causes 40 Fire damage and an additional 9 damage over 6 sec.", "60 - 90 Damage"));
  const d = rider(brand, "extraDamage");
  assert.equal(d.damageType, "fire");
  assert.equal(rider(brand, "bleed"), undefined);
  assert.ok(!(F(brand).converted.flags ?? []).some(f => f.kind === "procParts"), "the tail is not an unconverted part");
  assert.match(brand.result.features.find(x => /Fire/.test(x.text)).source ?? "", /over-time tail/);
  const blight = conv(axe("rare", "Chance on hit: Diseases a target for 50 Nature damage and an additional 180 damage over 1 min.", "93 - 141 Damage"));
  assert.equal(rider(blight, "bleed").damageType, "poison", "mostly over time: a bleed in the proc's school");
  const heal = conv(axe("rare", "Chance on hit: Heals wielder of 78 damage over 12 sec.", "40 - 60 Damage"));
  assert.equal(rider(heal, "bleed"), undefined, "a heal-over-time is never a bleed");
  assert.ok(F(heal).converted.review.some(r => /healing proc/.test(r)));
});

/* ---------- (e) stat-lowering clauses ---------- */

const dagger = line => srcItem({ name: "Test Gut Knife", quality: "epic", type: "weapon", lines: ["One-Hand", "Dagger", "63 - 119 Damage", "Speed 1.80", line, "Item Level 69"] });

test("lowering all stats: the damage half stays (crit 3d6) and a Bane-shaped debuff is added, with a review line", () => {
  const c = conv(dagger("Chance on hit: Sends a shadowy bolt at the enemy causing 75 Shadow damage and lowering all stats by 25 for 30 sec."));
  const r = rider(c, "extraDamage");
  assert.deepEqual([r.formula, r.trigger, r.damageType], ["3d6", "critical", "necrotic"]);
  assert.deepEqual(r.debuff, { die: "1d4", rolls: ["attack", "save"], until: "endOfNextTurn" });
  assert.match(c.result.features.find(x => /Necrotic/.test(x.text)).text, /subtracts 1d4 from its attack rolls and saving throws until the end of your next turn/);
  assert.ok(F(c).converted.review.some(x => /lowering all stats/.test(x)));
  assert.ok(!(F(c).converted.flags ?? []).some(f => f.kind === "procParts"), "the clause is converted, not left over");
  assert.equal(STAT_DEBUFF_RULE.die, "1d4");
});

test("a debuff-only clause becomes an on-hit feature with uses; setting off flags the clause instead", () => {
  const only = conv(dagger("Chance on hit: Lowers all attributes of target by 15 for 1 min."));
  const d = rider(only, "debuff");
  assert.deepEqual([d.die, d.trigger, d.uses, d.recovery], ["1d4", "hit", 3, "lr"]);
  assert.ok(F(only).converted.flags.some(f => f.kind === "nonDamageProc"));
  const off = conv(dagger("Chance on hit: Sends a shadowy bolt at the enemy causing 75 Shadow damage and lowering all stats by 25 for 30 sec."), { rules: { statDebuff: false } });
  assert.equal(rider(off, "extraDamage").debuff, undefined);
  assert.ok(F(off).converted.flags.some(f => f.kind === "procParts"), "off: the clause is a flagged part");
  const offOnly = conv(dagger("Chance on hit: Lowers all attributes of target by 15 for 1 min."), { rules: { statDebuff: false } });
  assert.equal(rider(offOnly, "debuff"), undefined);
  assert.ok(F(offOnly).converted.review.length > 0, "off: review as before");
});
