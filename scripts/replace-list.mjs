/**
 * Replace list: source items whose HAND-WRITTEN 5e rules (written by the wow-classic-items module) fail Loot
 * Ledger's traceability standard and must be replaced by Loot Ledger's own conversion, even where the automatic
 * audit (`auditHandAuthored`) would let them through.
 *
 * Data only. Each entry is an identifier of an item in the wow-classic-items compendium, never rules text:
 *   name    exact source item name (required; used for matching when no id is given, and for the report)
 *   itemId  optional classic item id (the source module's flags["wow-classic-items"].itemId); when present it is
 *           matched first, so renamed items still match
 *   note    optional short reason (Loot Ledger's own words: which claim has no tooltip line behind it)
 *
 * Status: 3 of the 47 known failures are listed (the three named in the review). The other 44 are to be filled in
 * on book day from the GM review of the full build: the Build Report journal lists every hand-written item that
 * was replaced or kept, and any entry below that matches no source item.
 */
export const REPLACE_LIST = [
  { name: "Scarlet Kris",          note: "hand-written rule names mechanics with no backing tooltip line" },
  { name: "Feathermoon Headdress", note: "hand-written rule names mechanics with no backing tooltip line" },
  { name: "Band of Sulfuras",      note: "hand-written rule names mechanics with no backing tooltip line" }
];

/** How many failing hand-written conversions the review found in total (the list above should reach this). */
export const REPLACE_LIST_EXPECTED = 47;
