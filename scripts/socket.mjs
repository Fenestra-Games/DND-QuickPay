import { MODULE_ID, DEFAULT_OFFLINE_MESSAGE } from "./constants.mjs";
import { t } from "./i18n.mjs";

let socket = null;
let socketFailed = false;

/**
 * Players can't write to other people's actors, so every transfer runs on the GM's
 * client through socketlib. Each handler learns who asked from socketlib itself
 * (this.socketdata.userId, which Foundry's server supplies), never from the
 * arguments, so a player can't pretend to be someone else.
 */
export function initSocket(getEngine) {
  Hooks.once("socketlib.ready", () => {
    // socketlib returns undefined (and logs an error) if the module is inactive or its
    // module.json is missing "socket": true
    socket = socketlib.registerModule(MODULE_ID) ?? null;
    if (!socket) {
      socketFailed = true;
      console.error(`${MODULE_ID} | socketlib refused to register this module. Check that module.json has "socket": true and the module is enabled.`);
      return;
    }

    const handle = (name) =>
      async function (...args) {
        const userId = this?.socketdata?.userId;
        if (!userId || !game.users.has(userId)) {
          return { ok: false, error: t("QUICKPAY.err.noIdentity") };
        }
        try {
          return await getEngine()[name](userId, ...args);
        } catch (err) {
          console.error(`${MODULE_ID} | ${name} failed`, err);
          return { ok: false, error: t("QUICKPAY.err.gmSide") };
        }
      };

    for (const name of ["request", "requestMany", "accept", "decline", "cancel", "approve", "deny", "amend", "createLedger"]) socket.register(name, handle(name));
  });
}

export function offlineText() {
  const custom = String(game.settings.get(MODULE_ID, "offlineMessage") ?? "").trim();
  return custom || t("QUICKPAY.err.gmOffline");
}

/** Call the engine on the GM's client. Resolves to the engine's result object. */
export async function callGM(name, ...args) {
  if (!socket) {
    return {
      ok: false,
      error: socketFailed
        ? t("QUICKPAY.err.socketFailed")
        : t("QUICKPAY.err.socketNotReady"),
    };
  }
  if (!game.users.activeGM) {
    const text = offlineText();
    ui.notifications.warn(text);
    return { ok: false, offline: true, error: text };
  }
  try {
    return await socket.executeAsGM(name, ...args);
  } catch (err) {
    console.error(`${MODULE_ID} | ${name} call failed`, err);
    return { ok: false, error: t("QUICKPAY.err.gmNoResponse") };
  }
}

export { DEFAULT_OFFLINE_MESSAGE };
