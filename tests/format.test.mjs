import assert from "node:assert/strict";
import {
  esc, resolvedLine, resolvedHTML, settledHTML, pendingCardHTML, senderCardHTML,
  resultAudience, recipientCardAudience, senderCardAudience, maskedPendingCardHTML, maskedSettledHTML, recipientPrompts,
} from "../scripts/core/format.mjs";
import {
  entryFromRecord, filterEntries, partyNames, rowsHTML, tableHTML,
  personalEntryFromRecord, entryLabel, counterpartyText, signedAmountText, totals, unitsToAmount,
} from "../scripts/core/ledger-format.mjs";

const denoms = [
  { key: "pp", value: 1000, abbreviation: "pp" },
  { key: "gp", value: 100, abbreviation: "gp" },
  { key: "sp", value: 10, abbreviation: "sp" },
  { key: "cp", value: 1, abbreviation: "cp" },
];
const ctx = { denoms, ledgerName: "Jims Pickles", expiresText: "in 12 hours", gmIds: ["gm1", "gm2"], recipientOwnerIds: ["ben"] };

const rec = (over = {}) => ({
  id: "t1", status: "completed", resolution: "auto", createdAt: 100, resolvedAt: 110,
  initiatedBy: "ana", initiatedByName: "Ana",
  sender: { uuid: "Actor.A", name: "Ana the Bold" }, recipient: { uuid: "Actor.B", name: "Ben" },
  amount: { gp: 2, sp: 5 }, escrow: {}, note: "for pickles", visibility: "public", ledgerId: "L1", refunded: null,
  ...over,
});

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  ", name); };

