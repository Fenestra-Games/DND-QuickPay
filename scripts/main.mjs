import { MODULE_ID } from "./constants.mjs";
import { getDenominations, getBalance, holdsCurrency, quote } from "./adapters/dnd5e.mjs";
import { registerSettings } from "./settings.mjs";
import { buildEngine } from "./foundry-deps.mjs";
import { initSocket, callGM } from "./socket.mjs";
import { initChat } from "./chat.mjs";
import { initEntryPoints } from "./ui/entry-points.mjs";
import { initGMTools } from "./ui/gm-tools.mjs";
import { worldOptions } from "./options-store.mjs";
import * as ledger from "./ledger.mjs";

let engine = null;
const getEngine = () => (engine ??= buildEngine());
const isActiveGM = () => game.user === game.users.activeGM;

// socketlib announces itself early, so listen straight away
initSocket(getEngine);

Hooks.once("init", () => {
  if (game.system.id !== "dnd5e") {
    console.warn(`${MODULE_ID} | Only dnd5e is supported so far. Disabling.`);
    return;
  }
  registerSettings();
  initChat();
  initEntryPoints();
  initGMTools();
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") return;

  if (!game.modules.get("socketlib")?.active) {
    ui.notifications.error("DND QuickPay needs the socketlib module to be installed and enabled.");
    return;
  }

  /** Records the current user is allowed to see: a GM sees all, a player sees their own. */
  const visiblePending = () => {
    const all = Object.values(game.settings.get(MODULE_ID, "pending") ?? {});
    if (game.user.isGM) return all;
    return all.filter((rec) => {
      if (rec.initiatedBy === game.user.id) return true;
      try {
        return fromUuidSync(rec.recipient?.uuid)?.testUserPermission(game.user, "OWNER") === true;
      } catch {
        return false;
      }
    });
  };

  game.modules.get(MODULE_ID).api = {
    // Read-only helpers
    getDenominations,
    getBalance,
    holdsCurrency,
    quote,

    /**
     * Send coins. Runs on the GM's client.
     * @param {{senderUuid?:string|null, recipientUuid?:string|null, amount:object,
     *          note?:string, visibility?:"public"|"gm-recipient"|"gm", ledgerId?:string}} input
     *   A null sender mints coins and a null recipient removes them (GM only).
     */
    request: (input) => callGM("request", input),
    /** Send the same amount to several recipients: requestMany(input, [uuid, uuid]). */
    requestMany: (input, recipientUuids) => callGM("requestMany", input, recipientUuids),
    accept: (id) => callGM("accept", id),
    decline: (id) => callGM("decline", id),
    cancel: (id) => callGM("cancel", id),
    /** GM only: approve or deny a request that is waiting for approval. */
    approve: (id) => callGM("approve", id),
    deny: (id) => callGM("deny", id),
    /** Open the options window. */
    openOptions: async () => (await import("./ui/options-app.mjs")).openOptions(),
    /** Change a transfer after the fact: { ledgerId?: string|null, note?: string }. */
    amend: (id, patch) => callGM("amend", id, patch),

    /**
     * Open the send dialog. With no arguments it uses your selected token, or your character.
     * openSend(actorOrUuid, "send" | "receive")  ("receive" is for GMs)
     */
    openSend: async (actorOrUuid = null, mode = "send") => (await import("./ui/send-dialog.mjs")).openSend(actorOrUuid, mode),
    /** Tick containers that anyone may send coins to. */
    openPublicContainers: async () => (await import("./ui/public-containers.mjs")).openPublicContainers(),

    ledgers: {
      /** Create a named ledger. Who may is set by the ledgerCreators setting (GM only by default). */
      create: (name, options = {}) => callGM("createLedger", name, options),
      /** Business ledgers you may tag transfers to. */
      list: () => ledger.listLedgers(),
      /** Open the filterable viewer (optionally on one ledger id). */
      open: async (ledgerId = null) => (await import("./ui/ledger-app.mjs")).openLedgerViewer(ledgerId),
      /** Entries of a ledger you can read, or null. */
      read: (ledgerId) => ledger.readEntries(ledgerId),
      /** GM only: make a personal ledger journal for every player character. */
      createPersonal: async () => (game.user.isGM ? ledger.createAllPersonal() : 0),
      /** GM only: switch an actor's personal ledger on, off, or back to the default (null). */
      setPersonal: async (actorUuid, on) => {
        if (!game.user.isGM) return false;
        const actor = await fromUuid(actorUuid);
        if (actor?.documentName !== "Actor") return false;
        await ledger.setPersonalEnabled(actor, on);
        return true;
      },
    },
    /** GM only: who may create ledgers: { mode: "gm"|"all"|"users", users: [userIds] }. */
    setLedgerCreators: async (value) => {
      if (!game.user.isGM) return false;
      const mode = ["gm", "all", "users"].includes(value?.mode) ? value.mode : "gm";
      const users = Array.isArray(value?.users) ? value.users.filter((id) => game.users.has(id)) : [];
      await game.settings.set(MODULE_ID, "ledgerCreators", { mode, users });
      return true;
    },

    pending: visiblePending,
    /** GM only: the global transaction log. */
    log: () => (game.user.isGM ? [...(game.settings.get(MODULE_ID, "log")?.records ?? [])] : []),
    /** GM only: expire anything past its deadline right now. */
    expireNow: () => (game.user.isGM ? getEngine().expireDue() : 0),
  };

  // Sweep for expired transfers on load and whenever the world clock moves
  if (isActiveGM()) {
    getEngine().expireDue();
    if (worldOptions().autoCreatePersonal) ledger.createAllPersonal().catch((err) => console.error(`${MODULE_ID} | auto-create failed`, err));
  }
  console.log(`${MODULE_ID} | stage 3b loaded`);
});

Hooks.on("updateWorldTime", () => {
  if (game.ready && game.system.id === "dnd5e" && isActiveGM()) getEngine().expireDue();
});
