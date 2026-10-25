import { MODULE_ID } from "./constants.mjs";
import { mergeOptions, mergePermissions, mergePlayerOptions } from "./core/options.mjs";

/** Reads and writes the module's options. World values live in world settings, a player's own in a user flag. */
export const worldOptions = () => mergeOptions(game.settings.get(MODULE_ID, "options"));
export const permissionGrid = () => mergePermissions(game.settings.get(MODULE_ID, "permissions"));

const denomKeys = () => Object.keys(CONFIG.DND5E?.currencies ?? {});

export function playerOptions(user = game.user) {
  return mergePlayerOptions(user?.getFlag(MODULE_ID, "options"), denomKeys());
}

export const savePlayerOptions = (value, user = game.user) =>
  user.setFlag(MODULE_ID, "options", mergePlayerOptions(value, denomKeys()));

/** World hidden coins plus the user's own. */
export function hiddenFor(user = game.user) {
  const world = game.settings.get(MODULE_ID, "hiddenDenominations")?.list ?? [];
  return [...new Set([...world, ...playerOptions(user).hiddenDenominations])];
}
