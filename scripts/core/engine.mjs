/**
 * Transfer engine. Runs on the GM client only.
 *
 * It has no Foundry globals. Everything it needs comes in through `deps`, so
 * the full escrow flow is tested in Node with fake documents.
 *
 * deps = {
 *   docs:  { resolve(uuid), uuid(doc), name(doc), kind(doc) -> "actor"|"container",
 *            userExists(id), userName(id), isGM(id), userOwns(id, doc),
 *            isPlayerOwned(actor), acceptanceFlag(actor), isPublic(container) },
 *   coins: { getDenominations({hidden}), getBalance(doc), commit(doc, delta), holdsCurrency(doc) },
 *   store: { loadPending(), savePending(obj), appendLog(record), findLog(id), updateLog(id, patch) },
 *   ledgers: { canUse(userId, ledgerId), canCreate(userId), create(name, userId, options),
 *              record(record), reconcile(oldRecord, newRecord) },
 *   personal: optional { record(record), reconcile(oldRecord, newRecord) } for personal ledgers,
 *             called for every ended transfer whatever its ledger tag,
 *   settings: { expiryHours(), hidden(), defaultVisibility() },
 *   now(),            // in-world time in seconds
 *   newId(),
 *   emit(name, record)
 * }
 *
 * Money rules:
 *  - The sender is debited first (escrow). The recipient is only credited on
 *    completion. Decline, expiry and cancel return the escrow to the sender.
 *  - Every step is serialised, so two requests can never spend the same coins.
 *  - If a credit fails after a debit, the debit is rolled back.
 *  - Ledgers are bookkeeping only. If writing a ledger fails, the transfer still stands.
 */

import { planPayment, normalizeAmount, applyDelta, invertDelta } from "./coins.mjs";

