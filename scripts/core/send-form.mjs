/**
 * Pure helpers for the send dialog. No Foundry globals.
 */
import { applyDelta, formatAmount } from "./coins.mjs";

/**
 * Turn raw input values ("", "3", " 2 ") into an amount object.
 * Blank means zero. Anything that isn't a whole number from 0 up is an error.
 * @param {Record<string,string|number|null|undefined>} raw  keyed by denomination
 * @returns {{ok:true, amount:object, empty:boolean} | {ok:false, error:string}}
 */
export function parseAmounts(raw) {
  const amount = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const text = String(value ?? "").trim();
    if (text === "") continue;
    if (!/^\d+$/.test(text)) return { ok: false, error: "Amounts must be whole numbers." };
    const n = Number(text);
    if (!Number.isSafeInteger(n)) return { ok: false, error: "That amount is too large." };
    if (n > 0) amount[key] = n;
  }
  return { ok: true, amount, empty: Object.keys(amount).length === 0 };
}

/** "You hold: 16 gp, 5 sp" or "nothing". */
export function balanceText(balance, denoms) {
  return formatAmount(balance ?? {}, denoms);
}

/**
 * What the dialog says under the amounts, from a payment plan.
 * @param {object} plan   result of planPayment / adapter quote().plan
 * @param {object} balance the payer's current balance
 * @returns {{ok:boolean, lines:string[]}}
 */
export function previewLines(plan, balance, denoms) {
  if (!plan?.ok) return { ok: false, lines: [plan?.reason ?? "That amount can't be paid."] };
  const lines = [`Pays ${formatAmount(plan.spend, denoms)}`];
  const hasChange = Object.values(plan.change ?? {}).some((n) => n > 0);
  if (hasChange) lines.push(`Change back: ${formatAmount(plan.change, denoms)}`);
  lines.push(`Recipient gets ${formatAmount(plan.receive, denoms)}`);
  const after = applyDelta(balance, plan.delta);
  if (after) lines.push(`Left afterwards: ${formatAmount(after, denoms)}`);
  return { ok: true, lines };
}

/** What a GM minting coins sees instead of a payment plan. */
export function mintLines(amount, denoms) {
  return { ok: true, lines: [`Creates ${formatAmount(amount, denoms)} from nowhere`] };
}

/** One sentence for the toast after the engine answers. */
export function resultMessage(res, recipientName = "the recipient") {
  if (!res?.ok) return { type: "warn", text: res?.error ?? "That didn't work." };
  if (res.status === "pending") return { type: "info", text: `Waiting for ${recipientName} to accept.` };
  return { type: "info", text: "Done." };
}
