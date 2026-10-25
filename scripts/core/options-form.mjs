/**
 * Turns the raw values of the options window into validated settings. Pure.
 *
 * Field names:
 *   opt.<key>        world option           perm.<rule>     permission grid cell
 *   hide.<coin>      world hidden coin      expiryHours     offlineMessage
 *   creatorsMode     creator.<userId>       acc.<actorId>   pl.<actorId>
 *   p.<key>          a player's own option  p.hide.<coin>   a player's own hidden coin
 * Fields that aren't on the page (a player never sees the GM tabs) are simply absent
 * and produce no output for that group.
 */
import {
  DEFAULT_OPTIONS, PERMISSION_RULES, mergeOptions, mergePermissions, mergePlayerOptions,
} from "./options.mjs";

const tri = (v) => (v === "on" ? true : v === "off" ? false : null); // actor switches: default / on / off
const has = (v, prefix) => Object.keys(v).some((k) => k.startsWith(prefix));

/**
 * @param {Record<string, string|boolean>} v
 * @param {{denomKeys:string[], playerIds:string[], actorIds:string[]}} ctx  what exists in the world
 */
export function fromFormValues(v, ctx) {
  const out = {};

  if (has(v, "opt.")) {
    const raw = {};
    for (const key of Object.keys(DEFAULT_OPTIONS)) if (`opt.${key}` in v) raw[key] = v[`opt.${key}`];
    out.options = mergeOptions(raw);
  }
  if (has(v, "perm.")) {
    const raw = {};
    for (const { key } of PERMISSION_RULES) if (`perm.${key}` in v) raw[key] = v[`perm.${key}`];
    out.permissions = mergePermissions(raw);
  }
  if (has(v, "hide.")) {
    out.hidden = ctx.denomKeys.filter((k) => v[`hide.${k}`] === true);
  }
  if ("expiryHours" in v) {
    const n = Math.floor(Number(v.expiryHours));
    out.expiryHours = Number.isFinite(n) ? Math.min(720, Math.max(1, n)) : 12;
  }
  if ("offlineMessage" in v) out.offlineMessage = String(v.offlineMessage ?? "").slice(0, 200);
  if ("creatorsMode" in v) {
    out.creators = {
      mode: ["gm", "users", "all"].includes(v.creatorsMode) ? v.creatorsMode : "gm",
      users: ctx.playerIds.filter((id) => v[`creator.${id}`] === true),
    };
  }

  const actors = {};
  for (const id of ctx.actorIds) {
    const flags = {};
    if (`acc.${id}` in v) flags.acceptance = tri(v[`acc.${id}`]);
    if (`pl.${id}` in v) flags.personal = tri(v[`pl.${id}`]);
    if (Object.keys(flags).length) actors[id] = flags;
  }
  if (Object.keys(actors).length) out.actors = actors;

  if (has(v, "p.")) {
    const raw = {};
    for (const key of ["defaultVisibility", "defaultLedger", "rememberRecipients", "confirmBeforeSend", "notifyOnReceive"]) {
      if (`p.${key}` in v) raw[key] = v[`p.${key}`];
    }
    raw.hiddenDenominations = ctx.denomKeys.filter((k) => v[`p.hide.${k}`] === true);
    out.player = mergePlayerOptions(raw, ctx.denomKeys);
  }
  return out;
}

/** The three-way value shown for an actor switch. */
export const triValue = (flag) => (flag === true ? "on" : flag === false ? "off" : "default");
