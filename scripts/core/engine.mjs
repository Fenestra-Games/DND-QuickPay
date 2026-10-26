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
import { t } from "../i18n.mjs";
import {
  DEFAULT_OPTIONS, DEFAULT_PERMISSIONS, mergeOptions, mergePermissions, classifyRecipient, decidePermission, limitUnits,
} from "./options.mjs";

export const STATUS = Object.freeze({
  PENDING: "pending",
  COMPLETED: "completed",
  DECLINED: "declined",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  APPROVAL: "approval", // waiting for a GM to approve; no coins have moved
  DENIED: "denied",
  APPROVED: "approved", // only ever on the short-lived approval record, never logged
});

export const VISIBILITY = Object.freeze(["public", "gm-recipient", "gm"]);

const NOTE_MAX = 500;
const LEDGER_NAME_MAX = 60;
const RECORD_VERSION = 1;

const toCost = (amount, d) => d.reduce((sum, x) => sum + (amount[x.key] ?? 0) * x.value, 0);
const ok = (extra = {}) => ({ ok: true, ...extra });
const no = (error, extra = {}) => ({ ok: false, error, ...extra });

export function createEngine(deps) {
  const { docs, coins, store, ledgers, settings, now, newId, emit } = deps;
  const personal = deps.personal ?? null;

  // Options and the permission grid are optional dependencies: older callers get the defaults
  const getOptions = () => (settings.options ? mergeOptions(settings.options()) : { ...DEFAULT_OPTIONS });
  const getPerms = () => (settings.permissions ? mergePermissions(settings.permissions()) : { ...DEFAULT_PERMISSIONS });
  const userHidden = (userId) => (settings.userHidden ? settings.userHidden(userId) ?? [] : []);

  // ---- serialisation -------------------------------------------------------
  let chain = Promise.resolve();
  const serialize = (fn) => {
    const run = chain.then(() => fn());
    chain = run.catch(() => {});
    return run;
  };

  const denoms = () => coins.getDenominations({ hidden: settings.hidden() });
  /** Denominations as one user sees them: the world filter plus their own. */
  const denomsFor = (userId) => coins.getDenominations({ hidden: [...settings.hidden(), ...userHidden(userId)] });

  // ---- input ---------------------------------------------------------------
  const cleanNote = (v) => (typeof v === "string" ? v.trim().slice(0, NOTE_MAX) : "");
  const cleanLedgerId = (v) => (typeof v === "string" && v ? v.slice(0, 64) : null);

  function sanitize(input) {
    if (!input || typeof input !== "object") return { error: t("QUICKPAY.err.invalidRequest") };
    const uuidOrNull = (v) => (v == null || v === "" ? null : typeof v === "string" ? v : undefined);
    const senderUuid = uuidOrNull(input.senderUuid);
    const recipientUuid = uuidOrNull(input.recipientUuid);
    if (senderUuid === undefined || recipientUuid === undefined) return { error: t("QUICKPAY.err.invalidTarget") };
    if (!senderUuid && !recipientUuid) return { error: t("QUICKPAY.err.chooseSide") };
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
    const o = getOptions();
    const flag = docs.acceptanceFlag(recipient); // true, false, or undefined when never set
    const required = o.playersMayChangeAcceptance && typeof flag === "boolean" ? flag : o.acceptanceDefault;
    if (!required) return false; // the owner (or the world) turned acceptance off
    if (!docs.isGM(userId) && docs.userOwns(userId, recipient)) return false; // your own actor
    if (docs.isGM(userId) && o.gmGiftsSkipAcceptance) return false;
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
  async function doRequest(userId, input, { dryRun = false, approvedBy = null } = {}) {
    if (!docs.userExists(userId)) return no(t("QUICKPAY.err.noIdentity"));
    const isGM = docs.isGM(userId);

    const clean = sanitize(input);
    if (clean.error) return no(clean.error);

    const sender = clean.senderUuid ? await docs.resolve(clean.senderUuid) : null;
    if (clean.senderUuid && !sender) return no(t("QUICKPAY.err.senderMissing"));
    const recipient = clean.recipientUuid ? await docs.resolve(clean.recipientUuid) : null;
    if (clean.recipientUuid && !recipient) return no(t("QUICKPAY.err.recipientMissing"));

    for (const d of [sender, recipient]) {
      if (d && !coins.holdsCurrency(d)) return no(t("QUICKPAY.err.cantHoldCoins", { name: docs.name(d) }));
    }
    if (sender && recipient && docs.uuid(sender) === docs.uuid(recipient)) {
      return no(t("QUICKPAY.err.sameParty"));
    }

    // The permission grid. GMs are never restricted; owning the sender is always required.
    let decision = "allow";
    if (!isGM) {
      if (!sender) return no(t("QUICKPAY.err.gmMint"));
      if (!recipient) return no(t("QUICKPAY.err.gmBurn"));
      if (!docs.userOwns(userId, sender)) return no(t("QUICKPAY.err.noPermissionOver", { name: docs.name(sender) }));
      const isContainer = docs.kind(recipient) === "container";
      const rule = classifyRecipient({
        recipientKind: isContainer ? "container" : "actor",
        ownsRecipient: docs.userOwns(userId, recipient),
        isPublic: isContainer && docs.isPublic(recipient),
        isPlayerOwned: !isContainer && docs.isPlayerOwned(recipient),
      });
      decision = decidePermission(getPerms(), rule);
      if (decision === "block") {
        return no(isContainer ? t("QUICKPAY.err.containerNotAccepting", { name: docs.name(recipient) }) : t("QUICKPAY.err.cantSendTo", { name: docs.name(recipient) }));
      }
    }

    // A ledger tag must point at a ledger this user is allowed to use
    if (clean.ledgerId && !(await ledgers.canUse(userId, clean.ledgerId))) {
      return no(t("QUICKPAY.err.ledgerUnusable"));
    }

    // Work out the coins
    const d = denomsFor(userId);
    const opts = getOptions();
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

    if (!isGM) {
      const limit = limitUnits(opts.maxPerTransferGp, d);
      if (limit && toCost(receive, d) > limit) return no(t("QUICKPAY.err.overLimit", { limit: opts.maxPerTransferGp }));
    }
    const needsApproval = decision === "approval" && !approvedBy;
    if (dryRun) return ok({ dryRun: true, needsApproval, cost: sender ? toCost(receive, d) : 0 });

    const pending = needsAcceptance(userId, recipient);
    const stamp = now();
    const record = {
      version: RECORD_VERSION,
      id: newId(),
      status: STATUS.PENDING,
      createdAt: stamp,
      createdReal: Date.now(),
      expiresAt: pending ? stamp + settings.expiryHours() * 3600 : null,
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
      approvedBy,
    };

    // 0. A grid cell set to "approval": park the request with a GM. No coins move yet.
    if (needsApproval) {
      record.status = STATUS.APPROVAL;
      record.escrow = {};
      record.expiresAt = stamp + settings.expiryHours() * 3600;
      record.request = {
        senderUuid: clean.senderUuid,
        recipientUuid: clean.recipientUuid,
        amount: { ...receive },
        note: clean.note,
        visibility: clean.visibility,
        ledgerId: clean.ledgerId,
      };
      try {
        const pend = await store.loadPending();
        pend[record.id] = record;
        await store.savePending(pend);
      } catch (err) {
        console.error("dnd-quickpay | could not save approval request", err);
        return no(t("QUICKPAY.err.recordRequest"));
      }
      emit("transferApproval", record);
      return ok({ status: STATUS.APPROVAL, record });
    }

    // 1. Escrow: take the coins from the sender
    if (sender && !(await coins.commit(sender, escrow))) {
      return no(t("QUICKPAY.err.coinsChanged"));
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
        return no(t("QUICKPAY.err.recordPending"));
      }
      emit("transferPending", record);
      return ok({ status: STATUS.PENDING, record });
    }

    // 2b. Straight through: credit the recipient (a burn has none)
    if (recipient && !(await coins.commit(recipient, receive))) {
      const refunded = await refundSender(record);
      return no(t("QUICKPAY.err.recipientFailed"), { refunded });
    }
    await finish(record, STATUS.COMPLETED, recipient ? "auto" : "removed", userId, { refunded: null });
    return ok({ status: STATUS.COMPLETED, record });
  }

  // ---- several recipients ----------------------------------------------------
  const MANY_MAX = 25;

  /**
   * Send the same amount to each recipient. Everything that can be checked up front is:
   * each recipient's permissions, and that the sender can cover the whole total. If all
   * checks pass, the transfers run one after another as separate transfers. If something
   * unexpected fails midway, it stops there and reports what already went through.
   */
  async function doRequestMany(userId, input, recipientUuids) {
    if (!input || typeof input !== "object") return no(t("QUICKPAY.err.invalidRequest"));
    if (!Array.isArray(recipientUuids) || !recipientUuids.length) return no(t("QUICKPAY.err.chooseRecipient"));
    const list = [...new Set(recipientUuids.map((u) => (u == null || u === "" ? null : u)))];
    const most = Math.min(MANY_MAX, getOptions().maxRecipients);
    if (list.length > most) return no(t("QUICKPAY.err.tooManyRecipients", { max: most }));
    if (list.some((u) => u !== null && typeof u !== "string")) return no(t("QUICKPAY.err.invalidTarget"));

    const base = { ...input };
    for (const u of list) {
      const check = await doRequest(userId, { ...base, recipientUuid: u }, { dryRun: true });
      if (!check.ok) {
        const who = u ? (await docs.resolve(u)) : null;
        return no(who ? t("QUICKPAY.err.recipientPrefixed", { name: docs.name(who), error: check.error }) : check.error);
      }
    }
    // the whole total, not just each share
    if (list.length > 1 && base.senderUuid) {
      const sender = await docs.resolve(base.senderUuid);
      const d = denoms();
      const norm = normalizeAmount(base.amount, d);
      if (sender && norm.ok) {
        const scaled = Object.fromEntries(Object.entries(norm.receive).map(([k, n]) => [k, n * list.length]));
        const plan = planPayment(coins.getBalance(sender), scaled, d);
        if (!plan.ok) return no(t("QUICKPAY.err.notEnoughForMany", { count: list.length }));
      }
    }

    const results = [];
    for (const u of list) {
      const res = await doRequest(userId, { ...base, recipientUuid: u });
      results.push({ recipientUuid: u, ok: res.ok, status: res.status ?? null, error: res.error ?? null, record: res.record ?? null });
      if (!res.ok) break;
    }
    const done = results.filter((r) => r.ok).length;
    if (done < list.length) {
      return no(t("QUICKPAY.err.partialBatch", { done, count: list.length, error: results.at(-1).error }), { results, done, total: list.length });
    }
    return ok({ results, done, total: list.length });
  }

  // ---- resolving pending transfers ----------------------------------------
  async function getPending(id) {
    const pend = await store.loadPending();
    const record = pend[id];
    return record && record.status === STATUS.PENDING ? record : null;
  }

  async function doAccept(userId, id) {
    const record = await getPending(id);
    if (!record) return no(t("QUICKPAY.err.notPending"));
    const isGM = docs.isGM(userId);

    const recipient = record.recipient ? await docs.resolve(record.recipient.uuid) : null;
    if (!recipient) {
      await closeWithRefund(record, STATUS.CANCELLED, "recipient-missing", userId);
      return no(t("QUICKPAY.err.recipientGone"));
    }
    if (!isGM && !docs.userOwns(userId, recipient)) return no(t("QUICKPAY.err.onlyRecipientAccept"));

    if (record.expiresAt != null && now() >= record.expiresAt) {
      await closeWithRefund(record, STATUS.EXPIRED, "expired", userId);
      return no(t("QUICKPAY.err.expired"));
    }
    if (!(await coins.commit(recipient, record.amount))) {
      return no(t("QUICKPAY.err.addFailed"));
    }
    await finish(record, STATUS.COMPLETED, isGM ? "accepted-by-gm" : "accepted", userId, { refunded: null });
    return ok({ status: STATUS.COMPLETED, record });
  }

  async function doDecline(userId, id) {
    const record = await getPending(id);
    if (!record) return no(t("QUICKPAY.err.notPending"));
    const isGM = docs.isGM(userId);
    const recipient = record.recipient ? await docs.resolve(record.recipient.uuid) : null;
    if (!isGM && !(recipient && docs.userOwns(userId, recipient))) {
      return no(t("QUICKPAY.err.onlyRecipientDecline"));
    }
    const refunded = await closeWithRefund(record, STATUS.DECLINED, isGM ? "declined-by-gm" : "declined", userId);
    return ok({ status: STATUS.DECLINED, record, refunded });
  }

  /** A record still waiting on someone: pending acceptance, or pending GM approval. */
  async function getOpen(id) {
    const pend = await store.loadPending();
    const record = pend[id];
    return record && (record.status === STATUS.PENDING || record.status === STATUS.APPROVAL) ? record : null;
  }

  async function doApprove(userId, id) {
    if (!docs.isGM(userId)) return no(t("QUICKPAY.err.onlyGmApprove"));
    const pend = await store.loadPending();
    const record = pend[id];
    if (!record || record.status !== STATUS.APPROVAL) return no(t("QUICKPAY.err.notAwaitingApproval"));
    const res = await doRequest(record.initiatedBy, record.request, { approvedBy: userId });
    if (!res.ok) {
      await finish(record, STATUS.CANCELLED, "approval-failed", userId, { refunded: null });
      return no(t("QUICKPAY.err.couldntGoAhead", { error: res.error }));
    }
    const after = await store.loadPending();
    delete after[id];
    await store.savePending(after);
    emit("transferApprovalClosed", { ...record, status: STATUS.APPROVED, resolvedAt: now(), resolvedBy: userId });
    return ok({ status: res.status, record: res.record });
  }

  async function doDeny(userId, id) {
    if (!docs.isGM(userId)) return no(t("QUICKPAY.err.onlyGmDeny"));
    const pend = await store.loadPending();
    const record = pend[id];
    if (!record || record.status !== STATUS.APPROVAL) return no(t("QUICKPAY.err.notAwaitingApproval"));
    await finish(record, STATUS.DENIED, "denied-by-gm", userId, { refunded: null });
    return ok({ status: STATUS.DENIED, record });
  }

  async function doCancel(userId, id) {
    const record = await getOpen(id);
    if (!record) return no(t("QUICKPAY.err.notPending"));
    if (record.status === STATUS.APPROVAL) {
      const gm = docs.isGM(userId);
      const own = record.sender ? await docs.resolve(record.sender.uuid) : null;
      if (!gm && !(own && docs.userOwns(userId, own))) return no(t("QUICKPAY.err.onlySenderCancel"));
      await finish(record, STATUS.CANCELLED, gm ? "cancelled-by-gm" : "cancelled", userId, { refunded: null });
      return ok({ status: STATUS.CANCELLED, record });
    }
    const isGM = docs.isGM(userId);
    const sender = record.sender ? await docs.resolve(record.sender.uuid) : null;
    if (!isGM && !(sender && docs.userOwns(userId, sender))) {
      return no(t("QUICKPAY.err.onlySenderCancel"));
    }
    const refunded = await closeWithRefund(record, STATUS.CANCELLED, isGM ? "cancelled-by-gm" : "cancelled", userId);
    return ok({ status: STATUS.CANCELLED, record, refunded });
  }

  async function doExpireDue() {
    const nowSeconds = now();
    const pend = await store.loadPending();
    let count = 0;
    for (const record of Object.values(pend)) {
      if (record.expiresAt == null || nowSeconds < record.expiresAt) continue;
      if (record.status === STATUS.PENDING) {
        await closeWithRefund(record, STATUS.EXPIRED, "expired", null);
        count++;
      } else if (record.status === STATUS.APPROVAL) {
        await finish(record, STATUS.EXPIRED, "expired", null, { refunded: null });
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
    if (!docs.userExists(userId)) return no(t("QUICKPAY.err.noIdentity"));
    if (typeof id !== "string" || !patch || typeof patch !== "object") return no(t("QUICKPAY.err.invalidRequest"));

    const pend = await store.loadPending();
    const wasPending = id in pend;
    const before = wasPending ? structuredClone(pend[id]) : await store.findLog(id);
    if (!before) return no(t("QUICKPAY.err.transferMissing"));
    if (!(await canAmend(userId, before))) return no(t("QUICKPAY.err.cantChange"));

    const next = {};
    if ("ledgerId" in patch) {
      const ledgerId = patch.ledgerId == null || patch.ledgerId === "" ? null : cleanLedgerId(patch.ledgerId);
      if (patch.ledgerId != null && patch.ledgerId !== "" && !ledgerId) return no(t("QUICKPAY.err.invalidLedger"));
      if (ledgerId && !(await ledgers.canUse(userId, ledgerId))) {
        return no(t("QUICKPAY.err.ledgerUnusable"));
      }
      if (ledgerId !== before.ledgerId) next.ledgerId = ledgerId;
    }
    if ("note" in patch) {
      if (typeof patch.note !== "string") return no(t("QUICKPAY.err.invalidNote"));
      const note = cleanNote(patch.note);
      if (note !== before.note) next.note = note;
    }
    if (!Object.keys(next).length) return no(t("QUICKPAY.err.nothingToChange"));

    let after;
    if (wasPending) {
      pend[id] = { ...pend[id], ...next };
      await store.savePending(pend);
      after = structuredClone(pend[id]);
    } else {
      after = await store.updateLog(id, next);
      if (!after) return no(t("QUICKPAY.err.updateFailed"));
    }

    let ledgerWarning = null;
    if (!wasPending && (before.ledgerId || after.ledgerId)) {
      try {
        await ledgers.reconcile(before, after);
      } catch (err) {
        console.error("dnd-quickpay | could not update the ledger", err);
        ledgerWarning = t("QUICKPAY.err.ledgerNotUpdated");
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
    if (!docs.userExists(userId)) return no(t("QUICKPAY.err.noIdentity"));
    if (!ledgers.canCreate(userId)) return no(t("QUICKPAY.err.noCreateLedger"));
    const clean = typeof name === "string" ? name.trim().slice(0, LEDGER_NAME_MAX) : "";
    if (!clean) return no(t("QUICKPAY.err.ledgerNeedsName"));
    const opts = options && typeof options === "object" ? options : {};
    const visibleToAll = opts.visibleToAll === undefined ? getOptions().ledgerDefaultReaders === "all" : opts.visibleToAll === true;
    const made = await ledgers.create(clean, userId, { visibleToAll });
    return ok(made);
  }

  return {
    request: (userId, input) => serialize(() => doRequest(userId, input)),
    requestMany: (userId, input, recipientUuids) => serialize(() => doRequestMany(userId, input, recipientUuids)),
    approve: (userId, id) => serialize(() => doApprove(userId, id)),
    deny: (userId, id) => serialize(() => doDeny(userId, id)),
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
