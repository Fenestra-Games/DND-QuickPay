import { MODULE_ID } from "./constants.mjs";
import { getDenominations, getBalance, holdsCurrency, quote } from "./adapters/dnd5e.mjs";
import { registerSettings } from "./settings.mjs";
import { buildEngine } from "./foundry-deps.mjs";
import { initSocket, callGM } from "./socket.mjs";

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
    accept: (id) => callGM("accept", id),
    decline: (id) => callGM("decline", id),
    cancel: (id) => callGM("cancel", id),

    pending: visiblePending,
    /** GM only: the global transaction log. */
    log: () => (game.user.isGM ? [...(game.settings.get(MODULE_ID, "log")?.records ?? [])] : []),
    /** GM only: expire anything past its deadline right now. */
    expireNow: () => (game.user.isGM ? getEngine().expireDue() : 0),
  };

  // Sweep for expired transfers on load and whenever the world clock moves
  if (isActiveGM()) getEngine().expireDue();
  console.log(`${MODULE_ID} | stage 2 loaded (no UI yet)`);
});

Hooks.on("updateWorldTime", () => {
  if (game.ready && game.system.id === "dnd5e" && isActiveGM()) getEngine().expireDue();
});
