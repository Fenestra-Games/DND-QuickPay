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
function makeActor(id, owners, currency = {}, type = "character") {
  const a = {
    documentName: "Actor", type, id, name: id, uuid: `Actor.${id}`, parent: null, flags: {}, owners: new Set(owners),
    system: { currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...currency } },
    testUserPermission(u, level) { assert.equal(level, "OWNER"); return u.isGM || this.owners.has(u.id); },
    getFlag(scope, key) { return this.flags[`${scope}.${key}`]; },
    async setFlag(scope, key, v) { this.flags[`${scope}.${key}`] = v; },
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
const NPC = makeActor("NPC", [], {}, "npc");
const jar = makeContainer(NPC, "jar", { "dnd-quickpay.publicRecipient": true });
const secret = makeContainer(NPC, "secret");


// Chat, journals and folders
const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: LEVELS };
const messages = [];
game.messages = Object.assign(messages, {});
globalThis.ChatMessage = {
  create: async (data) => {
    const m = {
      ...structuredClone(data), id: `m${messages.length}`,
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
      async update(upd) { for (const [k, v] of Object.entries(upd)) { if (k.startsWith("flags.")) { const [, sc, key] = k.split("."); this.flags[sc][key] = v; } else this[k] = v; } },
    };
    messages.push(m);
    return m;
  },
};
const journals = [];
const folders = [];
game.journal = { contents: journals, get: (id) => journals.find((j) => j.id === id) };
game.folders = { find: (fn) => folders.find(fn) };
game.actors = { contents: [] };
globalThis.Folder = { create: async (d) => { const f = { ...d, id: `f${folders.length}`, getFlag: (sc, k) => d.flags?.[sc]?.[k] }; folders.push(f); return f; } };
globalThis.JournalEntry = {
  create: async (d) => {
    const j = {
      documentName: "JournalEntry", id: `j${journals.length}`, name: d.name, folder: d.folder,
      ownership: structuredClone(d.ownership), flags: structuredClone(d.flags),
      pages: { contents: d.pages.map((p) => ({ ...structuredClone(p), async update(u) { this.text.content = u["text.content"]; } })) },
      getFlag(sc, k) { return this.flags[sc]?.[k]; },
      async setFlag(sc, k, v) { (this.flags[sc] ??= {})[k] = structuredClone(v); },
      async update(u) { if (u.ownership) this.ownership = { ...this.ownership, ...u.ownership }; },
      testUserPermission(user, level) { return user.isGM || (this.ownership[user.id] ?? this.ownership.default ?? 0) >= LEVELS[level]; },
    };
    journals.push(j);
    return j;
  },
};
game.time.calendar = { format: (secs) => `T+${secs}` };

