import { planPayment } from "../core/coins.mjs";

/**
 * dnd5e adapter. Everything that touches Foundry or the system's data model
 * for currency lives here, so other systems can be added as sibling files.
 */

// Used only if CONFIG.DND5E.currencies is missing or has no usable `conversion` values.
const FALLBACK = {
  pp: { value: 1000, abbreviation: "pp" },
  gp: { value: 100, abbreviation: "gp" },
  ep: { value: 50, abbreviation: "ep" },
  sp: { value: 10, abbreviation: "sp" },
  cp: { value: 1, abbreviation: "cp" },
};

/**
 * Denominations as { key, label, abbreviation, value, noChange }, largest first.
 * `value` is in the smallest coin unit. dnd5e's `conversion` is "coins per gp",
 * so the coin with the largest conversion is the smallest unit.
 * @param {object} [opts]
 * @param {string[]} [opts.hidden] keys to filter out completely
 */
export function getDenominations({ hidden = [] } = {}) {
  const cfg = CONFIG.DND5E?.currencies ?? {};
  const keys = Object.keys(cfg);
  const usable = keys.length && keys.every((k) => Number(cfg[k]?.conversion) > 0);

  let list;
  if (usable) {
    const maxConv = Math.max(...keys.map((k) => Number(cfg[k].conversion)));
    list = keys.map((k) => ({
      key: k,
      label: game.i18n.localize(cfg[k].label ?? k),
      abbreviation: game.i18n.localize(cfg[k].abbreviation ?? k),
      value: Math.max(1, Math.round(maxConv / Number(cfg[k].conversion))),
    }));
  } else {
    list = Object.entries(FALLBACK).map(([k, v]) => ({ key: k, label: k, ...v }));
  }

  // Electrum is awkward as change ("here's 1 ep"), so only hand it back as a last resort
  for (const d of list) d.noChange = d.key === "ep";

  return list
    .filter((d) => !hidden.includes(d.key))
    .sort((a, b) => b.value - a.value);
}

/** Is this document something that holds coins? (an actor, or a container item) */
export function holdsCurrency(doc) {
  if (!doc || typeof doc.system?.currency !== "object" || doc.system.currency === null) return false;
  if (doc.documentName === "Item") return doc.type === "container";
  return doc.documentName === "Actor";
}

/** Coin balance for every denomination the system defines, as plain numbers. */
export function getBalance(doc) {
  const cur = doc.system?.currency ?? {};
  const out = {};
  for (const k of Object.keys(CONFIG.DND5E?.currencies ?? FALLBACK)) {
    out[k] = Math.max(0, Math.floor(Number(cur[k]) || 0));
  }
  return out;
}

/** Dry run: what would paying `amount` from `doc` do? Never writes anything. */
export function quote(doc, amount, { hidden = [] } = {}) {
  const denoms = getDenominations({ hidden });
  return { denoms, plan: planPayment(getBalance(doc), amount, denoms) };
}

/**
 * Apply a coin delta to a document. GM client only: players cannot write to
 * documents they don't own, so this is called from the GM-side executor.
 * Returns false (and writes nothing) if any coin would go below zero.
 */
export async function commit(doc, delta) {
  const current = getBalance(doc);
  const update = {};
  for (const [k, n] of Object.entries(delta)) {
    if (!n) continue;
    if (!(k in current)) return false;
    const next = current[k] + n;
    if (next < 0) return false;
    update[`system.currency.${k}`] = next;
  }
  if (!Object.keys(update).length) return true;
  await doc.update(update);
  return true;
}
