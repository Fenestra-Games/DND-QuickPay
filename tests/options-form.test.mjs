import assert from "node:assert/strict";
import { fromFormValues, triValue } from "../scripts/core/options-form.mjs";
import { DEFAULT_OPTIONS, DEFAULT_PERMISSIONS } from "../scripts/core/options.mjs";

const ctx = { denomKeys: ["pp", "gp", "ep", "sp", "cp"], playerIds: ["u1", "u2"], actorIds: ["a1", "a2"] };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  ", name); };

t("an empty form produces nothing, so a player's save can't touch world settings", () => {
  assert.deepEqual(fromFormValues({}, ctx), {});
  const playerOnly = fromFormValues({ "p.rememberRecipients": true, "p.defaultVisibility": "gm" }, ctx);
  assert.deepEqual(Object.keys(playerOnly), ["player"]);
});

t("world options: checkboxes, selects and numbers are read and validated", () => {
  const o = fromFormValues({ "opt.acceptanceDefault": false, "opt.containerFlagging": "gm", "opt.confirmAboveGp": "250", "opt.maxRecipients": "999", "opt.nonsense": true }, ctx).options;
  assert.equal(o.acceptanceDefault, false);
  assert.equal(o.containerFlagging, "gm");
  assert.equal(o.confirmAboveGp, 250);
  assert.equal(o.maxRecipients, 25);
  assert.equal(o.waitingCard, DEFAULT_OPTIONS.waitingCard, "unlisted keys keep their defaults");
  assert.ok(!("nonsense" in o));
});

t("the permission grid reads allow, approval, and block, and rejects junk", () => {
  const p = fromFormValues({ "perm.playerToPlayer": "approval", "perm.playerToGMActor": "hack", "perm.playerToOtherContainer": "allow" }, ctx).permissions;
  assert.equal(p.playerToPlayer, "approval");
  assert.equal(p.playerToGMActor, DEFAULT_PERMISSIONS.playerToGMActor);
  assert.equal(p.playerToOtherContainer, "allow");
});

t("hidden coins only include coins that exist", () => {
  assert.deepEqual(fromFormValues({ "hide.ep": true, "hide.gp": false, "hide.xx": true }, ctx).hidden, ["ep"]);
  assert.deepEqual(fromFormValues({ "hide.ep": false }, ctx).hidden, []);
});

t("expiry and the offline message are clamped", () => {
  assert.equal(fromFormValues({ expiryHours: "0" }, ctx).expiryHours, 1);
  assert.equal(fromFormValues({ expiryHours: "9999" }, ctx).expiryHours, 720);
  assert.equal(fromFormValues({ expiryHours: "abc" }, ctx).expiryHours, 12);
  assert.equal(fromFormValues({ offlineMessage: "x".repeat(500) }, ctx).offlineMessage.length, 200);
});

t("ledger creators only list real players", () => {
  assert.deepEqual(fromFormValues({ creatorsMode: "users", "creator.u1": true, "creator.u2": false, "creator.ghost": true }, ctx).creators, { mode: "users", users: ["u1"] });
  assert.equal(fromFormValues({ creatorsMode: "everyone" }, ctx).creators.mode, "gm");
});

t("actor switches map default, on, and off, and ignore unknown actors", () => {
  const a = fromFormValues({ "acc.a1": "off", "pl.a1": "on", "acc.a2": "default", "acc.ghost": "on" }, ctx).actors;
  assert.deepEqual(a, { a1: { acceptance: false, personal: true }, a2: { acceptance: null } });
  assert.equal(triValue(true), "on");
  assert.equal(triValue(false), "off");
  assert.equal(triValue(undefined), "default");
});

t("player options: hidden coins, defaults, and validation", () => {
  const p = fromFormValues({ "p.defaultVisibility": "wat", "p.confirmBeforeSend": true, "p.hide.ep": true, "p.hide.zz": true, "p.defaultLedger": "abc" }, ctx).player;
  assert.equal(p.defaultVisibility, "");
  assert.equal(p.confirmBeforeSend, true);
  assert.deepEqual(p.hiddenDenominations, ["ep"]);
  assert.equal(p.defaultLedger, "abc");
});

console.log(`\n${n} options-form tests passed`);
