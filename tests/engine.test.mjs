import assert from "node:assert/strict";
import { createEngine } from "../scripts/core/engine.mjs";
import { toUnits } from "../scripts/core/coins.mjs";

const ALL = [
  { key: "pp", value: 1000, abbreviation: "pp" },
  { key: "gp", value: 100, abbreviation: "gp" },
  { key: "ep", value: 50, abbreviation: "ep", noChange: true },
  { key: "sp", value: 10, abbreviation: "sp" },
  { key: "cp", value: 1, abbreviation: "cp" },
];
const zero = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };

/** A tiny fake world. Users: gm, ana (owns A), ben (owns B and the Priv container). */
function makeWorld({ hidden = [], hours = 12 } = {}) {
  const T = { now: 1000 };
  const users = { gm: { isGM: true, name: "GM" }, ana: { isGM: false, name: "Ana" }, ben: { isGM: false, name: "Ben" } };
  const docs = new Map();
  const add = (uuid, kind, bal, owners = []) => {
    const d = { uuid, kind, name: uuid, bal: { ...zero, ...bal }, owners: new Set(owners), acceptance: true, public: false, failCommit: false };
    docs.set(uuid, d);
    return d;
  };
  const A = add("A", "actor", {}, ["ana"]);
  const B = add("B", "actor", {}, ["ben"]);
  const NPC = add("NPC", "actor", {});
  const Pot = add("Pot", "container", {});
  Pot.public = true;
  const Priv = add("Priv", "container", {}, ["ben"]);
  const Locked = add("Locked", "container", {});

  let pending = {};
  const log = [];
  const events = [];
  let id = 0;

  const deps = {
    docs: {
      resolve: async (u) => docs.get(u) ?? null,
      uuid: (d) => d.uuid,
      name: (d) => d.name,
      kind: (d) => d.kind,
      userExists: (u) => u in users,
      userName: (u) => users[u].name,
      isGM: (u) => users[u]?.isGM === true,
      userOwns: (u, d) => users[u].isGM || d.owners.has(u),
      isPlayerOwned: (a) => [...a.owners].some((u) => !users[u].isGM),
      acceptanceFlag: (a) => a.acceptance,
      isPublic: (c) => c.public,
    },
    coins: {
      getDenominations: ({ hidden: h = [] } = {}) => ALL.filter((d) => !h.includes(d.key)),
      getBalance: (d) => ({ ...d.bal }),
      holdsCurrency: () => true,
      commit: async (d, delta) => {
        if (d.failCommit) return false;
        const next = { ...d.bal };
        for (const [k, n] of Object.entries(delta)) {
          next[k] = (next[k] ?? 0) + n;
          if (next[k] < 0) return false;
        }
        d.bal = next;
        return true;
      },
    },
    store: {
      loadPending: async () => structuredClone(pending),
      savePending: async (o) => { pending = structuredClone(o); },
      appendLog: async (r) => { log.push(structuredClone(r)); },
    },
    settings: { expiryHours: () => hours, hidden: () => hidden, defaultVisibility: () => "public" },
    now: () => T.now,
    newId: () => `id${++id}`,
    emit: (name, rec) => events.push([name, rec.id, rec.status]),
  };

  const total = () => {
    let sum = 0;
    for (const d of docs.values()) sum += toUnits(d.bal, ALL);
    for (const r of Object.values(pending)) if (r.sender) sum += toUnits(r.amount, ALL);
    return sum;
  };
  return { T, users, docs, A, B, NPC, Pot, Priv, Locked, log, events, deps, engine: createEngine(deps), total, getPending: () => pending };
}

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("ok  ", name); };
const send = (w, user, from, to, amount, extra = {}) =>
  w.engine.request(user, { senderUuid: from, recipientUuid: to, amount, ...extra });

await t("player to an NPC completes straight away and logs", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "NPC", { gp: 2 }, { note: "tip" });
  assert.equal(r.ok, true);
  assert.equal(r.status, "completed");
  assert.equal(w.A.bal.gp, 3);
  assert.equal(w.NPC.bal.gp, 2);
  assert.equal(w.log.length, 1);
  assert.equal(w.log[0].note, "tip");
  assert.equal(w.log[0].resolution, "auto");
  assert.deepEqual(w.getPending(), {});
});

await t("player to a player-owned actor is held in escrow until accepted", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { gp: 2 });
  assert.equal(r.status, "pending");
  assert.equal(w.A.bal.gp, 3, "sender debited at once");
  assert.equal(w.B.bal.gp, 0, "recipient not yet credited");
  assert.equal(r.record.expiresAt, 1000 + 12 * 3600);
  const acc = await w.engine.accept("ben", r.record.id);
  assert.equal(acc.ok, true);
  assert.equal(w.B.bal.gp, 2);
  assert.equal(w.log.at(-1).resolution, "accepted");
  assert.deepEqual(w.getPending(), {});
});

