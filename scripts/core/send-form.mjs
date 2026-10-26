/**
 * Pure helpers for the send dialog. No Foundry globals.
 */
import { applyDelta, formatAmount } from "./coins.mjs";
import { t } from "../i18n.mjs";

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
    if (!/^\d+$/.test(text)) return { ok: false, error: t("QUICKPAY.err.amountsWholeNumbers") };
    const n = Number(text);
    if (!Number.isSafeInteger(n)) return { ok: false, error: t("QUICKPAY.err.amountTooLarge") };
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
export function previewLines(plan, balance, denoms, { count = 1, each = null } = {}) {
  if (!plan?.ok) return { ok: false, lines: [plan?.reason ?? t("QUICKPAY.send.cantPay")] };
  const lines = [t("QUICKPAY.send.pays", { amount: formatAmount(plan.spend, denoms) })];
  const hasChange = Object.values(plan.change ?? {}).some((n) => n > 0);
  if (hasChange) lines.push(t("QUICKPAY.send.changeBack", { amount: formatAmount(plan.change, denoms) }));
  lines.push(
    count > 1
      ? t("QUICKPAY.send.eachGets", { count, amount: formatAmount(each ?? plan.receive, denoms) })
      : t("QUICKPAY.send.recipientGets", { amount: formatAmount(plan.receive, denoms) }),
  );
  const after = applyDelta(balance, plan.delta);
  if (after) lines.push(t("QUICKPAY.send.leftAfterwards", { amount: formatAmount(after, denoms) }));
  return { ok: true, lines };
}

/** What a GM minting coins sees instead of a payment plan. */
export function mintLines(amount, denoms) {
  return { ok: true, lines: [t("QUICKPAY.send.creates", { amount: formatAmount(amount, denoms) })] };
}

/** One sentence for the toast after the engine answers. */
export function resultMessage(res, recipientName = t("QUICKPAY.send.theRecipient")) {
  if (!res?.ok) return { type: "warn", text: res?.error ?? t("QUICKPAY.err.didntWork") };
  if (res.status === "pending") return { type: "info", text: t("QUICKPAY.send.waitingFor", { name: recipientName }) };
  if (res.status === "approval") return { type: "info", text: t("QUICKPAY.send.waitingForGm") };
  return { type: "info", text: t("QUICKPAY.send.done") };
}

/** The amount multiplied for a number of recipients. */
export function scaleAmount(amount, count) {
  return Object.fromEntries(Object.entries(amount).map(([k, n]) => [k, n * count]));
}

/** One sentence after a send to several recipients. */
export function resultManyMessage(res) {
  if (!res?.ok) return { type: "warn", text: res?.error ?? t("QUICKPAY.err.didntWork") };
  const results = res.results ?? [];
  const waiting = results.filter((r) => r.status === "pending").length;
  const approval = results.filter((r) => r.status === "approval").length;
  const text =
    t(res.done === 1 ? "QUICKPAY.send.sentOne" : "QUICKPAY.send.sentMany", { count: res.done }) +
    (waiting ? ` ${t("QUICKPAY.send.nWaitingAccept", { count: waiting })}` : "") +
    (approval ? ` ${t("QUICKPAY.send.nWaitingApproval", { count: approval })}` : "");
  return { type: "info", text };
}
