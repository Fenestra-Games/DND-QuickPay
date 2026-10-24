import assert from "node:assert/strict";
import { planPayment, applyDelta, toUnits, invertDelta, normalizeAmount } from "../scripts/core/coins.mjs";

const D = [
  { key: "pp", value: 1000, abbreviation: "pp" },
  { key: "gp", value: 100, abbreviation: "gp" },
  { key: "ep", value: 50, abbreviation: "ep", noChange: true },
  { key: "sp", value: 10, abbreviation: "sp" },
  { key: "cp", value: 1, abbreviation: "cp" },
];
const noEp = D.filter((d) => d.key !== "ep");
const bal = (o) => ({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...o });

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  ", name); };

t("exact denomination", () => {
  const r = planPayment(bal({ sp: 20 }), { sp: 15 }, D);
  assert.deepEqual(r.delta, { sp: -15 });
});

t("break gold, change in silver not electrum", () => {
  const r = planPayment(bal({ gp: 2 }), { sp: 15 }, D);
  assert.deepEqual(r.delta, { gp: -2, sp: 5 });
});

t("smaller coins are spent before breaking larger", () => {
  const r = planPayment(bal({ cp: 100, gp: 1 }), { sp: 15 }, D);
  assert.deepEqual(r.delta, { cp: -100, gp: -1, sp: 5 });
});

t("paying gold from silver", () => {
  const r = planPayment(bal({ sp: 100 }), { gp: 1 }, D);
  assert.deepEqual(r.delta, { sp: -10 });
});

t("mixed amount", () => {
  const r = planPayment(bal({ gp: 5, sp: 3 }), { gp: 1, sp: 5 }, D);
  assert.equal(r.cost, 150);
  assert.equal(toUnits(r.delta, D), -150);
});

t("insufficient funds", () => {
  const r = planPayment(bal({ gp: 1 }), { gp: 2 }, D);
  assert.equal(r.ok, false);
});

t("zero, negative, fractional and unknown denominations are rejected", () => {
  assert.equal(planPayment(bal({ gp: 5 }), {}, D).ok, false);
  assert.equal(planPayment(bal({ gp: 5 }), { gp: -1 }, D).ok, false);
  assert.equal(planPayment(bal({ gp: 5 }), { gp: 1.5 }, D).ok, false);
  assert.equal(planPayment(bal({ gp: 5 }), { xx: 1 }, D).ok, false);
});

t("filtered denominations are fully ignored", () => {
  // 1 ep (50) is held, but ep is filtered out, so it can't be spent
  assert.equal(planPayment(bal({ ep: 1 }), { sp: 5 }, noEp).ok, false);
  assert.equal(planPayment(bal({ ep: 1 }), { ep: 1 }, noEp).ok, false);
  const r = planPayment(bal({ gp: 1, ep: 9 }), { sp: 5 }, noEp);
  assert.deepEqual(r.delta, { gp: -1, sp: 5 });
});

t("electrum can be requested and spent when enabled", () => {
  const r = planPayment(bal({ ep: 2 }), { ep: 1 }, D);
  assert.deepEqual(r.delta, { ep: -1 });
});

t("normalizeAmount accepts clean input and drops zeros", () => {
  const r = normalizeAmount({ gp: 2, sp: 0 }, D);
  assert.equal(r.ok, true);
  assert.deepEqual(r.receive, { gp: 2 });
  assert.equal(r.cost, 200);
});

t("normalizeAmount rejects anything dodgy", () => {
  for (const bad of [
    null, undefined, [], "gp", 5, {}, { gp: 0 }, { gp: -1 }, { gp: 1.5 }, { gp: "2" }, { gp: NaN },
    { gp: Infinity }, { gp: 1e20 }, { gp: null }, { gp: true }, { xx: 1 }, { ep: 1 },
    JSON.parse('{"__proto__": 1}'), JSON.parse('{"constructor": 1}'),
  ]) {
    const denoms = bad && bad.ep ? noEp : D;
    assert.equal(normalizeAmount(bad, denoms).ok, false, JSON.stringify(bad));
  }
});

t("escrow refund restores the exact balance", () => {
  const start = bal({ gp: 2, sp: 1 });
  const r = planPayment(start, { sp: 15 }, D);
  const afterPay = applyDelta(start, r.delta);
  assert.ok(afterPay);
  assert.deepEqual(applyDelta(afterPay, invertDelta(r.delta)), start);
});

t("5000 random payments keep the invariants", () => {
  const rnd = (m) => Math.floor(Math.random() * (m + 1));
  for (let i = 0; i < 5000; i++) {
    const b = bal({ pp: rnd(3), gp: rnd(6), ep: rnd(4), sp: rnd(12), cp: rnd(40) });
    const a = {};
    for (const k of ["pp", "gp", "ep", "sp", "cp"]) if (rnd(2)) a[k] = 1 + rnd(8);
    const denoms = rnd(1) ? D : noEp;
    const r = planPayment(b, a, denoms);
    const held = toUnits(b, denoms);
    const want = toUnits(a, denoms);
    if (Object.keys(a).some((k) => !denoms.find((d) => d.key === k))) { assert.equal(r.ok, false); continue; }
    if (want === 0) { assert.equal(r.ok, false); continue; }
    // cp is always enabled, so change is always possible: fail only when broke
    assert.equal(r.ok, held >= want, JSON.stringify({ b, a }));
    if (!r.ok) continue;
    const after = applyDelta(b, r.delta);
    assert.ok(after, "balance went negative: " + JSON.stringify({ b, a, r }));
    assert.equal(toUnits(r.delta, D), -want, "value not conserved: " + JSON.stringify({ b, a, r }));
    assert.deepEqual(r.receive, a);
    for (const k of Object.keys(b)) if (!denoms.find((d) => d.key === k)) assert.equal(after[k], b[k]);
  }
});

console.log(`\n${n} test groups passed`);
