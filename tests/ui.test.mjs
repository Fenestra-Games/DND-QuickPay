/**
 * Tests the target list and the sheet/HUD entry points against stand-ins.
 * The dialog itself needs a real browser, so it is covered by the live checklist.
 */
import assert from "node:assert/strict";

const hooks = {};
globalThis.Hooks = { on: (n, fn) => (hooks[n] ??= []).push(fn) };
globalThis.CONFIG = { DND5E: { currencies: { gp: { conversion: 1 }, sp: { conversion: 10 } } } };

const mkUser = (id, isGM) => ({ id, isGM });
const gm = mkUser("gm", true), ana = mkUser("ana", false), ben = mkUser("ben", false);
class FakeCollection {
  constructor() { this.contents = []; }
  filter(fn) { return this.contents.filter(fn); }
  find(fn) { return this.contents.find(fn); }
  map(fn) { return this.contents.map(fn); }
  get size() { return this.contents.length; }
  push(x) { this.contents.push(x); }
}
globalThis.game = { users: { contents: [gm, ana, ben] }, user: ana, actors: new FakeCollection(), items: new FakeCollection() };

const mkActor = (id, type, owners, tokenVisible = null) => {
  const a = {
    documentName: "Actor", id, name: id, type, uuid: `Actor.${id}`, system: { currency: { gp: 0, sp: 0 } },
    testUserPermission: (u) => u.isGM || owners.includes(u.id), getFlag: () => undefined, items: new FakeCollection(),
  };
  game.actors.push(a);
  return a;
};
const mkContainer = (actor, id, pub = false) => {
  const c = {
    documentName: "Item", type: "container", id, name: id, parent: actor, uuid: `${actor.uuid}.Item.${id}`,
    system: { currency: { gp: 0 } }, getFlag: (s, k) => (pub && k === "publicRecipient" ? true : undefined),
  };
  actor.items.push(c);
  return c;
};
const A = mkActor("A", "character", ["ana"]);
const B = mkActor("B", "character", ["ben"]);
const Guard = mkActor("Guard", "npc", []);
const Hidden = mkActor("Hidden", "npc", []);
const Vault = mkActor("Vault", "npc", []);
const myBag = mkContainer(A, "bag");
const jar = mkContainer(Guard, "jar", true);
mkContainer(Vault, "safe");
mkContainer(B, "benbag");

globalThis.canvas = {
  tokens: { placeables: [
    { actor: Guard, visible: true, document: { hidden: false } },
    { actor: Hidden, visible: false, document: { hidden: true } },
  ] },
};
game.user.targets = new Set();

const { buildTargets, NOWHERE } = await import("../scripts/ui/targets.mjs");
const names = (groups) => groups.flatMap((g) => g.items.map((i) => i.name));
const groupNames = (groups) => groups.map((g) => g.label);

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("ok  ", name); };

await t("a player sees visible tokens, player characters, own and public containers only", () => {
  const g = buildTargets(ana, A.uuid);
  const list = names(g);
  assert.ok(list.includes("Guard") && list.includes("B") && list.includes("A: bag") && list.includes("Guard: jar"));
  for (const hiddenName of ["Hidden", "Vault", "Vault: safe", "B: benbag"]) assert.ok(!list.includes(hiddenName), hiddenName);
  assert.ok(!list.includes("A"), "the sender is never offered");
  assert.ok(!groupNames(g).includes("Nowhere"));
});

await t("a player never gets a nowhere choice, even if asked", () => {
  assert.ok(!names(buildTargets(ana, A.uuid, { nowhereLabel: "Nowhere" })).includes("Nowhere"));
});

await t("targeted tokens are offered, without duplicates later on", () => {
  game.user.targets = new Set([{ actor: Guard }]);
  const g = buildTargets(ana, A.uuid);
  assert.equal(g[0].label, "Targeted tokens");
  assert.equal(names(g).filter((x) => x === "Guard").length, 1);
  game.user.targets = new Set();
});

await t("the GM gets nowhere first, plus every actor and container", () => {
  game.user = gm;
  const g = buildTargets(gm, A.uuid, { nowhereLabel: "Nowhere (remove)" });
  assert.equal(g[0].items[0].uuid, NOWHERE);
  const list = names(g);
  for (const x of ["Hidden", "Vault", "Vault: safe", "B: benbag", "Guard: jar"]) assert.ok(list.includes(x), x);
  game.user = ana;
});

// ---- entry points ---------------------------------------------------------------
const { initEntryPoints } = await import("../scripts/ui/entry-points.mjs");
initEntryPoints();

await t("sheet header: owners get Send and Ledgers, GMs also get Receive, others get nothing", () => {
  const run = (user, actor) => {
    game.user = user;
    const controls = [];
    for (const fn of hooks.getHeaderControlsApplicationV2) fn({ document: actor }, controls);
    return controls.map((c) => c.action);
  };
  assert.deepEqual(run(ana, A), ["quickpay-send", "quickpay-ledgers"]);
  assert.deepEqual(run(gm, A), ["quickpay-send", "quickpay-receive", "quickpay-ledgers"]);
  assert.deepEqual(run(ana, B), [], "not your character");
  assert.deepEqual(run(ana, null), []);
  game.user = ana;
  const controls = [];
  for (const fn of hooks.getHeaderControlsApplicationV2) { fn({ document: A }, controls); fn({ document: A }, controls); }
  assert.equal(controls.length, 2, "no duplicates when the hook runs twice");
  assert.ok(controls.every((c) => typeof c.onClick === "function"));
});

await t("the sheet header ignores non-actor windows", () => {
  const controls = [];
  for (const fn of hooks.getHeaderControlsApplicationV2) fn({ document: { documentName: "Item" } }, controls);
  for (const fn of hooks.getHeaderControlsApplicationV2) fn({}, controls);
  assert.deepEqual(controls, []);
});

class HTMLElementStub {}
globalThis.HTMLElement = HTMLElementStub;
await t("token HUD: buttons only for usable actors, none twice", () => {
  const mkRoot = () => {
    const made = [];
    const col = { append: (b) => made.push(b), };
    const root = new HTMLElementStub();
    root.querySelector = (sel) => (sel === ".col.right" ? col : sel === "[data-quickpay]" ? (made.length ? made[0] : null) : null);
    return { root, made };
  };
  globalThis.document = { createElement: () => ({ dataset: {}, setAttribute() {}, addEventListener() {}, set innerHTML(v) {} }) };
  const hud = (actor) => ({ object: { actor } });
  game.user = ana;
  let { root, made } = mkRoot();
  for (const fn of hooks.renderTokenHUD) fn(hud(A), root);
  assert.equal(made.length, 1);
  for (const fn of hooks.renderTokenHUD) fn(hud(A), root);
  assert.equal(made.length, 1, "not added twice");
  ({ root, made } = mkRoot());
  for (const fn of hooks.renderTokenHUD) fn(hud(B), root);
  assert.equal(made.length, 0, "not your token");
  game.user = gm;
  ({ root, made } = mkRoot());
  for (const fn of hooks.renderTokenHUD) fn(hud(B), root);
  assert.deepEqual(made.map((b) => b.dataset.quickpay), ["send", "receive"]);
});

console.log(`\n${n} ui tests passed`);
