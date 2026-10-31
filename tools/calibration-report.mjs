#!/usr/bin/env node
/**
 * Calibration report: prints the current rules (scripts/rules.mjs) as tables and, given a JSON file of sample
 * items, shows how each one converts. For book day: compare the output against the book, edit rules.mjs, re-run.
 *
 *   node tools/calibration-report.mjs                                  rules + the bundled sample items
 *   node tools/calibration-report.mjs path/to/items.json               rules + your items
 *   node tools/calibration-report.mjs --rules                          rules only
 *   node tools/calibration-report.mjs --items [file]                   items only
 *   node tools/calibration-report.mjs --ratio 10 [file]                price with the 10:1 coin ratio
 *   node tools/calibration-report.mjs --detail [file]                  also print each item's features in full
 *   node tools/calibration-report.mjs --json [file]                    machine-readable conversion rows
 *
 * Items file: a JSON array. Each entry is either
 *   - compact: { "name", "quality", "type", "lines": [tooltip lines after the name], "sell": copper,
 *               "sysType"?, "pre"?: hand-written 5e HTML, "itemId"? }   (see tools/fixtures/sample-items.json), or
 *   - a full source document as exported from the wow-classic-items compendium (has system.description.value).
 * Nothing here touches Foundry; it imports the same modules Build uses.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as R from "../scripts/rules.mjs";
import { convertItem, CONVERTER_VERSION } from "../scripts/convert.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ITEMS = resolve(HERE, "fixtures/sample-items.json");
const COLOR = { poor: "#9d9d9d", common: "#ffffff", uncommon: "#1eff00", rare: "#0070dd", epic: "#a335ee", legendary: "#ff8000", artifact: "#e6cc80" };

/** Compact sample entry -> source document in the wow-classic-items module's shape. Full documents pass through. */
export function toSource(e, i = 0) {
  if (e.system?.description) return e;
  const quality = e.quality ?? "common";
  const tip = `<div style="background:#0b0b10;"><div style="color: ${COLOR[quality]}; font-size: 1.08em">${e.name}</div>` +
    (e.lines ?? []).map(l => `<div>${l}</div>`).join("") + "</div>";
  return {
    _id: `sample${String(i).padStart(10, "0")}`, name: e.name, type: e.type ?? "equipment", img: "icons/svg/item-bag.svg",
    system: { description: { value: (e.pre ?? "") + tip }, type: { value: e.sysType ?? "" } },
    flags: { "wow-classic-items": {
      vendorPrice: { totalCopper: e.sell ?? 0 }, ...(e.pre ? { handAuthored: true } : {}), ...(e.itemId ? { itemId: e.itemId } : {})
    } }
  };
}

/* ---------- formatting ---------- */

const show = v => {
  if (v === Infinity) return "∞";
  if (v instanceof RegExp) return `/${v.source}/${v.flags}`;
  if (v instanceof Set) return `{${[...v].join(", ")}}`;
  if (Array.isArray(v)) return v.every(x => typeof x === "number") && v.length === 3 ? `${v[0]}d${v[1]}${v[2] ? `+${v[2]}` : ""}` : `[${v.map(show).join(", ")}]`;
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join(", ");
  return String(v);
};

export function table(rows, cols) {
  if (!rows.length) return "(none)\n";
  const w = cols.map(c => Math.min(c.max ?? 60, Math.max(c.label.length, ...rows.map(r => String(r[c.key] ?? "").length))));
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const line = r => cols.map((c, i) => cut(String(r[c.key] ?? ""), w[i]).padEnd(w[i])).join(" | ").trimEnd();
  return [line(Object.fromEntries(cols.map(c => [c.key, c.label]))), w.map(n => "-".repeat(n)).join("-|-"), ...rows.map(line)].join("\n") + "\n";
}

/** Every export of rules.mjs as {name, key, value} rows (tables are split one row per entry). */
export function rulesRows(rules = R) {
  const rows = [];
  for (const [name, v] of Object.entries(rules)) {
    if (Array.isArray(v) && v.length && typeof v[0] === "object" && !Array.isArray(v[0])) {
      v.forEach((r, i) => rows.push({ name, key: `#${i + 1}`, value: show(r) }));
    } else if (v && typeof v === "object" && !(v instanceof Set) && !(v instanceof RegExp) && !Array.isArray(v)) {
      const flat = Object.values(v).every(x => typeof x !== "object" || x === null);
      if (flat) rows.push({ name, key: "", value: show(v) });
      else for (const [k, x] of Object.entries(v)) rows.push({ name, key: k, value: show(x) });
    } else rows.push({ name, key: "", value: show(v) });
  }
  return rows;
}