// socketlib: runs the handler "on the GM client" and passes the caller's id as the real one does.
// Like the real library, it refuses modules whose module.json lacks "socket": true.
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
const handlers = {};
globalThis.socketlib = {
  registerModule: (id) => {
    assert.equal(id, "dnd-quickpay");
    if (!manifest.socket) {
      console.error(`socketlib stand-in: ${id} has no "socket": true in module.json, returning undefined`);
      return undefined;
    }
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


// ---- stage 3a: chat cards and ledgers -------------------------------------------
game.actors.contents.push(A, B, NPC);

await t("chat: an instant transfer posts a result card; public means no whisper", async () => {
  as(ana);
  messages.length = 0;
  const r = await api.request({ senderUuid: "Actor.A", recipientUuid: "Actor.NPC", amount: { gp: 1 }, note: "<b>tip</b>" });
  assert.equal(r.status, "completed");
  const card = messages.find((m) => m.flags["dnd-quickpay"].role === "result");
  assert.ok(card);
  assert.equal(card.whisper, undefined);
  assert.ok(!card.content.includes("<b>tip"), "notes are escaped");
});

await t("chat: a pending transfer prompts the recipient and shows the sender a waiting card, then settles both", async () => {
  as(ana);
  messages.length = 0;
  const r = await api.request({ senderUuid: "Actor.A", recipientUuid: "Actor.B", amount: { gp: 1 }, visibility: "gm" });
  assert.equal(r.status, "pending");
  const prompts = messages.filter((m) => m.flags["dnd-quickpay"].role === "pending");
  assert.equal(prompts.length, 2);
  const forRecipient = prompts.find((m) => m.content.includes('data-quickpay-action="accept"'));
  assert.deepEqual([...forRecipient.whisper].sort(), ["ben", "gm"]);
  const forSender = prompts.find((m) => m.content.includes("Waiting for"));
  assert.deepEqual(forSender.whisper, ["ana"]);
  as(ben);
  await api.accept(r.record.id);
  assert.ok(prompts.every((m) => m.flags["dnd-quickpay"].role === "settled" && !m.content.includes("<button")));
  const result = messages.find((m) => m.flags["dnd-quickpay"].role === "result");
  assert.deepEqual([...result.whisper].sort(), ["ana", "gm"], "GM only visibility reaches the GM and the sender");
});

await t("personal ledgers: created on first transfer for player characters, not for NPCs", async () => {
  const pj = journals.filter((j) => j.flags["dnd-quickpay"].ledger.kind === "personal");
  const names = pj.map((j) => j.name).sort();
  assert.deepEqual(names, ["A (QuickPay ledger)", "B (QuickPay ledger)"]);
  assert.ok(!names.some((x) => x.startsWith("NPC")));
});

await t("personal ledgers: owner can read, others cannot", async () => {
  const jA = journals.find((j) => j.name === "A (QuickPay ledger)");
  assert.equal(jA.testUserPermission(ana, "OBSERVER"), true);
  assert.equal(jA.testUserPermission(ben, "OBSERVER"), false);
  assert.equal(jA.testUserPermission(eve, "OBSERVER"), false);
  as(ana);
  assert.ok(api.ledgers.read(jA.id));
  as(ben);
  assert.equal(api.ledgers.read(jA.id), null);
});

await t("personal ledgers: money in and out, and GM-only deposits are anonymous to the player", async () => {
  as(gm);
  const r = await api.request({ senderUuid: null, recipientUuid: "Actor.B", amount: { gp: 7 }, visibility: "gm", note: "secret patron" });
  assert.equal(r.status, "pending", "players must accept by default");
  assert.equal((await api.accept(r.record.id)).ok, true, "the GM can accept on their behalf");
  const jB = journals.find((j) => j.name === "B (QuickPay ledger)");
  const mine = jB.flags["dnd-quickpay"].ledger.entries.find((e) => e.id === r.record.id);
  assert.equal(mine.hidden, true);
  assert.equal(mine.direction, "in");
  const page = jB.pages.contents[0].text.content;
  assert.match(page, /Unknown deposit/);
  assert.ok(!JSON.stringify(jB.flags).includes("secret patron"), "the note must not be stored where the player can read it");
  assert.ok(!page.includes("secret patron"));
  // the same transfer is plain to the GM-side NPC ledger if one existed; here, an ordinary deposit stays readable
  const ordinary = await api.request({ senderUuid: null, recipientUuid: "Actor.B", amount: { gp: 1 }, note: "wages" });
  await api.accept(ordinary.record.id);
  const e2 = jB.flags["dnd-quickpay"].ledger.entries.find((e) => e.id === ordinary.record.id);
  assert.equal(e2.hidden, false);
  assert.equal(e2.note, "wages");
});

await t("personal ledgers: NPCs opt in individually", async () => {
  as(gm);
  assert.equal(await api.ledgers.setPersonal("Actor.NPC", true), true);
  assert.ok(journals.some((j) => j.name === "NPC (QuickPay ledger)"));
  const r = await api.request({ senderUuid: null, recipientUuid: "Actor.NPC", amount: { gp: 2 }, visibility: "gm", note: "gm note" });
  const jN = journals.find((j) => j.name === "NPC (QuickPay ledger)");
  const e = jN.flags["dnd-quickpay"].ledger.entries.find((x) => x.id === r.record.id);
  assert.equal(e.hidden, false, "nobody to hide from on an NPC");
  assert.equal(e.note, "gm note");
  as(ana);
  assert.equal(await api.ledgers.setPersonal("Actor.NPC", false), false, "players cannot change this");
});

await t("business ledgers: GM only by default, tagged transfers land in them, amend moves them", async () => {
  as(ana);
  const denied = await api.ledgers.create("Jims Pickles");
  assert.equal(denied.ok, false);
  as(gm);
  assert.equal(await api.setLedgerCreators({ mode: "users", users: ["ana", "nobody"] }), true);
  as(ana);
  const made = await api.ledgers.create("Jims Pickles");
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.deepEqual(api.ledgers.list().map((l) => l.name), ["Jims Pickles"]);
  as(ben);
  assert.deepEqual(api.ledgers.list(), [], "ben cannot see it");
  as(ana);
  const r = await api.request({ senderUuid: "Actor.A", recipientUuid: "Actor.NPC", amount: { gp: 1 }, ledgerId: made.id });
  assert.equal(r.status, "completed");
  assert.equal(api.ledgers.read(made.id).entries.length, 1);
  const a = await api.amend(r.record.id, { note: "fixed" });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(api.ledgers.read(made.id).entries[0].note, "fixed");
  as(ben);
  assert.equal((await api.amend(r.record.id, { note: "hack" })).ok, false);
  as(ana);
  const none = await api.amend(r.record.id, { ledgerId: null });
  assert.equal(none.ok, true);
  assert.equal(api.ledgers.read(made.id).entries.length, 0);
});

await t("business ledger reading is refused to non-observers", async () => {
  const j = journals.find((x) => x.name === "Jims Pickles");
  as(eve);
  assert.equal(api.ledgers.read(j.id), null);
});

assert.deepEqual(errors, []);
console.log(`\n${n} smoke tests passed`);