t("esc handles the five dangerous characters and non-strings", () => {
  assert.equal(esc(`<a href="x" onclick='y'>&</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  assert.equal(esc(null), "");
  assert.equal(esc(5), "5");
});

t("every card escapes hostile notes, names and ledger names", () => {
  const evil = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
  const r = rec({ note: evil, sender: { uuid: "a", name: evil }, recipient: { uuid: "b", name: evil }, ledgerId: "L1" });
  const c = { ...ctx, ledgerName: evil, expiresText: evil };
  for (const html of [resolvedHTML(r, c), settledHTML(r, c), pendingCardHTML(r, c), senderCardHTML(r, c)]) {
    assert.ok(!html.includes("<img"), html);
    assert.ok(!html.includes("<script"), html);
    assert.ok(!html.includes('onerror="'), html);
    assert.ok(html.includes("&lt;img"), "the text should still appear, harmlessly");
  }
});

t("completed line, with change-making amounts formatted largest first", () => {
  assert.equal(resolvedLine(rec(), ctx), "<strong>Ana the Bold</strong> paid <strong>2 gp, 5 sp</strong> to <strong>Ben</strong>.");
});

t("GM acceptance, mint and remove wording", () => {
  assert.match(resolvedLine(rec({ resolution: "accepted-by-gm" }), ctx), /accepted by the GM/);
  assert.match(resolvedLine(rec({ sender: null }), ctx), /was created for <strong>Ben<\/strong>/);
  assert.match(resolvedLine(rec({ recipient: null }), ctx), /lost .* \(removed from play\)/);
});

t("declined, expired and cancelled say where the coins went", () => {
  assert.match(resolvedLine(rec({ status: "declined", refunded: true }), ctx), /declined .* The coins went back to <strong>Ana the Bold/);
  assert.match(resolvedLine(rec({ status: "expired", refunded: true }), ctx), /expired\. The coins went back/);
  assert.match(resolvedLine(rec({ status: "cancelled", refunded: true }), ctx), /cancelled\. The coins went back/);
  assert.match(resolvedLine(rec({ status: "declined", refunded: false }), ctx), /couldn't be returned/);
  assert.match(resolvedLine(rec({ status: "cancelled", resolution: "recipient-missing", refunded: true }), ctx), /no longer exists/);
  assert.doesNotMatch(resolvedLine(rec({ status: "declined", sender: null }), ctx), /went back/);
});

t("result card shows the note and the ledger name only when present", () => {
  const html = resolvedHTML(rec(), ctx);
  assert.match(html, /for pickles/);
  assert.match(html, /Ledger: Jims Pickles/);
  const bare = resolvedHTML(rec({ note: "", ledgerId: null }), ctx);
  assert.doesNotMatch(bare, /quickpay-note|Ledger:/);
});

t("pending card has accept, decline and a GM-only cancel; sender card has cancel", () => {
  const html = pendingCardHTML(rec({ status: "pending" }), ctx);
  assert.match(html, /data-quickpay-action="accept" data-transfer="t1"/);
  assert.match(html, /data-quickpay-action="decline" data-transfer="t1"/);
  assert.match(html, /data-quickpay-action="cancel"[^>]*data-gm-only/);
  assert.match(html, /Expires in 12 hours/);
  const s = senderCardHTML(rec({ status: "pending" }), ctx);
  assert.match(s, /Waiting for <strong>Ben<\/strong>/);
  assert.match(s, /data-quickpay-action="cancel"/);
  assert.doesNotMatch(s, /data-quickpay-action="accept"/);
});

t("a settled card has no buttons", () => {
  assert.doesNotMatch(settledHTML(rec(), ctx), /<button/);
});

t("audiences: public, GM and recipient, GM only", () => {
  assert.equal(resultAudience(rec({ visibility: "public" }), ctx), null);
  assert.deepEqual(resultAudience(rec({ visibility: "gm" }), ctx), ["gm1", "gm2", "ana"]);
  assert.deepEqual(resultAudience(rec({ visibility: "gm-recipient" }), ctx), ["gm1", "gm2", "ana", "ben"]);
  assert.equal(resultAudience(rec({ visibility: "nonsense" }), ctx), null, "unknown values fall back to public");
  // the sender always sees their own message, and a GM initiator is not listed twice
  assert.deepEqual(resultAudience(rec({ visibility: "gm", initiatedBy: "gm1" }), ctx), ["gm1", "gm2"]);
});

t("the acceptance prompt always reaches the recipient's owners and the GMs", () => {
  assert.deepEqual(recipientCardAudience(ctx), ["gm1", "gm2", "ben"]);
  assert.deepEqual(recipientCardAudience({ ...ctx, recipientOwnerIds: [] }), ["gm1", "gm2"]);
});

t("the sender's waiting card is skipped for a GM initiator", () => {
  assert.deepEqual(senderCardAudience(rec(), ctx), ["ana"]);
  assert.equal(senderCardAudience(rec({ initiatedBy: "gm2" }), ctx), null);
});

// ---- ledger entries ------------------------------------------------------------
const entries = [
  entryFromRecord(rec({ id: "a", resolvedAt: 10, note: "barrels", amount: { gp: 5 } }), "Day 1"),
  entryFromRecord(rec({ id: "b", resolvedAt: 30, note: "jars", sender: { uuid: "x", name: "Cara" }, amount: { sp: 4 } }), "Day 3"),
  entryFromRecord(rec({ id: "c", resolvedAt: 20, status: "declined", note: "rejected", amount: { gp: 1 } }), "Day 2"),
  entryFromRecord(rec({ id: "d", resolvedAt: 40, sender: null, note: "grant", amount: { pp: 1 } }), "Day 4"),
];

t("entryFromRecord keeps only what the ledger needs", () => {
  const e = entries[0];
  assert.deepEqual(Object.keys(e).sort(), ["amount", "at", "by", "from", "id", "note", "resolution", "resolvedAt", "status", "to", "version", "when"]);
  assert.equal(e.from, "Ana the Bold");
  assert.ok(!("escrow" in e));
});

t("filter: completed by default, newest first", () => {
  assert.deepEqual(filterEntries(entries, {}, denoms).map((e) => e.id), ["d", "b", "a"]);
});

t("filter: all, a status, oldest first", () => {
  assert.equal(filterEntries(entries, { status: "all" }, denoms).length, 4);
  assert.deepEqual(filterEntries(entries, { status: "declined" }, denoms).map((e) => e.id), ["c"]);
  assert.deepEqual(filterEntries(entries, { status: "all", sort: "oldest" }, denoms).map((e) => e.id), ["a", "c", "b", "d"]);
});

t("filter: text matches notes, names, dates and amounts; all words must match", () => {
  const ids = (f) => filterEntries(entries, { status: "all", ...f }, denoms).map((e) => e.id);
  assert.deepEqual(ids({ text: "jars" }), ["b"]);
  assert.deepEqual(ids({ text: "CARA" }), ["b"]);
  assert.deepEqual(ids({ text: "day 3" }), ["b"]);
  assert.deepEqual(ids({ text: "5 gp" }), ["a"]);
  assert.deepEqual(ids({ text: "jars barrels" }), []);
  assert.deepEqual(ids({ text: "   " }).length, 4);
});

t("filter: party matches sender or recipient exactly", () => {
  const ids = (party) => filterEntries(entries, { status: "all", party }, denoms).map((e) => e.id);
  assert.deepEqual(ids("Cara"), ["b"]);
  assert.deepEqual(ids("Ben").sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(ids("Ana"), [], "partial names do not match");
});

t("partyNames is unique and sorted", () => {
  assert.deepEqual(partyNames(entries), ["Ana the Bold", "Ben", "Cara"]);
});

t("table: escapes everything, caps rows, reports what is hidden", () => {
  const evil = entryFromRecord(rec({ id: "e", note: "<script>x</script>", sender: { uuid: "z", name: "<b>Z</b>" } }), "<i>when</i>");
  const html = tableHTML([evil], denoms);
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<b>Z"));
  assert.ok(!html.includes("<i>when"));
  const many = Array.from({ length: 450 }, (_, i) => entryFromRecord(rec({ id: "m" + i, resolvedAt: i }), "d"));
  const capped = tableHTML(many, denoms, { limit: 300 });
  assert.equal((capped.match(/<tr class="quickpay-row/g) ?? []).length, 300);
  assert.match(capped, /Showing 300 of 450 completed/);
  assert.match(tableHTML([], denoms), /No transfers recorded yet/);
  assert.match(tableHTML(entries, denoms), /1 other entries are in the viewer/);
});

t("rowsHTML shows nowhere / removed for mint and burn", () => {
  const html = rowsHTML([entryFromRecord(rec({ sender: null }), "w"), entryFromRecord(rec({ recipient: null }), "w")], denoms);
  assert.match(html, /\(nowhere\)/);
  assert.match(html, /\(removed\)/);
});

// ---- personal ledgers ----------------------------------------------------------
t("personal entry: in and out from the character's point of view", () => {
  const inE = personalEntryFromRecord(rec(), "in", { when: "Day 1", ownerIds: ["ben"] });
  const outE = personalEntryFromRecord(rec(), "out", { when: "Day 1", ownerIds: ["ana"] });
  assert.equal(entryLabel(inE), "Deposit");
  assert.equal(counterpartyText(inE), "Ana the Bold");
  assert.equal(signedAmountText(inE, denoms), "+2 gp, 5 sp");
  assert.equal(entryLabel(outE), "Withdrawal");
  assert.equal(counterpartyText(outE), "Ben");
  assert.equal(signedAmountText(outE, denoms), "-2 gp, 5 sp");
});

t("personal entry: GM-only transfer is masked for the player, not for the GM or the initiator", () => {
  const r = rec({ visibility: "gm", initiatedBy: "gm1", initiatedByName: "GM", sender: null, note: "secret reward" });
  const masked = personalEntryFromRecord(r, "in", { ownerIds: ["ben"] });
  assert.equal(masked.hidden, true);
  assert.equal(entryLabel(masked), "Unknown deposit");
  assert.equal(counterpartyText(masked), "Unknown");
  assert.equal(masked.note, "");
  assert.equal(masked.by, "");
  assert.equal(masked.counterparty, null);
  assert.ok(!JSON.stringify(masked).includes("secret reward"));
  assert.equal(personalEntryFromRecord(r, "in", { ownerIds: [] }).hidden, false, "an NPC ledger has no player to hide from");
  const own = personalEntryFromRecord(rec({ visibility: "gm", initiatedBy: "ben" }), "out", { ownerIds: ["ben"] });
  assert.equal(own.hidden, false, "a player always sees what they did themselves");
  assert.equal(personalEntryFromRecord(rec({ visibility: "gm-recipient" }), "in", { ownerIds: ["ben"] }).hidden, false);
});

t("hidden withdrawals read as a pickpocket", () => {
  const e = personalEntryFromRecord(rec({ visibility: "gm", initiatedBy: "gm1", recipient: null }), "out", { ownerIds: ["ana"] });
  assert.equal(entryLabel(e), "Pickpocketed");
  assert.equal(counterpartyText(e), "The GM has picked your pocket");
  const c = personalEntryFromRecord(rec({ visibility: "gm", initiatedBy: "gm1", recipient: null, sender: { uuid: "Actor.A.Item.x", name: "Ana: Purse" } }), "out", { ownerIds: ["ana"] });
  assert.equal(counterpartyText(c), "The GM has picked Ana: Purse");
});

t("masked prompts hide sender, note and ledger, and settle without revealing them", () => {
  const r = rec({ status: "pending", visibility: "gm", initiatedBy: "gm1", note: "secret", ledgerId: "L1" });
  const html = maskedPendingCardHTML(r, ctx);
  assert.ok(!html.includes("Ana") && !html.includes("secret") && !html.includes("Ledger"));
  assert.match(html, /data-quickpay-action="accept"/);
  assert.doesNotMatch(html, /cancel/);
  const done = maskedSettledHTML({ ...r, status: "completed" }, ctx);
  assert.ok(!done.includes("Ana") && !done.includes("secret"));
  const prompts = recipientPrompts(r, ctx);
  assert.deepEqual(prompts.map((p) => p.masked), [false, true]);
  assert.deepEqual(prompts[1].to, ["ben"]);
  assert.deepEqual(recipientPrompts({ ...r, visibility: "public" }, ctx), [{ to: ["gm1", "gm2", "ben"], masked: false }]);
});

t("personal entry: GM mint and remove read sensibly", () => {
  const mint = personalEntryFromRecord(rec({ sender: null }), "in", { ownerIds: ["ben"] });
  assert.equal(counterpartyText(mint), "The GM");
  const burn = personalEntryFromRecord(rec({ recipient: null }), "out", { ownerIds: ["ana"] });
  assert.equal(counterpartyText(burn), "Removed by the GM");
});

t("personal totals count completed money only", () => {
  const mk = (id, status, side, amount) => personalEntryFromRecord(rec({ id, status, amount }), side, { ownerIds: ["x"] });
  const list = [
    mk("1", "completed", "in", { gp: 5 }),
    mk("2", "completed", "out", { gp: 1, sp: 5 }),
    mk("3", "declined", "in", { gp: 100 }),
    mk("4", "pending", "out", { gp: 100 }),
  ];
  const tt = totals(list, denoms);
  assert.equal(tt.inText, "5 gp");
  assert.equal(tt.outText, "1 gp, 5 sp");
  assert.equal(tt.netText, "+3 gp, 5 sp");
  assert.equal(totals([mk("5", "completed", "out", { gp: 2 })], denoms).netText, "-2 gp");
  assert.equal(totals([], denoms).net, 0);
});

t("unitsToAmount skips no-change coins", () => {
  const withEp = [...denoms, { key: "ep", value: 50, abbreviation: "ep", noChange: true }];
  assert.deepEqual(unitsToAmount(1234, withEp), { pp: 1, gp: 2, sp: 3, cp: 4 });
});

t("personal filter: direction, search by label, hidden entries searchable only as unknown", () => {
  const r = rec({ visibility: "gm", initiatedBy: "gm1", sender: null, note: "secret reward" });
  const list = [
    personalEntryFromRecord(r, "in", { ownerIds: ["ben"], when: "D1" }),
    personalEntryFromRecord(rec({ id: "z", note: "pie" }), "out", { ownerIds: ["ana"], when: "D2" }),
  ];
  assert.equal(filterEntries(list, { direction: "in" }, denoms).length, 1);
  assert.equal(filterEntries(list, { text: "unknown deposit" }, denoms).length, 1);
  assert.equal(filterEntries(list, { text: "secret" }, denoms).length, 0, "masked text is gone from search too");
  assert.equal(filterEntries(list, { party: "Ben" }, denoms).length, 1);
});

t("personal table: escapes, shows totals and the masked label", () => {
  const evil = personalEntryFromRecord(rec({ note: "<script>x</script>", sender: { uuid: "z", name: "<b>Z</b>" } }), "in", { ownerIds: ["ben"] });
  const masked = personalEntryFromRecord(rec({ id: "m", visibility: "gm", initiatedBy: "gm1" }), "in", { ownerIds: ["ben"] });
  const html = tableHTML([evil, masked], denoms, { personal: true });
  assert.ok(!html.includes("<script") && !html.includes("<b>Z"));
  assert.match(html, /Unknown deposit/);
  assert.match(html, /In: /);
  assert.match(html, /<th>Type<\/th>/);
});

console.log(`\n${n} format tests passed`);
