# Conversion calibration and replace list

Developer notes for Loot Ledger's 5e conversion. The user-facing summary is in the [README](../README.md#5e-conversion).

## Calibration: `scripts/rules.mjs`

Every tunable number lives in one commented file, `scripts/rules.mjs`, so tuning is editing values, not logic:
rarity by quality, mixed-drop weights, the price rule, base weapon and chest-armour mapping, the +N curves for
weapons, shields and chest armour (`GEAR_BONUS`, `ARMOR_BONUS`), the green-item rule, attunement, stat passives
(`STAT_RULE`, `STAT_PASSIVE`), trinket bonuses (`TRINKET_RULE`), hit / defence / spell power / resistance
thresholds, proc dice (`PROC_RULE`), limited uses (`DAILY_USES` for Flurry and the like, `BLAST_USES`) and
consumable tables. `convert.mjs` re-exports them. Changing any value changes every affected item's hash, so the
next build re-converts exactly those items. `tests/rules.test.mjs` pins the current values; update it alongside
any deliberate change. Level bands (`LEVEL_BANDS`) and creature-table spread (`CREATURE_TABLE`) live there too.

`node tools/calibration-report.mjs` prints every rule as a table and shows how a set of sample items converts
(`tools/fixtures/sample-items.json`, about 40 made-up items, or your own JSON file; `--detail` prints each
item's features in full, `--json` gives machine-readable rows). [BOOK-DAY.md](../BOOK-DAY.md) is the step-by-step
calibration and release checklist.

## Replace list: `scripts/replace-list.mjs`

Some hand-written conversions from the source module pass the automatic audit but were found by review not to
trace to their tooltip. List them in `REPLACE_LIST` (by exact source item name, or by classic `itemId`, which is
matched first) and Build uses Loot Ledger's conversion for them. The list holds identifiers only. It currently
names 3 of the 47 known failures; the Build Report shows which entries matched a hand-written item, which matched
an item with no hand-written rules, and which matched nothing.

```js
const ll = game.modules.get("loot-ledger").api;
ll.convert(sourceItem);                                    // → { data, result } without saving anything
ll.auditHandAuthored(sourceItem);                          // → { pass, problems } for a hand-written source item
await ll.auditHandWritten();                               // every hand-written source item: failing / passing,
                                                           // on the replace list or not, plus a paste-ready snippet
await ll.auditHandWritten({ journal: true });              // same, also as a "Hand-written audit" Build Report page
await ll.convertToPack({ names: ["Some Item"], pack: { name: "my-test", label: "My Test" } });
await ll.build({ convert: true });                         // full build with converted items
```

