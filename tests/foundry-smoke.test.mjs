/**
 * Runs the real main.mjs, socket.mjs, settings.mjs, foundry-deps.mjs and the dnd5e
 * adapter against stand-ins for Foundry's globals. It cannot prove the module works
 * inside Foundry, but it catches wiring mistakes: wrong imports, wrong setting keys,
 * wrong argument order, and permission checks that read the wrong user.
 */
import assert from "node:assert/strict";

// ---- stand-ins for Foundry ---------------------------------------------------
const hooks = { once: {}, on: {} };
globalThis.Hooks = {
  once: (n, fn) => ((hooks.once[n] ??= []).push(fn)),
  on: (n, fn) => ((hooks.on[n] ??= []).push(fn)),
  callAll: (n, ...a) => (hooks.on[n] ?? []).forEach((fn) => fn(...a)),
};
const fire = async (n, ...a) => {
  for (const fn of hooks.once[n] ?? []) await fn(...a);
  hooks.once[n] = [];
  for (const fn of hooks.on[n] ?? []) await fn(...a);
};

globalThis.CONFIG = {
  DND5E: {
    currencies: {
      pp: { label: "Platinum", abbreviation: "pp", conversion: 0.1 },
      gp: { label: "Gold", abbreviation: "gp", conversion: 1 },
      ep: { label: "Electrum", abbreviation: "ep", conversion: 2 },
      sp: { label: "Silver", abbreviation: "sp", conversion: 10 },
      cp: { label: "Copper", abbreviation: "cp", conversion: 100 },
    },
  },
};

const mkUser = (id, isGM) => ({ id, name: id, isGM });
const gm = mkUser("gm", true), ana = mkUser("ana", false), ben = mkUser("ben", false), eve = mkUser("eve", false);
const userList = [gm, ana, ben, eve];

const settingStore = new Map();
const settingDefs = new Map();
const warnings = [];
const errors = [];

const game = {
  system: { id: "dnd5e" },
  ready: true,
  i18n: { localize: (s) => s },
  users: {
    contents: userList,
    get: (id) => userList.find((u) => u.id === id),
    has: (id) => userList.some((u) => u.id === id),
    activeGM: gm,
  },
  user: ana,
  userId: "ana",
  time: { worldTime: 5000 },
  modules: new Map([["dnd-quickpay", {}], ["socketlib", { active: true }]]),
  settings: {
    register: (mod, key, def) => { settingDefs.set(`${mod}.${key}`, def); settingStore.set(`${mod}.${key}`, structuredClone(def.default)); },
    get: (mod, key) => {
      assert.ok(settingDefs.has(`${mod}.${key}`), `setting ${mod}.${key} was never registered`);
      return settingStore.get(`${mod}.${key}`);
    },
    set: async (mod, key, v) => {
      assert.ok(settingDefs.has(`${mod}.${key}`), `setting ${mod}.${key} was never registered`);
      settingStore.set(`${mod}.${key}`, structuredClone(v));
    },
  },
};
globalThis.game = game;
globalThis.ui = { notifications: { warn: (m) => warnings.push(m), error: (m) => errors.push(m) } };
globalThis.foundry = { utils: { randomID: (n = 16) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, "x") } };

// Documents
const setPath = (obj, path, val) => {
  const keys = path.split(".");
  const last = keys.pop();
  let o = obj;
  for (const k of keys) o = o[k];
  o[last] = val;
};
const docsByUuid = new Map();
function makeActor(id, owners, currency = {}) {
  const a = {
    documentName: "Actor", id, name: id, uuid: `Actor.${id}`, parent: null, flags: {}, owners: new Set(owners),
    system: { currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...currency } },
    testUserPermission(u, level) { assert.equal(level, "OWNER"); return u.isGM || this.owners.has(u.id); },
    getFlag(scope, key) { return this.flags[`${scope}.${key}`]; },
    async update(upd) { for (const [p, v] of Object.entries(upd)) setPath(this, p, v); },
  };
  docsByUuid.set(a.uuid, a);
  return a;
}
function makeContainer(parent, id, flags = {}, currency = {}) {
  const c = {
    documentName: "Item", type: "container", id, name: id, parent, flags,
    uuid: `${parent.uuid}.Item.${id}`,
    system: { currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...currency } },
    testUserPermission: (u, l) => parent.testUserPermission(u, l),
    getFlag(scope, key) { return this.flags[`${scope}.${key}`]; },
    async update(upd) { for (const [p, v] of Object.entries(upd)) setPath(this, p, v); },
  };
  docsByUuid.set(c.uuid, c);
  return c;
}
globalThis.fromUuid = async (u) => docsByUuid.get(u) ?? null;
globalThis.fromUuidSync = (u) => docsByUuid.get(u) ?? null;

