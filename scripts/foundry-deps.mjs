import { MODULE_ID, FLAGS, LOG_CAP } from "./constants.mjs";
import { getDenominations, getBalance, holdsCurrency, commit } from "./adapters/dnd5e.mjs";
import { createEngine } from "./core/engine.mjs";
import * as ledger from "./ledger.mjs";
import { worldOptions, permissionGrid, playerOptions } from "./options-store.mjs";

/** Connects the engine to real Foundry documents, settings, and hooks. */
export function buildEngine() {
  const user = (id) => game.users.get(id);

  const docs = {
    async resolve(uuid) {
      try {
        const doc = await fromUuid(uuid);
        return doc && (doc.documentName === "Actor" || doc.documentName === "Item") ? doc : null;
      } catch {
        return null;
      }
    },
    uuid: (doc) => doc.uuid,
    name: (doc) => (doc.documentName === "Item" && doc.parent ? `${doc.parent.name}: ${doc.name}` : doc.name),
    kind: (doc) => (doc.documentName === "Actor" ? "actor" : "container"),
    userExists: (id) => game.users.has(id),
    userName: (id) => user(id)?.name ?? "Unknown",
    isGM: (id) => user(id)?.isGM === true,
    userOwns: (id, doc) => {
      const u = user(id);
      return !!u && doc.testUserPermission(u, "OWNER");
    },
    isPlayerOwned: (actor) => game.users.contents.some((u) => !u.isGM && actor.testUserPermission(u, "OWNER")),
    acceptanceFlag: (actor) => actor.getFlag(MODULE_ID, FLAGS.requiresAcceptance),
    isPublic: (container) => container.getFlag(MODULE_ID, FLAGS.publicRecipient) === true,
  };

  const store = {
    loadPending: () => structuredClone(game.settings.get(MODULE_ID, "pending") ?? {}),
    savePending: (obj) => game.settings.set(MODULE_ID, "pending", obj),
    async appendLog(record) {
      const cur = game.settings.get(MODULE_ID, "log") ?? {};
      const records = [...(cur.records ?? []), structuredClone(record)].slice(-LOG_CAP);
      await game.settings.set(MODULE_ID, "log", { records });
    },
    findLog(id) {
      const rec = (game.settings.get(MODULE_ID, "log")?.records ?? []).find((r) => r.id === id);
      return rec ? structuredClone(rec) : null;
    },
    async updateLog(id, patch) {
      const records = structuredClone(game.settings.get(MODULE_ID, "log")?.records ?? []);
      const rec = records.find((r) => r.id === id);
      if (!rec) return null;
      Object.assign(rec, patch);
      await game.settings.set(MODULE_ID, "log", { records });
      return structuredClone(rec);
    },
  };

  const settings = {
    expiryHours: () => Number(game.settings.get(MODULE_ID, "expiryHours")) || 12,
    hidden: () => game.settings.get(MODULE_ID, "hiddenDenominations")?.list ?? [],
    defaultVisibility: () => worldOptions().defaultVisibility,
    options: () => game.settings.get(MODULE_ID, "options"),
    permissions: () => game.settings.get(MODULE_ID, "permissions"),
    userHidden: (userId) => playerOptions(game.users.get(userId)).hiddenDenominations,
  };

  return createEngine({
    docs,
    coins: { getDenominations, getBalance, holdsCurrency, commit },
    store,
    ledgers: {
      canUse: (userId, ledgerId) => ledger.canUse(userId, ledgerId),
      canCreate: (userId) => ledger.canCreate(userId),
      create: (name, userId, opts) => ledger.create(name, userId, opts),
      record: (rec) => ledger.record(rec),
      reconcile: (before, after) => ledger.reconcile(before, after),
    },
    personal: {
      record: (rec) => ledger.recordPersonal(rec),
      reconcile: (before, after) => ledger.reconcilePersonal(before, after),
    },
    settings,
    now: () => game.time.worldTime,
    newId: () => foundry.utils.randomID(16),
    emit: (name, record) => Hooks.callAll(`${MODULE_ID}.${name}`, record),
  });
}
