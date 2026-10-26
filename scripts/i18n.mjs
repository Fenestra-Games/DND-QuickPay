/**
 * Text lookup. Every player-facing string lives in lang/en.json and is read through t().
 *
 * Inside Foundry, t() uses game.i18n, so translations in other languages work.
 * Outside Foundry (the automated tests) there is no game.i18n, so t() reads from a
 * table that the tests load from lang/en.json with setFallbackStrings().
 * An unknown key returns the key itself, which makes a missing string easy to spot.
 */
let fallback = {};

/** Tests only: provide the English table (flat "KEY": "text" pairs). */
export function setFallbackStrings(table) {
  fallback = { ...table };
}

/**
 * @param {string} key   a key from lang/en.json
 * @param {object} [data] values for {placeholders} in the text
 */
export function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key)) return data ? i18n.format(key, data) : i18n.localize(key);
  const text = fallback[key];
  if (text === undefined) return key;
  return data ? text.replace(/\{(\w+)\}/g, (m, name) => (name in data ? String(data[name]) : m)) : text;
}
