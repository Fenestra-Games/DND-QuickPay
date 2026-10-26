import { MODULE_ID } from "./constants.mjs";
import { getDenominations } from "./adapters/dnd5e.mjs";
import {
  resolvedHTML, settledHTML, pendingCardHTML, senderCardHTML, maskedPendingCardHTML, maskedSettledHTML,
  approvalCardHTML, senderApprovalCardHTML, approvedSettledHTML,
  resultAudience, recipientPrompts, senderCardAudience,
} from "./core/format.mjs";
import { formatAmount } from "./core/coins.mjs";
import { worldOptions, playerOptions } from "./options-store.mjs";
import { nameOfLedger, whenText } from "./ledger.mjs";
import { callGM } from "./socket.mjs";
import { t } from "./i18n.mjs";

/**
 * Chat cards. Posting happens on the GM client that processed the transfer (that is the
 * only client the engine's events fire on), so each card is created exactly once.
 * Every card carries flags.dnd-quickpay.transferId so it can be found and updated later.
 */
const gmIds = () => game.users.contents.filter((u) => u.isGM).map((u) => u.id);

function recipientOwnerIds(record) {
  try {
    const doc = record.recipient?.uuid ? fromUuidSync(record.recipient.uuid) : null;
    if (!doc) return [];
    return game.users.contents.filter((u) => !u.isGM && doc.testUserPermission(u, "OWNER")).map((u) => u.id);
  } catch {
    return [];
  }
}

function context(record) {
  return {
    denoms: getDenominations({ hidden: [] }),
    ledgerName: record.ledgerId ? nameOfLedger(record.ledgerId) : null,
    expiresText: record.expiresAt != null ? `at ${whenText(record.expiresAt)}` : "",
    gmIds: gmIds(),
    recipientOwnerIds: recipientOwnerIds(record),
  };
}

const post = (content, whisper, transferId, role, masked = false, extra = {}) =>
  ChatMessage.create({
    content,
    ...(whisper ? { whisper } : {}),
    flags: { [MODULE_ID]: { transferId, role, masked, ...extra } },
  });

async function onPending(record) {
  try {
    const ctx = context(record);
    for (const { to, masked } of recipientPrompts(record, ctx)) {
      await post(masked ? maskedPendingCardHTML(record, ctx) : pendingCardHTML(record, ctx), to, record.id, "pending", masked);
    }
    const senderTo = senderCardAudience(record, ctx);
    if (senderTo && worldOptions().waitingCard) await post(senderCardHTML(record, ctx), senderTo, record.id, "pending");
  } catch (err) {
    console.error(`${MODULE_ID} | could not post pending cards`, err);
  }
}

async function onResolved(record) {
  try {
    const ctx = context(record);
    // Turn any open prompts for this transfer into plain text without buttons
    const open = game.messages.filter(
      (m) => m.getFlag(MODULE_ID, "transferId") === record.id && m.getFlag(MODULE_ID, "role") === "pending",
    );
    for (const m of open) await m.update({ content: m.getFlag(MODULE_ID, "masked") ? maskedSettledHTML(record, ctx) : settledHTML(record, ctx), "flags.dnd-quickpay.role": "settled" });
    await post(resolvedHTML(record, ctx), resultAudience(record, ctx), record.id, "result", false, {
      completed: record.status === "completed",
      recipientUuid: record.recipient?.uuid ?? null,
      initiatedBy: record.initiatedBy,
      amountText: formatAmount(record.amount ?? {}, ctx.denoms),
    });
  } catch (err) {
    console.error(`${MODULE_ID} | could not post the result card`, err);
  }
}

async function onApproval(record) {
  try {
    const ctx = context(record);
    await post(approvalCardHTML(record, ctx), ctx.gmIds, record.id, "pending");
    if (!ctx.gmIds.includes(record.initiatedBy) && worldOptions().waitingCard) {
      await post(senderApprovalCardHTML(record, ctx), [record.initiatedBy], record.id, "pending");
    }
  } catch (err) {
    console.error(`${MODULE_ID} | could not post approval cards`, err);
  }
}

async function onApprovalClosed(record) {
  try {
    const ctx = context(record);
    const open = game.messages.filter(
      (m) => m.getFlag(MODULE_ID, "transferId") === record.id && m.getFlag(MODULE_ID, "role") === "pending",
    );
    for (const m of open) await m.update({ content: approvedSettledHTML(record, ctx), "flags.dnd-quickpay.role": "settled" });
  } catch (err) {
    console.error(`${MODULE_ID} | could not settle approval cards`, err);
  }
}

/** On the recipient's own client: a short notice when coins arrive. Only for cards they can see. */
function notifyArrival(message) {
  const f = message.flags?.[MODULE_ID];
  if (!f || f.role !== "result" || !f.completed || !f.recipientUuid) return;
  if (game.user.isGM || f.initiatedBy === game.user.id || !message.visible) return;
  if (!playerOptions().notifyOnReceive) return;
  try {
    const doc = fromUuidSync(f.recipientUuid);
    if (doc?.testUserPermission(game.user, "OWNER")) ui.notifications.info(t("QUICKPAY.notice.received", { name: doc.name, amount: f.amountText }));
  } catch {
    /* not a document this client can resolve */
  }
}

/** Wire up buttons on rendered cards (runs on every client). */
function bindCard(message, html) {
  if (!message.getFlag(MODULE_ID, "transferId")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (!game.user.isGM) root.querySelectorAll("[data-gm-only]").forEach((el) => el.remove());
  root.querySelectorAll("button[data-quickpay-action]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const action = btn.dataset.quickpayAction;
      const id = btn.dataset.transfer;
      if (!["accept", "decline", "cancel", "approve", "deny"].includes(action) || !id) return;
      root.querySelectorAll("button[data-quickpay-action]").forEach((b) => (b.disabled = true));
      const res = await callGM(action, id);
      if (!res?.ok) {
        if (!res?.offline) ui.notifications.warn(res?.error ?? t("QUICKPAY.err.didntWork"));
        root.querySelectorAll("button[data-quickpay-action]").forEach((b) => (b.disabled = false));
      }
    });
  });
}

export function initChat() {
  Hooks.on(`${MODULE_ID}.transferPending`, onPending);
  Hooks.on(`${MODULE_ID}.transferResolved`, onResolved);
  Hooks.on(`${MODULE_ID}.transferApproval`, onApproval);
  Hooks.on(`${MODULE_ID}.transferApprovalClosed`, onApprovalClosed);
  Hooks.on("createChatMessage", notifyArrival);
  Hooks.on("renderChatMessageHTML", bindCard);
}