export const STATUS = Object.freeze({
  PENDING: "pending",
  COMPLETED: "completed",
  DECLINED: "declined",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

export const VISIBILITY = Object.freeze(["public", "gm-recipient", "gm"]);

const NOTE_MAX = 500;
const LEDGER_NAME_MAX = 60;
const RECORD_VERSION = 1;

const ok = (extra = {}) => ({ ok: true, ...extra });
const no = (error, extra = {}) => ({ ok: false, error, ...extra });

export function createEngine(deps) {
  const { docs, coins, store, ledgers, settings, now, newId, emit } = deps;
  const personal = deps.personal ?? null;

  // ---- serialisation -------------------------------------------------------
  let chain = Promise.resolve();
  const serialize = (fn) => {
    const run = chain.then(() => fn());
    chain = run.catch(() => {});
    return run;
  };

  const denoms = () => coins.getDenominations({ hidden: settings.hidden() });

  // ---- input ---------------------------------------------------------------
  const cleanNote = (v) => (typeof v === "string" ? v.trim().slice(0, NOTE_MAX) : "");
  const cleanLedgerId = (v) => (typeof v === "string" && v ? v.slice(0, 64) : null);

  function sanitize(input) {
    if (!input || typeof input !== "object") return { error: "Invalid request." };
    const uuidOrNull = (v) => (v == null || v === "" ? null : typeof v === "string" ? v : undefined);
    const senderUuid = uuidOrNull(input.senderUuid);
    const recipientUuid = uuidOrNull(input.recipientUuid);
    if (senderUuid === undefined || recipientUuid === undefined) return { error: "Invalid target." };
    if (!senderUuid && !recipientUuid) return { error: "Choose a sender, a recipient, or both." };
    return {
      senderUuid,
      recipientUuid,
      amount: input.amount,
      note: cleanNote(input.note),
      visibility: VISIBILITY.includes(input.visibility) ? input.visibility : settings.defaultVisibility(),
      ledgerId: cleanLedgerId(input.ledgerId),
    };
  }

  function needsAcceptance(userId, recipient) {
    if (!recipient || docs.kind(recipient) !== "actor") return false; // containers and burns auto-accept
    if (!docs.isPlayerOwned(recipient)) return false; // GM-side actors auto-accept
    if (!docs.acceptanceFlag(recipient)) return false; // owner turned acceptance off
    if (!docs.isGM(userId) && docs.userOwns(userId, recipient)) return false; // your own actor
    return true;
  }

  // ---- bookkeeping ---------------------------------------------------------
  const ref = (doc) => (doc ? { uuid: docs.uuid(doc), name: docs.name(doc) } : null);

  /** Give the escrow back. Exact if possible, otherwise the escrowed coins themselves. */
  async function refundSender(record) {
    if (!record.sender) return true; // minted coins have no escrow
    const sender = await docs.resolve(record.sender.uuid);
    if (!sender || !coins.holdsCurrency(sender)) return false;
    const exact = invertDelta(record.escrow);
    const delta = applyDelta(coins.getBalance(sender), exact) ? exact : { ...record.amount };
    return coins.commit(sender, delta);
  }

  /** Close a record: take it out of the pending store, write it to the log and ledger, tell listeners. */
  async function finish(record, status, resolution, userId, extra = {}) {
    Object.assign(record, extra, {
      status,
      resolution,
      resolvedAt: now(),
      resolvedBy: userId ?? null,
    });
    const pend = await store.loadPending();
    if (record.id in pend) {
      delete pend[record.id];
      await store.savePending(pend);
    }
    await store.appendLog(record);
    if (record.ledgerId) {
      try {
        await ledgers.record(record);
      } catch (err) {
        console.error("dnd-quickpay | could not write to the ledger", err);
      }
    }
    if (personal) {
      try {
        await personal.record(record);
      } catch (err) {
        console.error("dnd-quickpay | could not write to a personal ledger", err);
      }
    }
    emit("transferResolved", record);
    return record;
  }

  async function closeWithRefund(record, status, resolution, userId) {
    const refunded = await refundSender(record);
    await finish(record, status, resolution, userId, { refunded });
    return refunded;
  }

  // ---- request -------------------------------------------------------------
  async function doRequest(userId, input) {
    if (!docs.userExists(userId)) return no("Couldn't identify who made this request.");
    const isGM = docs.isGM(userId);

    const clean = sanitize(input);
    if (clean.error) return no(clean.error);

    const sender = clean.senderUuid ? await docs.resolve(clean.senderUuid) : null;
    if (clean.senderUuid && !sender) return no("The sender could not be found.");
    const recipient = clean.recipientUuid ? await docs.resolve(clean.recipientUuid) : null;
    if (clean.recipientUuid && !recipient) return no("The recipient could not be found.");

    for (const d of [sender, recipient]) {
      if (d && !coins.holdsCurrency(d)) return no(`${docs.name(d)} can't hold coins.`);
    }
    if (sender && recipient && docs.uuid(sender) === docs.uuid(recipient)) {
      return no("The sender and the recipient are the same.");
    }

    // Default permission rules. The configurable matrix replaces this later.
    if (!isGM) {
      if (!sender) return no("Only a GM can create coins from nowhere.");
      if (!recipient) return no("Only a GM can send coins to nowhere.");
      if (!docs.userOwns(userId, sender)) return no(`You don't have permission over ${docs.name(sender)}.`);
      if (docs.kind(recipient) === "container" && !docs.isPublic(recipient) && !docs.userOwns(userId, recipient)) {
        return no(`${docs.name(recipient)} isn't accepting coins.`);
      }
    }

    // A ledger tag must point at a ledger this user is allowed to use
    if (clean.ledgerId && !(await ledgers.canUse(userId, clean.ledgerId))) {
      return no("You can't use that ledger, or it doesn't exist.");
    }

    // Work out the coins
    const d = denoms();
    let receive;
    let escrow = {};
    if (sender) {
      const plan = planPayment(coins.getBalance(sender), clean.amount, d);
      if (!plan.ok) return no(plan.reason);
      receive = plan.receive;
      escrow = plan.delta;
    } else {
      const norm = normalizeAmount(clean.amount, d);
      if (!norm.ok) return no(norm.reason);
      receive = norm.receive;
    }

    const pending = needsAcceptance(userId, recipient);
    const t = now();
    const record = {
      version: RECORD_VERSION,
      id: newId(),
      status: STATUS.PENDING,
      createdAt: t,
      createdReal: Date.now(),
      expiresAt: pending ? t + settings.expiryHours() * 3600 : null,
      initiatedBy: userId,
      initiatedByName: docs.userName(userId),
      sender: ref(sender),
      recipient: ref(recipient),
      amount: receive,
      escrow,
      note: clean.note,
      visibility: clean.visibility,
      ledgerId: clean.ledgerId,
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      refunded: null,
    };

    // 1. Escrow: take the coins from the sender
    if (sender && !(await coins.commit(sender, escrow))) {
      return no("The sender's coins changed before the transfer could go through. Try again.");
    }

    // 2a. Needs the recipient's say: park it
    if (pending) {
      try {
        const pend = await store.loadPending();
        pend[record.id] = record;
        await store.savePending(pend);
      } catch (err) {
        console.error("dnd-quickpay | could not save pending transfer", err);
        await refundSender(record);
        return no("Couldn't record the pending transfer, so nothing was taken.");
      }
      emit("transferPending", record);
      return ok({ status: STATUS.PENDING, record });
    }

    // 2b. Straight through: credit the recipient (a burn has none)
    if (recipient && !(await coins.commit(recipient, receive))) {
      const refunded = await refundSender(record);
      return no("The recipient couldn't receive the coins, so the transfer was undone.", { refunded });
    }
    await finish(record, STATUS.COMPLETED, recipient ? "auto" : "removed", userId, { refunded: null });
    return ok({ status: STATUS.COMPLETED, record });
  }

  // ---- resolving pending transfers ----------------------------------------
  async function getPending(id) {
    const pend = await store.loadPending();
    const record = pend[id];
    return record && record.status === STATUS.PENDING ? record : null;
  }

  async function doAccept(userId, id) {
    const record = await getPending(id);
    if (!record) return no("That transfer is no longer pending.");
    const isGM = docs.isGM(userId);

    const recipient = record.recipient ? await docs.resolve(record.recipient.uuid) : null;
    if (!recipient) {
      await closeWithRefund(record, STATUS.CANCELLED, "recipient-missing", userId);
      return no("The recipient no longer exists. The coins went back to the sender.");
    }
    if (!isGM && !docs.userOwns(userId, recipient)) return no("Only the recipient or a GM can accept this.");

    if (record.expiresAt != null && now() >= record.expiresAt) {
      await closeWithRefund(record, STATUS.EXPIRED, "expired", userId);
      return no("That transfer expired. The coins went back to the sender.");
    }
    if (!(await coins.commit(recipient, record.amount))) {
      return no("Couldn't add the coins to the recipient. The transfer is still pending.");
    }
    await finish(record, STATUS.COMPLETED, isGM ? "accepted-by-gm" : "accepted", userId, { refunded: null });
    return ok({ status: STATUS.COMPLETED, record });
  }

  async function doDecline(userId, id) {
    const record = await getPending(id);
    if (!record) return no("That transfer is no longer pending.");
    const isGM = docs.isGM(userId);
    const recipient = record.recipient ? await docs.resolve(record.recipient.uuid) : null;
    if (!isGM && !(recipient && docs.userOwns(userId, recipient))) {
      return no("Only the recipient or a GM can decline this.");
    }
    const refunded = await closeWithRefund(record, STATUS.DECLINED, isGM ? "declined-by-gm" : "declined", userId);
    return ok({ status: STATUS.DECLINED, record, refunded });
  }

  async function doCancel(userId, id) {
    const record = await getPending(id);
    if (!record) return no("That transfer is no longer pending.");
    const isGM = docs.isGM(userId);
    const sender = record.sender ? await docs.resolve(record.sender.uuid) : null;
    if (!isGM && !(sender && docs.userOwns(userId, sender))) {
      return no("Only the sender or a GM can cancel this.");
    }
    const refunded = await closeWithRefund(record, STATUS.CANCELLED, isGM ? "cancelled-by-gm" : "cancelled", userId);
    return ok({ status: STATUS.CANCELLED, record, refunded });
  }

  async function doExpireDue() {
    const t = now();
    const pend = await store.loadPending();
    let count = 0;
    for (const record of Object.values(pend)) {
      if (record.status === STATUS.PENDING && record.expiresAt != null && t >= record.expiresAt) {
        await closeWithRefund(record, STATUS.EXPIRED, "expired", null);
        count++;
      }
    }
    return count;
  }

  // ---- amending ------------------------------------------------------------
  /** Who may change the ledger tag or note of an existing transfer. */
  async function canAmend(userId, record) {
    if (docs.isGM(userId)) return true;
    if (record.initiatedBy === userId) return true;
    for (const side of [record.sender, record.recipient]) {
      if (!side) continue;
      const doc = await docs.resolve(side.uuid);
      if (doc && docs.userOwns(userId, doc)) return true;
    }
    return false;
  }

  async function doAmend(userId, id, patch) {
    if (!docs.userExists(userId)) return no("Couldn't identify who made this request.");
    if (typeof id !== "string" || !patch || typeof patch !== "object") return no("Invalid request.");

    const pend = await store.loadPending();
    const wasPending = id in pend;
    const before = wasPending ? structuredClone(pend[id]) : await store.findLog(id);
    if (!before) return no("That transfer couldn't be found.");
    if (!(await canAmend(userId, before))) return no("You can't change that transfer.");

    const next = {};
    if ("ledgerId" in patch) {
      const ledgerId = patch.ledgerId == null || patch.ledgerId === "" ? null : cleanLedgerId(patch.ledgerId);
      if (patch.ledgerId != null && patch.ledgerId !== "" && !ledgerId) return no("Invalid ledger.");
      if (ledgerId && !(await ledgers.canUse(userId, ledgerId))) {
        return no("You can't use that ledger, or it doesn't exist.");
      }
      if (ledgerId !== before.ledgerId) next.ledgerId = ledgerId;
    }
    if ("note" in patch) {
      if (typeof patch.note !== "string") return no("Invalid note.");
      const note = cleanNote(patch.note);
      if (note !== before.note) next.note = note;
    }
    if (!Object.keys(next).length) return no("Nothing to change.");

    let after;
    if (wasPending) {
      pend[id] = { ...pend[id], ...next };
      await store.savePending(pend);
      after = structuredClone(pend[id]);
    } else {
      after = await store.updateLog(id, next);
      if (!after) return no("That transfer couldn't be updated.");
    }

    let ledgerWarning = null;
    if (!wasPending && (before.ledgerId || after.ledgerId)) {
      try {
        await ledgers.reconcile(before, after);
      } catch (err) {
        console.error("dnd-quickpay | could not update the ledger", err);
        ledgerWarning = "The transfer was updated, but the ledger couldn't be.";
      }
    }
    if (!wasPending && personal && before.note !== after.note) {
      try {
        await personal.reconcile(before, after);
      } catch (err) {
        console.error("dnd-quickpay | could not update a personal ledger", err);
      }
    }
    emit("transferAmended", after);
    return ok({ record: after, ...(ledgerWarning ? { ledgerWarning } : {}) });
  }

  // ---- ledgers -------------------------------------------------------------
  async function doCreateLedger(userId, name, options) {
    if (!docs.userExists(userId)) return no("Couldn't identify who made this request.");
    if (!ledgers.canCreate(userId)) return no("You don't have permission to create ledgers.");
    const clean = typeof name === "string" ? name.trim().slice(0, LEDGER_NAME_MAX) : "";
    if (!clean) return no("A ledger needs a name.");
    const opts = options && typeof options === "object" ? options : {};
    const made = await ledgers.create(clean, userId, { visibleToAll: opts.visibleToAll === true });
    return ok(made);
  }

  return {
    request: (userId, input) => serialize(() => doRequest(userId, input)),
    accept: (userId, id) => serialize(() => doAccept(userId, id)),
    decline: (userId, id) => serialize(() => doDecline(userId, id)),
    cancel: (userId, id) => serialize(() => doCancel(userId, id)),
    amend: (userId, id, patch) => serialize(() => doAmend(userId, id, patch)),
    createLedger: (userId, name, options) => serialize(() => doCreateLedger(userId, name, options)),
    expireDue: () => serialize(() => doExpireDue()),
    async pending() {
      return Object.values(await store.loadPending());
    },
  };
}