await t("decline refunds the sender exactly", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { sp: 15 });
  assert.deepEqual({ gp: w.A.bal.gp, sp: w.A.bal.sp }, { gp: 3, sp: 5 });
  const d = await w.engine.decline("ben", r.record.id);
  assert.equal(d.ok, true);
  assert.deepEqual({ gp: w.A.bal.gp, sp: w.A.bal.sp }, { gp: 5, sp: 0 });
  assert.equal(w.log.at(-1).status, "declined");
});

await t("refund falls back to the escrowed coins if the change was spent", async () => {
  const w = makeWorld();
  w.A.bal.gp = 2;
  const r = await send(w, "ana", "A", "B", { sp: 15 }); // A: 5 sp left
  w.A.bal.sp = 0; // A spends the change
  const before = toUnits(w.A.bal, ALL);
  await w.engine.decline("ben", r.record.id);
  assert.equal(toUnits(w.A.bal, ALL) - before, 150, "full value returned");
  assert.deepEqual(w.A.bal, { ...zero, sp: 15 });
});

await t("sender can cancel, a stranger cannot", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { gp: 1 });
  const bad = await w.engine.cancel("ben", r.record.id);
  assert.equal(bad.ok, false);
  const good = await w.engine.cancel("ana", r.record.id);
  assert.equal(good.ok, true);
  assert.equal(w.A.bal.gp, 5);
  assert.equal(w.log.at(-1).resolution, "cancelled");
});

await t("only the recipient or a GM can accept or decline", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { gp: 1 });
  assert.equal((await w.engine.accept("ana", r.record.id)).ok, false, "sender cannot accept");
  assert.equal((await w.engine.decline("ana", r.record.id)).ok, false, "sender cannot decline");
  const gm = await w.engine.accept("gm", r.record.id);
  assert.equal(gm.ok, true);
  assert.equal(w.log.at(-1).resolution, "accepted-by-gm");
  assert.equal(w.B.bal.gp, 1);
});

await t("a transfer cannot be resolved twice", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { gp: 1 });
  assert.equal((await w.engine.accept("ben", r.record.id)).ok, true);
  assert.equal((await w.engine.accept("ben", r.record.id)).ok, false);
  assert.equal((await w.engine.decline("ben", r.record.id)).ok, false);
  assert.equal(w.B.bal.gp, 1);
  assert.equal(w.A.bal.gp, 4);
});

await t("expiry refunds after the in-world timeout", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  await send(w, "ana", "A", "B", { gp: 2 });
  w.T.now += 12 * 3600 - 1;
  assert.equal(await w.engine.expireDue(), 0);
  assert.equal(w.A.bal.gp, 3);
  w.T.now += 1;
  assert.equal(await w.engine.expireDue(), 1);
  assert.equal(w.A.bal.gp, 5);
  assert.equal(w.log.at(-1).status, "expired");
  assert.deepEqual(w.getPending(), {});
});

await t("accepting after the deadline refunds instead", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { gp: 2 });
  w.T.now += 13 * 3600;
  const acc = await w.engine.accept("ben", r.record.id);
  assert.equal(acc.ok, false);
  assert.equal(w.A.bal.gp, 5);
  assert.equal(w.B.bal.gp, 0);
  assert.equal(w.log.at(-1).status, "expired");
});

await t("acceptance can be switched off per actor", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  w.B.acceptance = false;
  const r = await send(w, "ana", "A", "B", { gp: 2 });
  assert.equal(r.status, "completed");
  assert.equal(w.B.bal.gp, 2);
});

await t("moving coins between your own actor and container skips acceptance", async () => {
  const w = makeWorld();
  w.B.bal.gp = 4;
  const r = await send(w, "ben", "B", "Priv", { gp: 3 });
  assert.equal(r.status, "completed");
  assert.equal(w.Priv.bal.gp, 3);
});

await t("public containers accept from anyone, private ones do not", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const pot = await send(w, "ana", "A", "Pot", { gp: 1 });
  assert.equal(pot.status, "completed");
  assert.equal(w.Pot.bal.gp, 1);
  const priv = await send(w, "ana", "A", "Priv", { gp: 1 });
  assert.equal(priv.ok, false);
  const locked = await send(w, "ana", "A", "Locked", { gp: 1 });
  assert.equal(locked.ok, false);
  assert.equal(w.A.bal.gp, 4, "refused sends take nothing");
});

