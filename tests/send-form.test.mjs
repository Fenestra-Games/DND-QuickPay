import assert from "node:assert/strict";
import { parseAmounts, previewLines, mintLines, resultMessage, balanceText } from "../scripts/core/send-form.mjs";
import { planPayment } from "../scripts/core/coins.mjs";

const denoms = [
  { key: "pp", value: 1000, abbreviation: "pp" },
  { key: "gp", value: 100, abbreviation: "gp" },
  { key: "sp", value: 10, abbreviation: "sp" },
  { key: "cp", value: 1, abbreviation: "cp" },
];
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  ", name); };

t("blank fields are zero, and an all-blank form is empty", () => {
  assert.deepEqual(parseAmounts({ gp: "", sp: "  " }), { ok: true, amount: {}, empty: true });
  assert.deepEqual(parseAmounts({}), { ok: true, amount: {}, empty: true });
  assert.deepEqual(parseAmounts({ gp: "0" }), { ok: true, amount: {}, empty: true });
});

t("whole numbers pass, with padding trimmed", () => {
  assert.deepEqual(parseAmounts({ gp: " 3 ", sp: "15", cp: 2 }), { ok: true, amount: { gp: 3, sp: 15, cp: 2 }, empty: false });
});

t("bad input is refused", () => {
  for (const bad of ["-1", "1.5", "1e3", "abc", "0x10", "9".repeat(20)]) {
    assert.equal(parseAmounts({ gp: bad }).ok, false, bad);
  }
});

t("preview shows payment, change, recipient and what is left", () => {
  const bal = { pp: 0, gp: 2, sp: 0, cp: 0 };
  const plan = planPayment(bal, { sp: 5 }, denoms);
  const p = previewLines(plan, bal, denoms);
  assert.equal(p.ok, true);
  assert.deepEqual(p.lines, ["Pays 1 gp", "Change back: 5 sp", "Recipient gets 5 sp", "Left afterwards: 1 gp, 5 sp"]);
});

t("preview without change leaves that line out", () => {
  const bal = { gp: 5 };
  const p = previewLines(planPayment(bal, { gp: 2 }, denoms), bal, denoms);
  assert.deepEqual(p.lines, ["Pays 2 gp", "Recipient gets 2 gp", "Left afterwards: 3 gp"]);
});

t("preview passes the failure reason through", () => {
  const bal = { gp: 1 };
  const p = previewLines(planPayment(bal, { gp: 5 }, denoms), bal, denoms);
  assert.equal(p.ok, false);
  assert.match(p.lines[0], /Not enough coin/);
  assert.equal(previewLines(null, bal, denoms).ok, false);
});

t("mint preview and balance text", () => {
  assert.deepEqual(mintLines({ gp: 3 }, denoms).lines, ["Creates 3 gp from nowhere"]);
  assert.equal(balanceText({ gp: 2, sp: 5 }, denoms), "2 gp, 5 sp");
  assert.equal(balanceText({}, denoms), "nothing");
});

t("result messages", () => {
  assert.deepEqual(resultMessage({ ok: false, error: "No." }), { type: "warn", text: "No." });
  assert.equal(resultMessage({ ok: true, status: "pending" }, "Ben").text, "Waiting for Ben to accept.");
  assert.equal(resultMessage({ ok: true, status: "completed" }).text, "Done.");
  assert.equal(resultMessage(undefined).type, "warn");
});

console.log(`\n${n} send-form tests passed`);
