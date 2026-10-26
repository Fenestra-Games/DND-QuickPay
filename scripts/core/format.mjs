/**
 * Chat card text and audiences. Pure functions: no Foundry globals.
 *
 * Anything a player can type (notes, and names via their own actors) is escaped here,
 * because the cards are written to chat as HTML.
 *
 * ctx = {
 *   denoms,            // for formatting amounts
 *   ledgerName,        // name of record.ledgerId, if any
 *   expiresText,       // formatted expiry time for pending cards
 *   gmIds,             // every GM user id
 *   recipientOwnerIds  // non-GM users who own the recipient
 * }
 */
import { formatAmount } from "./coins.mjs";
import { t } from "../i18n.mjs";

const COIN = '<i class="fa-solid fa-coins quickpay-gold"></i> ';
const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => MAP[c]);

const b = (s) => `<strong>${esc(s)}</strong>`;
const amt = (r, ctx) => b(formatAmount(r.amount ?? {}, ctx.denoms ?? []));
const noteHTML = (r) => (r.note ? `<div class="quickpay-note">&ldquo;${esc(r.note)}&rdquo;</div>` : "");
const ledgerHTML = (r, ctx) =>
  r.ledgerId && ctx.ledgerName ? `<div class="quickpay-ledger">${esc(t("QUICKPAY.card.ledger", { name: ctx.ledgerName }))}</div>` : "";

const button = (action, id, label, extra = "") =>
  `<button type="button" class="quickpay-btn" data-quickpay-action="${esc(action)}" data-transfer="${esc(id)}"${extra}>${esc(label)}</button>`;

const returned = (r) => {
  if (!r.sender || r.request) return ""; // no sender, or an approval request that never took any coins
  return r.refunded === false
    ? ` ${t("QUICKPAY.card.coinsNotReturned")}`
    : ` ${t("QUICKPAY.card.coinsBack", { name: b(r.sender.name) })}`;
};

/** One sentence describing how a transfer ended. */
export function resolvedLine(r, ctx) {
  const from = r.sender?.name;
  const to = r.recipient?.name;
  switch (r.status) {
    case "completed":
      if (!from) return t("QUICKPAY.card.created", { amount: amt(r, ctx), to: b(to) });
      if (!to) return t("QUICKPAY.card.lost", { from: b(from), amount: amt(r, ctx) });
      return t("QUICKPAY.card.paid", { from: b(from), amount: amt(r, ctx), to: b(to) }) + (r.resolution === "accepted-by-gm" ? ` <em>${t("QUICKPAY.card.acceptedByGm")}</em>` : "");
    case "declined":
      return (from ? t("QUICKPAY.card.declinedFrom", { to: b(to), amount: amt(r, ctx), from: b(from) }) : t("QUICKPAY.card.declined", { to: b(to), amount: amt(r, ctx) })) + returned(r);
    case "expired":
      return (from ? t("QUICKPAY.card.expiredFrom", { amount: amt(r, ctx), from: b(from), to: b(to) }) : t("QUICKPAY.card.expired", { amount: amt(r, ctx), to: b(to) })) + returned(r);
    case "cancelled":
      if (r.resolution === "recipient-missing") {
        return t("QUICKPAY.card.cancelledMissing", { to: b(to), amount: amt(r, ctx) }) + returned(r);
      }
      return (from ? t("QUICKPAY.card.cancelledFrom", { amount: amt(r, ctx), from: b(from), to: b(to) }) : t("QUICKPAY.card.cancelled", { amount: amt(r, ctx), to: b(to) })) + returned(r);
    case "denied":
      return from ? t("QUICKPAY.card.denied", { from: b(from), amount: amt(r, ctx), to: b(to) }) : t("QUICKPAY.card.deniedNoSender", { amount: amt(r, ctx), to: b(to) });
    default:
      return t("QUICKPAY.card.other", { from: b(from ?? t("QUICKPAY.card.nowhere")), to: b(to ?? t("QUICKPAY.card.nowhere")), status: esc(r.status) });
  }
}

/** The result message posted when a transfer ends. */
export function resolvedHTML(r, ctx) {
  return `<div class="quickpay-card quickpay-${esc(r.status)}">` + COIN + `${resolvedLine(r, ctx)}${noteHTML(r)}${ledgerHTML(r, ctx)}</div>`;
}

/** What a pending card turns into once the transfer has ended (no buttons). */
export function settledHTML(r, ctx) {
  return `<div class="quickpay-card quickpay-settled quickpay-${esc(r.status)}">` + COIN + `${resolvedLine(r, ctx)}</div>`;
}

/** Prompt for a recipient's owners when the transfer is GM-only: no sender, no note, no ledger. */
export function maskedPendingCardHTML(r, ctx) {
  return (
    `<div class="quickpay-card quickpay-pending">` + COIN +
    t("QUICKPAY.card.maskedWants", { to: b(r.recipient?.name), amount: amt(r, ctx) }) +
    (ctx.expiresText ? `<div class="quickpay-expiry">${esc(t("QUICKPAY.card.expires", { time: ctx.expiresText }))}</div>` : "") +
    `<div class="quickpay-buttons">` +
    button("accept", r.id, t("QUICKPAY.btn.accept")) +
    button("decline", r.id, t("QUICKPAY.btn.decline")) +
    `</div></div>`
  );
}

