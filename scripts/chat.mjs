import { MODULE_ID } from "./constants.mjs";
import { getDenominations } from "./adapters/dnd5e.mjs";
import {
  resolvedHTML, settledHTML, pendingCardHTML, senderCardHTML, maskedPendingCardHTML, maskedSettledHTML,
  resultAudience, recipientPrompts, senderCardAudience,
} from "./core/format.mjs";
import { nameOfLedger, whenText } from "./ledger.mjs";
import { callGM } from "./socket.mjs";

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

const post = (content, whisper, transferId, role, masked = false) =>
  ChatMessage.create({
    content,
    ...(whisper ? { whisper } : {}),
    flags: { [MODULE_ID]: { transferId, role, masked } },
  });

async function onPending(record) {
  try {
    const ctx = context(record);
    for (const { to, masked } of recipientPrompts(record, ctx)) {
      await post(masked ? maskedPendingCardHTML(record, ctx) : pendingCardHTML(record, ctx), to, record.id, "pending", masked);
    }
    const senderTo = senderCardAudience(record, ctx);
    if (senderTo) await post(senderCardHTML(record, ctx), senderTo, record.id, "pending");
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
    await post(resolvedHTML(record, ctx), resultAudience(record, ctx), record.id, "result");
  } catch (err) {
    console.error(`${MODULE_ID} | could not post the result card`, err);
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
      if (!["accept", "decline", "cancel"].includes(action) || !id) return;
      root.querySelectorAll("button[data-quickpay-action]").forEach((b) => (b.disabled = true));
      const res = await callGM(action, id);
      if (!res?.ok) {
        if (!res?.offline) ui.notifications.warn(res?.error ?? "That didn't work.");
        root.querySelectorAll("button[data-quickpay-action]").forEach((b) => (b.disabled = false));
      }
    });
  });
}

export function initChat() {
  Hooks.on(`${MODULE_ID}.transferPending`, onPending);
  Hooks.on(`${MODULE_ID}.transferResolved`, onResolved);
  Hooks.on("renderChatMessageHTML", bindCard);
}