const A = makeActor("A", ["ana"], { gp: 16 });
const B = makeActor("B", ["ben"], { gp: 3 });
const NPC = makeActor("NPC", []);
const jar = makeContainer(NPC, "jar", { "dnd-quickpay.publicRecipient": true });
const secret = makeContainer(NPC, "secret");

// socketlib: runs the handler "on the GM client" and passes the caller's id as the real one does
const handlers = {};
globalThis.socketlib = {
  registerModule: (id) => {
    assert.equal(id, "dnd-quickpay");
    return {
      register: (name, fn) => { handlers[name] = fn; },
      executeAsGM: async (name, ...args) => handlers[name].apply({ socketdata: { userId: game.userId } }, args),
    };
  },
};

// ---- boot the real module ----------------------------------------------------
await import("../scripts/main.mjs");
await fire("socketlib.ready");
await fire("init");
await fire("ready");
const api = game.modules.get("dnd-quickpay").api;
assert.ok(api, "api was not created");

const as = (user) => { game.user = user; game.userId = user.id; };
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("ok  ", name); };

await t("settings register with defaults", () => {
  assert.equal(game.settings.get("dnd-quickpay", "expiryHours"), 12);
  assert.match(game.settings.get("dnd-quickpay", "offlineMessage"), /Bank Manager/);
});

await t("adapter reads real-looking dnd5e currency config", () => {
  const d = api.getDenominations();
  assert.deepEqual(d.map((x) => [x.key, x.value]), [["pp", 1000], ["gp", 100], ["ep", 50], ["sp", 10], ["cp", 1]]);
});