/** One summary row per sample item. */
export function conversionRows(entries, { ratio = "100" } = {}) {
  return entries.map((e, i) => {
    const src = toSource(e, i);
    try {
      const { result: r, data } = convertItem(src, { ratio, dnd5eMajor: 6 });
      const c = data.flags["loot-ledger"].converted;
      return {
        name: src.name, quality: data.flags["loot-ledger"].quality, ilvl: data.flags["loot-ledger"].itemLevel ?? "",
        shape: c.shape, becomes: [r.type, r.base].filter(Boolean).join(" / "), rarity: r.rarity,
        bonus: r.bonus ? `+${r.bonus}` : "", attune: r.attunement ? (r.attunement === true ? "yes" : r.attunement) : "",
        dmgAc: r.damage || r.ac, uses: data.system.uses?.max && c.shape !== "consumable" ? `${data.system.uses.max}/LR` : "",
        features: r.features.map(f => f.text.split(".")[0]).join("; "),
        notConv: r.notConverted.length || "", review: r.needsReview ? "REVIEW" : "", hand: r.handAuthored ?? "",
        price: r.price, basedOn: r.basedOn, _features: r.features, _notConverted: r.notConverted, _review: r.reviewReason
      };
    } catch (err) {
      return { name: src.name, review: `ERROR ${err.message}` };
    }
  });
}

const ITEM_COLS = [
  { key: "name", label: "Item", max: 30 }, { key: "quality", label: "Quality" }, { key: "ilvl", label: "iLvl" },
  { key: "becomes", label: "Becomes", max: 26 }, { key: "rarity", label: "Rarity" }, { key: "bonus", label: "+N" },
  { key: "attune", label: "Attune", max: 18 }, { key: "dmgAc", label: "Dmg/AC", max: 16 }, { key: "uses", label: "Uses" },
  { key: "features", label: "Features", max: 48 }, { key: "notConv", label: "NC" }, { key: "review", label: "Review" },
  { key: "hand", label: "Hand-written", max: 22 }, { key: "price", label: "Price" }
];

function main(argv) {
  const flags = new Set(argv.filter(a => a.startsWith("--")));
  const ri = argv.indexOf("--ratio");
  const ratio = ri >= 0 ? argv[ri + 1] : "100";
  const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--ratio") ?? DEFAULT_ITEMS;
  const wantRules = !flags.has("--items") && !flags.has("--json");
  const wantItems = !flags.has("--rules");
  const out = [];
  if (wantRules) {
    out.push(`Loot Ledger calibration rules (scripts/rules.mjs), converter version ${CONVERTER_VERSION}\n`);
    out.push(table(rulesRows(), [{ key: "name", label: "Rule" }, { key: "key", label: "Key", max: 14 }, { key: "value", label: "Value", max: 110 }]));
  }
  if (wantItems) {
    const entries = JSON.parse(readFileSync(file, "utf8"));
    const rows = conversionRows(entries, { ratio });
    if (flags.has("--json")) {
      process.stdout.write(JSON.stringify(rows.map(({ _features, _notConverted, _review, ...r }) => ({ ...r, features: _features, notConverted: _notConverted, reviewReason: _review })), null, 2) + "\n");
      return;
    }
    out.push(`\nSample conversions: ${file} (${rows.length} items, coin ratio ${ratio === "10" ? "10:1" : "100:1"})\n`);
    out.push(table(rows, ITEM_COLS));
    out.push(`NC = lines listed as "Not converted". Review = the item lands on the Build Report's GM review page.\n`);
    if (flags.has("--detail")) for (const r of rows) {
      out.push(`\n## ${r.name} (${r.quality}, ilvl ${r.ilvl}) -> ${r.becomes}, ${r.rarity}${r.bonus ? ` ${r.bonus}` : ""}${r.basedOn ? `, based on ${r.basedOn}` : ""}\n`);
      for (const f of r._features ?? []) out.push(`  - ${f.text}\n      Source: ${f.source}\n`);
      for (const n of r._notConverted ?? []) out.push(`  x Not converted: ${n}\n`);
      if (r._review) out.push(`  ! GM review: ${r._review}\n`);
      if (r.hand) out.push(`  * Hand-written: ${r.hand}\n`);
    }
  }
  process.stdout.write(out.join(""));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
