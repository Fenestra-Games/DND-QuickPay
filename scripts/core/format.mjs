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

const COIN = '<i class="fa-solid fa-coins quickpay-gold"></i> ';
const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => MAP[c]);

const b = (s) => `<strong>${esc(s)}</strong>`;
const amt = (r, ctx) => b(formatAmount(r.amount ?? {}, ctx.denoms ?? []));
const noteHTML = (r) => (r.note ? `<div class="quickpay-note">&ldquo;${esc(r.note)}&rdquo;</div>` : "");
const ledgerHTML = (r, ctx) =>
  r.ledgerId && ctx.ledgerName ? `<div class="quickpay-ledger">Ledger: ${esc(ctx.ledgerName)}</div>` : "";

const button = (action, id, label, extra = "") =>
  `<button type="button" class="quickpay-btn" data-quickpay-action="${esc(action)}" data-transfer="${esc(id)}"${extra}>${esc(label)}</button>`;

const returned = (r) => {
  if (!r.sender) return "";
  return r.refunded === false
    ? " The coins couldn't be returned."
    : ` The coins went back to ${b(r.sender.name)}.`;
};

/** One sentence describing how a transfer ended. */
export function resolvedLine(r, ctx) {
  const from = r.sender?.name;
  const to = r.recipient?.name;
  switch (r.status) {
    case "completed":
      if (!from) return `${amt(r, ctx)} was created for ${b(to)}.`;
      if (!to) return `${b(from)} lost ${amt(r, ctx)} (removed from play).`;
      return `${b(from)} paid ${amt(r, ctx)} to ${b(to)}.${r.resolution === "accepted-by-gm" ? " <em>(accepted by the GM)</em>" : ""}`;
    case "declined":
      return `${b(to)} declined ${amt(r, ctx)}${from ? ` from ${b(from)}` : ""}.${returned(r)}`;
    case "expired":
      return `The transfer of ${amt(r, ctx)} ${from ? `from ${b(from)} ` : ""}to ${b(to)} expired.${returned(r)}`;
    case "cancelled":
      if (r.resolution === "recipient-missing") {
        return `${b(to)} no longer exists, so the transfer of ${amt(r, ctx)} was cancelled.${returned(r)}`;
      }
      return `The transfer of ${amt(r, ctx)} ${from ? `from ${b(from)} ` : ""}to ${b(to)} was cancelled.${returned(r)}`;
    default:
      return `${b(from ?? "nowhere")} to ${b(to ?? "nowhere")}: ${esc(r.status)}`;
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
    `Someone wants to give ${b(r.recipient?.name)} ${amt(r, ctx)}.` +
    (ctx.expiresText ? `<div class="quickpay-expiry">Expires ${esc(ctx.expiresText)}</div>` : "") +
    `<div class="quickpay-buttons">` +
    button("accept", r.id, "Accept") +
    button("decline", r.id, "Decline") +
    `</div></div>`
  );
}

/** What a masked prompt turns into once the transfer has ended. */
export function maskedSettledHTML(r, ctx) {
  const word = { completed: "was accepted", declined: "was declined", expired: "expired", cancelled: "was cancelled" }[r.status] ?? esc(r.status);
  return `<div class="quickpay-card quickpay-settled quickpay-${esc(r.status)}">` + COIN + `The transfer of ${amt(r, ctx)} to ${b(r.recipient?.name)} ${word}.</div>`;
}

/** Card shown to the recipient's owners and the GM when acceptance is needed. */
export function pendingCardHTML(r, ctx) {
  const from = r.sender?.name ?? "The GM";
  return (
    `<div class="quickpay-card quickpay-pending">` + COIN +
    `${b(from)} wants to give ${b(r.recipient?.name)} ${amt(r, ctx)}.` +
    noteHTML(r) +
    ledgerHTML(r, ctx) +
    (ctx.expiresText ? `<div class="quickpay-expiry">Expires ${esc(ctx.expiresText)}</div>` : "") +
    `<div class="quickpay-buttons">` +
    button("accept", r.id, "Accept") +
    button("decline", r.id, "Decline") +
    button("cancel", r.id, "Cancel (GM)", " data-gm-only") +
    `</div></div>`
  );
}

/** Card shown to the sender while they wait. */
export function senderCardHTML(r, ctx) {
  return (
    `<div class="quickpay-card quickpay-pending">` + COIN +
    `Waiting for ${b(r.recipient?.name)} to accept ${amt(r, ctx)}.` +
    noteHTML(r) +
    (ctx.expiresText ? `<div class="quickpay-expiry">Expires ${esc(ctx.expiresText)}</div>` : "") +
    `<div class="quickpay-buttons">${button("cancel", r.id, "Cancel")}</div></div>`
  );
}

// ---- audiences ---------------------------------------------------------------
const uniq = (list) => [...new Set(list.filter(Boolean))];

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
