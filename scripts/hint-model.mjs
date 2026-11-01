/**
 * One-time "the item tooltip exists" hint (pure; the notification and settings are in main.mjs / tooltip.mjs).
 */

/**
 * Whether to show the hint to this client now.
 * @param {object} s
 * @param {boolean} s.worldOn   world setting "Tell players about the item tooltip"
 * @param {boolean} s.tooltipOn this client already has the tooltip turned on
 * @param {boolean} s.seen      this client was already told (or dismissed it)
 */
export function shouldShowHint({ worldOn, tooltipOn, seen } = {}) {
  return !!worldOn && !tooltipOn && !seen;
}
