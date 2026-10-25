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
globalThis.game = { settings: { get: () => ({}) }, users: { contents: [gm, ana, ben] }, user: ana, actors: new FakeCollection(), items: new FakeCollection() };

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
  assert.deepEqual(run(ana, A), ["quickpay-send", "quickpay-containers", "quickpay-options", "quickpay-ledgers"]);
  assert.deepEqual(run(gm, A), ["quickpay-send", "quickpay-receive", "quickpay-containers", "quickpay-options", "quickpay-ledgers"]);
  assert.deepEqual(run(ana, B), [], "not your character");
  assert.deepEqual(run(ana, null), []);
  game.user = ana;
  const controls = [];
  for (const fn of hooks.getHeaderControlsApplicationV2) { fn({ document: A }, controls); fn({ document: A }, controls); }
  assert.equal(controls.length, 4, "no duplicates when the hook runs twice");
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
    root.querySelector = (sel) => (sel === ".col.left" ? col : sel === "[data-quickpay]" ? (made.length ? made[0] : null) : null);
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

await t("token HUD buttons go in the left column and are gold", () => {
  const appended = [];
  const left = { append: (b) => appended.push(["left", b]) };
  const right = { append: (b) => appended.push(["right", b]) };
  const root = new HTMLElementStub();
  root.querySelector = (sel) => (sel === ".col.left" ? left : sel === ".col.right" ? right : null);
  let html = "";
  globalThis.document = { createElement: () => ({ dataset: {}, setAttribute() {}, addEventListener() {}, set innerHTML(v) { html += v; } }) };
  game.user = ana;
  for (const fn of hooks.renderTokenHUD) fn({ object: { actor: A } }, root);
  assert.deepEqual(appended.map((a) => a[0]), ["left"]);
  assert.match(html, /quickpay-gold/);
});

await t("sheet header icons are gold, and containers add a Public containers entry", () => {
  game.user = ana;
  const controls = [];
  for (const fn of hooks.getHeaderControlsApplicationV2) fn({ document: A }, controls);
  assert.ok(controls.every((c) => c.icon.includes("quickpay-gold")));
  assert.ok(controls.some((c) => c.action === "quickpay-containers"), "A has a bag");
  const noBag = [];
  for (const fn of hooks.getHeaderControlsApplicationV2) fn({ document: Guard }, noBag);
  assert.deepEqual(noBag, [], "Guard isn't owned by Ana");
});

// ---- GM toolbar -----------------------------------------------------------------
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: {} } } };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.canvas.tokens.controlled = [];
const { initGMTools } = await import("../scripts/ui/gm-tools.mjs");
initGMTools();

await t("scene controls: only a GM gets the QuickPay group, with every tool as a button", () => {
  const run = (user) => { game.user = user; const c = {}; for (const fn of hooks.getSceneControlButtons) fn(c); return c; };
  assert.deepEqual(run(ana), {});
  const c = run(gm);
  assert.ok(c.quickpay);
  const tools = Object.values(c.quickpay.tools);
  assert.deepEqual(tools.map((x) => x.name), ["qp-send", "qp-receive", "qp-ledgers", "qp-containers", "qp-options", "qp-personal", "qp-creators"]);
  assert.ok(tools.every((x) => x.button === true && typeof x.onChange === "function" && x.icon.includes("quickpay-gold")));
  assert.ok(c.quickpay.icon.includes("quickpay-gold"));
  assert.ok(Object.keys(c.quickpay.tools).includes(c.quickpay.activeTool));
});

await t("the send and receive tools ask for a token when none is selected", () => {
  game.user = gm;
  const warned = [];
  ui.notifications.warn = (m) => warned.push(m);
  const c = {}; for (const fn of hooks.getSceneControlButtons) fn(c);
  c.quickpay.tools["qp-send"].onChange();
  c.quickpay.tools["qp-receive"].onChange();
  assert.deepEqual(warned, ["Select a token first.", "Select a token first."]);
});

const { tokenAt } = await import("../scripts/ui/pick.mjs");
const box = (name, x, y) => ({ name, bounds: { x, y, width: 100, height: 100 } });

await t("picking: hit-testing finds the topmost token, including its edges, and misses empty space", () => {
  const under = box("under", 0, 0);
  const over = box("over", 50, 50);
  assert.equal(tokenAt({ x: 75, y: 75 }, [under, over]).name, "over");
  assert.equal(tokenAt({ x: 25, y: 25 }, [under, over]).name, "under");
  assert.equal(tokenAt({ x: 100, y: 100 }, [under]).name, "under", "edges count");
  assert.equal(tokenAt({ x: 101, y: 50 }, [under]), null);
  assert.equal(tokenAt({ x: 5, y: 5 }, []), null);
  assert.equal(tokenAt({ x: 5, y: 5 }, [{ name: "no bounds" }]), null);
});

const { flaggableContainers } = await import("../scripts/ui/public-containers.mjs");

await t("when only the GM may flag containers, players get none and no menu entry", () => {
  const real = game.settings.get;
  game.settings.get = (m, k) => (k === "options" ? { containerFlagging: "gm" } : {});
  assert.deepEqual(flaggableContainers(ana), []);
  assert.equal(flaggableContainers(gm).length, 4);
  game.user = ana;
  const controls = [];
  for (const fn of hooks.getHeaderControlsApplicationV2) fn({ document: A }, controls);
  assert.ok(!controls.some((c) => c.action === "quickpay-containers"));
  game.settings.get = real;
});

await t("public containers: players see only containers they own, GMs see all", () => {
  const names = (user) => flaggableContainers(user).map((c) => c.name).sort();
  assert.deepEqual(names(ana), ["bag"]);
  assert.deepEqual(names(ben), ["benbag"]);
  assert.deepEqual(names(gm), ["bag", "benbag", "jar", "safe"]);
  assert.deepEqual(flaggableContainers(gm, Guard).map((c) => c.name), ["jar"]);
});

console.log(`\n${n} ui tests passed`);