/** What a masked prompt turns into once the transfer has ended. */
export function maskedSettledHTML(r, ctx) {
  const key = { completed: "maskedAccepted", declined: "maskedDeclined", expired: "maskedExpired", cancelled: "maskedCancelled" }[r.status];
  const data = { amount: amt(r, ctx), to: b(r.recipient?.name) };
  const text = key ? t(`QUICKPAY.card.${key}`, data) : t("QUICKPAY.card.maskedOther", { ...data, status: esc(r.status) });
  return `<div class="quickpay-card quickpay-settled quickpay-${esc(r.status)}">` + COIN + text + `</div>`;
}

/** Card shown to the recipient's owners and the GM when acceptance is needed. */
export function pendingCardHTML(r, ctx) {
  const from = r.sender?.name ?? t("QUICKPAY.card.theGm");
  return (
    `<div class="quickpay-card quickpay-pending">` + COIN +
    t("QUICKPAY.card.wants", { from: b(from), to: b(r.recipient?.name), amount: amt(r, ctx) }) +
    noteHTML(r) +
    ledgerHTML(r, ctx) +
    (ctx.expiresText ? `<div class="quickpay-expiry">${esc(t("QUICKPAY.card.expires", { time: ctx.expiresText }))}</div>` : "") +
    `<div class="quickpay-buttons">` +
    button("accept", r.id, t("QUICKPAY.btn.accept")) +
    button("decline", r.id, t("QUICKPAY.btn.decline")) +
    button("cancel", r.id, t("QUICKPAY.btn.cancelGm"), " data-gm-only") +
    `</div></div>`
  );
}

/** Card shown to the sender while they wait. */
export function senderCardHTML(r, ctx) {
  return (
    `<div class="quickpay-card quickpay-pending">` + COIN +
    t("QUICKPAY.card.waiting", { to: b(r.recipient?.name), amount: amt(r, ctx) }) +
    noteHTML(r) +
    (ctx.expiresText ? `<div class="quickpay-expiry">${esc(t("QUICKPAY.card.expires", { time: ctx.expiresText }))}</div>` : "") +
    `<div class="quickpay-buttons">${button("cancel", r.id, t("QUICKPAY.btn.cancel"))}</div></div>`
  );
}

// ---- audiences ---------------------------------------------------------------
const uniq = (list) => [...new Set(list.filter(Boolean))];

/** Card for the GMs when a transfer needs their approval. */
export function approvalCardHTML(r, ctx) {
  return (
    `<div class="quickpay-card quickpay-pending">` + COIN +
    t("QUICKPAY.card.asks", { from: b(r.sender?.name), amount: amt(r, ctx), to: b(r.recipient?.name) }) +
    noteHTML(r) +
    ledgerHTML(r, ctx) +
    (ctx.expiresText ? `<div class="quickpay-expiry">${esc(t("QUICKPAY.card.expires", { time: ctx.expiresText }))}</div>` : "") +
    `<div class="quickpay-buttons">` +
    button("approve", r.id, t("QUICKPAY.btn.approve")) +
    button("deny", r.id, t("QUICKPAY.btn.deny")) +
    `</div></div>`
  );
}

/** Card for the sender while a GM decides. */
export function senderApprovalCardHTML(r, ctx) {
  return (
    `<div class="quickpay-card quickpay-pending">` + COIN +
    t("QUICKPAY.card.waitingApproval", { amount: amt(r, ctx), to: b(r.recipient?.name) }) +
    noteHTML(r) +
    (ctx.expiresText ? `<div class="quickpay-expiry">${esc(t("QUICKPAY.card.expires", { time: ctx.expiresText }))}</div>` : "") +
    `<div class="quickpay-buttons">${button("cancel", r.id, t("QUICKPAY.btn.cancel"))}</div></div>`
  );
}

/** What an approval card turns into once the GM has approved (the transfer then posts its own card). */
export function approvedSettledHTML(r, ctx) {
  return `<div class="quickpay-card quickpay-settled quickpay-completed">` + COIN + t("QUICKPAY.card.approved", { amount: amt(r, ctx), to: b(r.recipient?.name) }) + `</div>`;
}

/** Whisper list for the result message. null means everyone (public). */
export function resultAudience(r, ctx) {
  if (r.visibility === "gm") return uniq([...ctx.gmIds, r.initiatedBy]);
  if (r.visibility === "gm-recipient") return uniq([...ctx.gmIds, r.initiatedBy, ...ctx.recipientOwnerIds]);
  return null;
}

/**
 * The acceptance prompts to post: [{ to: [userIds], masked }]. GM-only transfers show the
 * recipient's owners a masked prompt (except one who started it) and the GMs the full one.
 */
export function recipientPrompts(r, ctx) {
  if (r.visibility !== "gm") return [{ to: recipientCardAudience(ctx), masked: false }];
  const owners = ctx.recipientOwnerIds.filter((id) => id !== r.initiatedBy);
  const out = [{ to: uniq([...ctx.gmIds, ...ctx.recipientOwnerIds.filter((id) => id === r.initiatedBy)]), masked: false }];
  if (owners.length) out.push({ to: owners, masked: true });
  return out;
}

/** Whisper list for the acceptance prompt. Always the recipient's owners plus GMs. */
export function recipientCardAudience(ctx) {
  return uniq([...ctx.gmIds, ...ctx.recipientOwnerIds]);
}

/** Whisper list for the sender's waiting card, or null to skip it (a GM already sees the other card). */
export function senderCardAudience(r, ctx) {
  return ctx.gmIds.includes(r.initiatedBy) ? null : [r.initiatedBy];
}