await t("players cannot spend from actors they do not own", async () => {
  const w = makeWorld();
  w.B.bal.gp = 5;
  const r = await send(w, "ana", "B", "A", { gp: 1 });
  assert.equal(r.ok, false);
  assert.equal(w.B.bal.gp, 5);
});

await t("players cannot mint or burn, GMs can", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  assert.equal((await send(w, "ana", null, "A", { gp: 50 })).ok, false);
  assert.equal((await send(w, "ana", "A", null, { gp: 1 })).ok, false);
  assert.equal(w.A.bal.gp, 5);

  const mint = await send(w, "gm", null, "NPC", { gp: 10 });
  assert.equal(mint.status, "completed");
  assert.equal(w.NPC.bal.gp, 10);

  const burn = await send(w, "gm", "NPC", null, { gp: 4 });
  assert.equal(burn.status, "completed");
  assert.equal(w.NPC.bal.gp, 6);
  assert.equal(w.log.at(-1).resolution, "removed");
});

await t("a GM mint into a player actor waits for acceptance and refunds nothing", async () => {
  const w = makeWorld();
  const r = await send(w, "gm", null, "A", { gp: 10 });
  assert.equal(r.status, "pending");
  assert.equal(w.A.bal.gp, 0);
  await w.engine.decline("ana", r.record.id);
  assert.equal(w.A.bal.gp, 0);
  assert.equal(w.log.at(-1).status, "declined");
});

await t("a GM sending to a player still needs acceptance", async () => {
  const w = makeWorld();
  w.NPC.bal.gp = 10;
  const r = await send(w, "gm", "NPC", "A", { gp: 3 });
  assert.equal(r.status, "pending");
  assert.equal(w.NPC.bal.gp, 7);
});

await t("not enough coin: nothing moves", async () => {
  const w = makeWorld();
  w.A.bal.gp = 1;
  const r = await send(w, "ana", "A", "NPC", { gp: 2 });
  assert.equal(r.ok, false);
  assert.equal(w.A.bal.gp, 1);
  assert.equal(w.log.length, 0);
});

await t("same sender and recipient, missing docs and missing targets are rejected", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  assert.equal((await send(w, "ana", "A", "A", { gp: 1 })).ok, false);
  assert.equal((await send(w, "ana", "A", "Nope", { gp: 1 })).ok, false);
  assert.equal((await send(w, "ana", "Nope", "NPC", { gp: 1 })).ok, false);
  assert.equal((await send(w, "gm", null, null, { gp: 1 })).ok, false);
  assert.equal((await send(w, "stranger", "A", "NPC", { gp: 1 })).ok, false);
  assert.equal(w.A.bal.gp, 5);
});

await t("hostile input is rejected", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  for (const amount of [
    { gp: -1 }, { gp: 1.5 }, { gp: "2" }, { gp: NaN }, { gp: Infinity }, { gp: 1e20 },
    { xx: 1 }, { __proto__: { gp: 1 } }, JSON.parse('{"__proto__": 1}'), [], null, "gp", 5, {},
  ]) {
    const r = await send(w, "ana", "A", "NPC", amount);
    assert.equal(r.ok, false, JSON.stringify(amount));
  }
  assert.equal((await w.engine.request("ana", null)).ok, false);
  assert.equal((await w.engine.request("ana", { senderUuid: 5, recipientUuid: "NPC", amount: { gp: 1 } })).ok, false);
  assert.equal(w.A.bal.gp, 5);
  assert.equal(w.NPC.bal.gp, 0);
});

await t("note is trimmed and capped, visibility and ledger are sanitised", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "NPC", { gp: 1 }, { note: "  " + "x".repeat(900) + "  ", visibility: "everyone", ledgerId: 42 });
  assert.equal(r.record.note.length, 500);
  assert.equal(r.record.visibility, "public");
  assert.equal(r.record.ledgerId, null);
  const r2 = await send(w, "ana", "A", "NPC", { gp: 1 }, { visibility: "gm", ledgerId: "party" });
  assert.equal(r2.record.visibility, "gm");
  assert.equal(r2.record.ledgerId, "party");
});

await t("hidden denominations are ignored", async () => {
  const w = makeWorld({ hidden: ["ep"] });
  w.A.bal.ep = 4;
  assert.equal((await send(w, "ana", "A", "NPC", { sp: 5 })).ok, false, "cannot spend electrum");
  assert.equal((await send(w, "ana", "A", "NPC", { ep: 1 })).ok, false, "cannot request electrum");
  assert.equal(w.A.bal.ep, 4);
});

