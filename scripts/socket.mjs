import { MODULE_ID, DEFAULT_OFFLINE_MESSAGE } from "./constants.mjs";

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
          return { ok: false, error: "Couldn't identify who made this request." };
        }
        try {
          return await getEngine()[name](userId, ...args);
        } catch (err) {
          console.error(`${MODULE_ID} | ${name} failed`, err);
          return { ok: false, error: "Something went wrong on the GM's side. Check the GM's console." };
        }
      };

    for (const name of ["request", "requestMany", "accept", "decline", "cancel", "amend", "createLedger"]) socket.register(name, handle(name));
  });
}

export function offlineText() {
  const custom = String(game.settings.get(MODULE_ID, "offlineMessage") ?? "").trim();
  return custom || "A GM needs to be online to process this transaction.";
}

/** Call the engine on the GM's client. Resolves to the engine's result object. */
export async function callGM(name, ...args) {
  if (!socket) {
    return {
      ok: false,
      error: socketFailed
        ? "DND QuickPay couldn't connect to socketlib. Check the console for errors."
        : "socketlib isn't ready yet.",
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
    return { ok: false, error: "The GM's client didn't respond." };
  }
}

export { DEFAULT_OFFLINE_MESSAGE };