await t("player pays an NPC through the socket, with change", async () => {
  as(ana);
  const r = await api.request({ senderUuid: "Actor.A", recipientUuid: "Actor.NPC", amount: { sp: 15 }, note: "round" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.status, "completed");
  assert.deepEqual({ gp: A.system.currency.gp, sp: A.system.currency.sp }, { gp: 14, sp: 5 });
  assert.equal(NPC.system.currency.sp, 15);
});

await t("player pays a public container; a private one is refused", async () => {
  as(ana);
  const ok = await api.request({ senderUuid: "Actor.A", recipientUuid: jar.uuid, amount: { gp: 1 } });
  assert.equal(ok.status, "completed");
  assert.equal(jar.system.currency.gp, 1);
  const bad = await api.request({ senderUuid: "Actor.A", recipientUuid: secret.uuid, amount: { gp: 1 } });
  assert.equal(bad.ok, false);
  assert.equal(secret.system.currency.gp, 0);
});

let pendingId;
await t("player to player escrows, and visibility of the pending record is scoped", async () => {
  as(ana);
  const r = await api.request({ senderUuid: "Actor.A", recipientUuid: "Actor.B", amount: { gp: 2 } });
  assert.equal(r.status, "pending");
  pendingId = r.record.id;
  assert.equal(A.system.currency.gp, 11, "16 gp, minus 2 (change), minus 1 (jar), minus 2 (escrow)");
  assert.equal(B.system.currency.gp, 3);
  assert.equal(api.pending().length, 1, "sender sees it");
  as(ben);
  assert.equal(api.pending().length, 1, "recipient sees it");
  as(eve);
  assert.equal(api.pending().length, 0, "a bystander does not");
  as(gm);
  assert.equal(api.pending().length, 1, "GM sees it");
});

await t("only the recipient can accept; a bystander and the sender cannot", async () => {
  as(eve);
  assert.equal((await api.accept(pendingId)).ok, false);
  as(ana);
  assert.equal((await api.accept(pendingId)).ok, false);
  as(ben);
  const r = await api.accept(pendingId);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(B.system.currency.gp, 5);
});

await t("the log is GM-only and holds every resolved transfer", async () => {
  as(ana);
  assert.deepEqual(api.log(), []);
  as(gm);
  assert.equal(api.log().length, 3, "NPC payment, jar payment, accepted escrow; refused sends are not logged");
});

await t("a player cannot forge the caller: a handler with no socketdata refuses", async () => {
  const r = await handlers.request.call({}, { senderUuid: "Actor.B", recipientUuid: "Actor.A", amount: { gp: 1 } });
  assert.equal(r.ok, false);
  const r2 = await handlers.request.call({ socketdata: { userId: "not-a-user" } }, { senderUuid: "Actor.B", recipientUuid: "Actor.A", amount: { gp: 1 } });
  assert.equal(r2.ok, false);
  assert.equal(B.system.currency.gp, 5);
});

await t("a player cannot pass a different user in the arguments", async () => {
  as(eve);
  const r = await api.request({ userId: "gm", senderUuid: "Actor.B", recipientUuid: "Actor.A", amount: { gp: 1 } });
  assert.equal(r.ok, false);
  assert.equal(B.system.currency.gp, 5);
});

await t("no GM online: witty message, nothing taken", async () => {
  as(ana);
  game.users.activeGM = null;
  warnings.length = 0;
  const before = A.system.currency.gp;
  const r = await api.request({ senderUuid: "Actor.A", recipientUuid: "Actor.NPC", amount: { gp: 1 } });
  assert.equal(r.ok, false);
  assert.equal(r.offline, true);
  assert.deepEqual(warnings, ["This transaction needs Bank Manager approval."]);
  assert.equal(A.system.currency.gp, before);
  // blank message falls back to plain wording
  await game.settings.set("dnd-quickpay", "offlineMessage", "");
  warnings.length = 0;
  await api.request({ senderUuid: "Actor.A", recipientUuid: "Actor.NPC", amount: { gp: 1 } });
  assert.match(warnings[0], /GM needs to be online/);
  game.users.activeGM = gm;
});

await t("pending transfers expire when the world clock moves (active GM only)", async () => {
  as(ana);
  const r = await api.request({ senderUuid: "Actor.A", recipientUuid: "Actor.B", amount: { gp: 4 } });
  assert.equal(r.status, "pending");
  assert.equal(r.record.expiresAt, 5000 + 12 * 3600);
  const afterEscrow = A.system.currency.gp;

  // a player's client ticking does nothing
  game.worldTimeBackup = game.time.worldTime;
  game.time.worldTime += 13 * 3600;
  as(ben);
  await fire("updateWorldTime", game.time.worldTime);
  assert.equal(A.system.currency.gp, afterEscrow, "non-GM clients must not expire anything");

  // the GM's client does
  as(gm);
  await fire("updateWorldTime", game.time.worldTime);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(A.system.currency.gp, afterEscrow + 4);
  assert.equal(api.pending().length, 0);
  assert.equal(api.log().at(-1).status, "expired");
});

await t("GM can mint and remove coins through the same API", async () => {
  as(gm);
  const m = await api.request({ senderUuid: null, recipientUuid: "Actor.NPC", amount: { pp: 2 } });
  assert.equal(m.status, "completed");
  assert.equal(NPC.system.currency.pp, 2);
  const b = await api.request({ senderUuid: "Actor.NPC", recipientUuid: null, amount: { pp: 1 } });
  assert.equal(b.status, "completed");
  assert.equal(NPC.system.currency.pp, 1);
});

assert.deepEqual(errors, []);
console.log(`\n${n} smoke tests passed`);
