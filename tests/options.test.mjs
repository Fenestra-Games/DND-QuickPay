import assert from "node:assert/strict";
import {
  DEFAULT_OPTIONS, DEFAULT_PERMISSIONS, DEFAULT_PLAYER_OPTIONS, PERMISSION_RULES, MAX_RECIPIENTS,
  mergeOptions, mergePermissions, mergePlayerOptions, classifyRecipient, decidePermission, limitUnits,
} from "../scripts/core/options.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  ", name); };

t("missing or junk options become the defaults", () => {
  for (const bad of [undefined, null, "x", 5, [], {}]) assert.deepEqual(mergeOptions(bad), DEFAULT_OPTIONS);
});

t("valid values are kept, invalid ones fall back one by one", () => {
  const o = mergeOptions({ acceptanceDefault: false, containerFlagging: "gm", confirmAboveGp: "250", maxRecipients: 4, defaultVisibility: "nonsense", waitingCard: "yes" });
  assert.equal(o.acceptanceDefault, false);
  assert.equal(o.containerFlagging, "gm");
  assert.equal(o.confirmAboveGp, 250);
  assert.equal(o.maxRecipients, 4);
  assert.equal(o.defaultVisibility, "public");
  assert.equal(o.waitingCard, true);
});

t("numbers are clamped and floored; unknown keys are dropped", () => {
  assert.equal(mergeOptions({ maxRecipients: 999 }).maxRecipients, MAX_RECIPIENTS);
  assert.equal(mergeOptions({ maxRecipients: 0 }).maxRecipients, 1);
  assert.equal(mergeOptions({ confirmAboveGp: -5 }).confirmAboveGp, 0);
  assert.equal(mergeOptions({ maxPerTransferGp: 12.9 }).maxPerTransferGp, 12);
  assert.equal(mergeOptions({ confirmAboveGp: NaN }).confirmAboveGp, DEFAULT_OPTIONS.confirmAboveGp);
  assert.equal(mergeOptions({ confirmAboveGp: "" }).confirmAboveGp, DEFAULT_OPTIONS.confirmAboveGp);
  assert.ok(!("evil" in mergeOptions({ evil: 1 })));
});

t("the default grid blocks only other people's containers", () => {
  assert.deepEqual(mergePermissions(undefined), DEFAULT_PERMISSIONS);
  const blocked = Object.entries(DEFAULT_PERMISSIONS).filter(([, v]) => v === "block").map(([k]) => k);
  assert.deepEqual(blocked, ["playerToOtherContainer"]);
  assert.equal(PERMISSION_RULES.length, Object.keys(DEFAULT_PERMISSIONS).length);
});

t("grid values must be allow, approval, or block", () => {
  const g = mergePermissions({ playerToPlayer: "approval", playerToGMActor: "yes", playerToOtherContainer: "allow", extra: "allow" });
  assert.equal(g.playerToPlayer, "approval");
  assert.equal(g.playerToGMActor, "allow", "junk falls back to the default");
  assert.equal(g.playerToOtherContainer, "allow");
  assert.ok(!("extra" in g));
});

t("classification covers every kind of recipient", () => {
  const c = (o) => classifyRecipient({ recipientKind: "actor", ownsRecipient: false, isPublic: false, isPlayerOwned: false, ...o });
  assert.equal(c({}), "playerToGMActor");
  assert.equal(c({ isPlayerOwned: true }), "playerToPlayer");
  assert.equal(c({ ownsRecipient: true, isPlayerOwned: true }), "playerToOwnActor");
  assert.equal(c({ recipientKind: "container" }), "playerToOtherContainer");
  assert.equal(c({ recipientKind: "container", isPublic: true }), "playerToPublicContainer");
  assert.equal(c({ recipientKind: "container", ownsRecipient: true, isPublic: true }), "playerToOwnContainer");
});

t("decidePermission fails closed on an unknown rule", () => {
  assert.equal(decidePermission(DEFAULT_PERMISSIONS, "playerToPlayer"), "allow");
  assert.equal(decidePermission(DEFAULT_PERMISSIONS, "somethingNew"), "block");
});

t("player options: defaults, validation, and hidden coins limited to known ones", () => {
  assert.deepEqual(mergePlayerOptions(null), DEFAULT_PLAYER_OPTIONS);
  const p = mergePlayerOptions({ defaultVisibility: "gm", rememberRecipients: true, hiddenDenominations: ["ep", "ep", "xx", 5] }, ["pp", "gp", "ep", "sp", "cp"]);
  assert.equal(p.defaultVisibility, "gm");
  assert.equal(p.rememberRecipients, true);
  assert.deepEqual(p.hiddenDenominations, ["ep"]);
  assert.equal(mergePlayerOptions({ defaultVisibility: "" }).defaultVisibility, "");
  assert.equal(mergePlayerOptions({ defaultVisibility: "wat" }).defaultVisibility, "");
});

t("limits convert gold to the smallest coin unit", () => {
  const d = [{ key: "gp", value: 100 }, { key: "cp", value: 1 }];
  assert.equal(limitUnits(100, d), 10000);
  assert.equal(limitUnits(0, d), null);
  assert.equal(limitUnits(5, [{ key: "cp", value: 1 }]), null);
});

console.log(`\n${n} options tests passed`);