await t("a failed credit rolls the sender back", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  w.NPC.failCommit = true;
  const r = await send(w, "ana", "A", "NPC", { gp: 2 });
  assert.equal(r.ok, false);
  assert.equal(w.A.bal.gp, 5);
  assert.equal(w.log.length, 0);
});

await t("a failed accept leaves the transfer pending and the coins in escrow", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { gp: 2 });
  w.B.failCommit = true;
  assert.equal((await w.engine.accept("ben", r.record.id)).ok, false);
  assert.equal(Object.keys(w.getPending()).length, 1);
  w.B.failCommit = false;
  assert.equal((await w.engine.accept("ben", r.record.id)).ok, true);
  assert.equal(w.B.bal.gp, 2);
});

await t("deleted recipient: accept returns the coins to the sender", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { gp: 2 });
  w.docs.delete("B");
  const acc = await w.engine.accept("gm", r.record.id);
  assert.equal(acc.ok, false);
  assert.equal(w.A.bal.gp, 5);
  assert.equal(w.log.at(-1).resolution, "recipient-missing");
});

await t("deleted sender: decline still resolves, refund reported as failed", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { gp: 2 });
  w.docs.delete("A");
  const d = await w.engine.decline("ben", r.record.id);
  assert.equal(d.ok, true);
  assert.equal(d.refunded, false);
  assert.equal(w.log.at(-1).refunded, false);
});

await t("two simultaneous requests cannot spend the same coins", async () => {
  const w = makeWorld();
  w.A.bal.gp = 10;
  const results = await Promise.all([
    send(w, "ana", "A", "NPC", { gp: 8 }),
    send(w, "ana", "A", "NPC", { gp: 8 }),
    send(w, "ana", "A", "Pot", { gp: 8 }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(w.A.bal.gp, 2);
  assert.equal(w.NPC.bal.gp + w.Pot.bal.gp, 8);
});

await t("events fire for pending and resolved transfers", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  const r = await send(w, "ana", "A", "B", { gp: 1 });
  await w.engine.decline("ben", r.record.id);
  assert.deepEqual(w.events.map((e) => e[0]), ["transferPending", "transferResolved"]);
});

await t("log records carry the stable schema", async () => {
  const w = makeWorld();
  w.A.bal.gp = 5;
  await send(w, "ana", "A", "NPC", { gp: 1 }, { note: "x", ledgerId: "party" });
  const rec = w.log[0];
  for (const k of ["version", "id", "status", "createdAt", "createdReal", "expiresAt", "initiatedBy", "sender", "recipient",
    "amount", "escrow", "note", "visibility", "ledgerId", "resolution", "resolvedAt", "resolvedBy"]) {
    assert.ok(k in rec, `missing ${k}`);
  }
  assert.equal(rec.version, 1);
});

await t("1000 random operations never create or destroy coins", async () => {
  const rnd = (m) => Math.floor(Math.random() * m);
  const pick = (a) => a[rnd(a.length)];
  for (let round = 0; round < 40; round++) {
    const w = makeWorld();
    w.A.bal = { ...zero, gp: 20, sp: 5 };
    w.B.bal = { ...zero, gp: 10, cp: 30 };
    w.NPC.bal = { ...zero, pp: 2 };
    w.Priv.bal = { ...zero, ep: 3 };
    const start = w.total();
    const ids = ["A", "B", "NPC", "Pot", "Priv"];
    for (let i = 0; i < 25; i++) {
      const op = rnd(6);
      const pend = Object.keys(w.getPending());
      const amt = {};
      for (const k of ["pp", "gp", "ep", "sp", "cp"]) if (rnd(3) === 0) amt[k] = 1 + rnd(12);
      if (op <= 2) {
        const from = pick(ids);
        let to = pick(ids);
        if (to === from) to = "NPC";
        const user = pick(["ana", "ben", "gm"]);
        await Promise.all([send(w, user, from, to, amt), rnd(2) ? send(w, user, from, pick(ids), amt) : null]);
      } else if (op === 3 && pend.length) await w.engine.accept(pick(["ana", "ben", "gm"]), pick(pend));
      else if (op === 4 && pend.length) await w.engine.decline(pick(["ana", "ben", "gm"]), pick(pend));
      else if (op === 5) { w.T.now += rnd(8) * 3600; await w.engine.expireDue(); }
      assert.equal(w.total(), start, "coins were created or destroyed");
      for (const d of w.docs.values()) for (const v of Object.values(d.bal)) assert.ok(v >= 0 && Number.isInteger(v));
    }
    // everything pending can still be unwound
    for (const id of Object.keys(w.getPending())) await w.engine.cancel("gm", id);
    assert.deepEqual(w.getPending(), {});
    assert.equal(w.total(), start);
  }
});

console.log(`\n${n} engine tests passed`);
