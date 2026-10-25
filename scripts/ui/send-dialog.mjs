import { MODULE_ID } from "../constants.mjs";
import { getDenominations, getBalance, quote } from "../adapters/dnd5e.mjs";
import { esc } from "../core/format.mjs";
import { parseAmounts, balanceText, previewLines, mintLines, resultMessage } from "../core/send-form.mjs";
import { callGM } from "../socket.mjs";
import { canCreate, listLedgers } from "../ledger.mjs";
import { buildTargets, NOWHERE } from "./targets.mjs";

const { ApplicationV2 } = foundry.applications.api;
const NEW_LEDGER = "__new__";

/**
 * Send or receive coins. mode "send": the fixed actor pays and you pick who gets it.
 * mode "receive" (GM only): the fixed actor is paid and you pick where it comes from.
 */
export class SendDialog extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "dnd-quickpay-send",
    classes: ["dnd-quickpay", "quickpay-send"],
    tag: "div",
    window: { title: "QuickPay", resizable: false },
    position: { width: 420, height: "auto" },
  };

  constructor(actor, { mode = "send", ...options } = {}) {
    super({ ...options, id: `dnd-quickpay-send-${actor.id}-${mode}` });
    this.actor = actor;
    this.mode = mode === "receive" && game.user.isGM ? "receive" : "send";
    this.busy = false;
    this._built = false;
  }

  get title() {
    return this.mode === "receive" ? `Receive coins: ${this.actor.name}` : `Send coins: ${this.actor.name}`;
  }

  get hidden() {
    return game.settings.get(MODULE_ID, "hiddenDenominations")?.list ?? [];
  }

  async _renderHTML() {
    return {};
  }

  _replaceHTML(_result, content) {
    if (this._built) return;
    this._built = true;
    const denoms = getDenominations({ hidden: this.hidden });
    const receive = this.mode === "receive";
    const targets = buildTargets(game.user, this.actor.uuid, {
      nowhereLabel: game.user.isGM ? (receive ? "Nowhere (create new coins)" : "Nowhere (remove coins from play)") : null,
    });
    const otherOptions = targets
      .map((g) => `<optgroup label="${esc(g.label)}">${g.items.map((i) => `<option value="${esc(i.uuid)}">${esc(i.name)}</option>`).join("")}</optgroup>`)
      .join("");
    const ledgers = listLedgers();
    const ledgerOptions =
      `<option value="">No ledger</option>` +
      ledgers.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("") +
      (canCreate(game.user.id) ? `<option value="${NEW_LEDGER}">New ledger...</option>` : "");

    content.innerHTML =
      `<div class="quickpay-form">` +
      `<p class="quickpay-balance"></p>` +
      `<label>${receive ? "From" : "To"} <select name="other"><option value="">Choose...</option>${otherOptions}</select></label>` +
      `<div class="quickpay-amounts">${denoms.map((d) => `<label>${esc(d.abbreviation ?? d.key)} <input type="number" name="amt-${esc(d.key)}" min="0" step="1" inputmode="numeric" placeholder=""></label>`).join("")}</div>` +
      `<label>Note <input type="text" name="note" maxlength="500"></label>` +
      `<label>Who sees it <select name="visibility">` +
      `<option value="public">Everyone</option><option value="gm-recipient">GM and recipient</option><option value="gm">GM only</option></select></label>` +
      `<label>Ledger <select name="ledger">${ledgerOptions}</select></label>` +
      `<label class="quickpay-newledger" hidden>New ledger name <input type="text" name="newLedger" maxlength="60"></label>` +
      `<div class="quickpay-preview" aria-live="polite"></div>` +
      `<div class="quickpay-buttons"><button type="button" data-qp="send">${receive ? "Receive" : "Send"}</button><button type="button" data-qp="cancel">Cancel</button></div>` +
      `</div>`;

    this._content = content;
    this._denoms = denoms;
    const q = (sel) => content.querySelector(sel);
    q('[name="ledger"]').addEventListener("change", (ev) => {
      q(".quickpay-newledger").hidden = ev.target.value !== NEW_LEDGER;
    });
    content.addEventListener("input", () => this._preview());
    content.addEventListener("change", () => this._preview());
    q('[data-qp="cancel"]').addEventListener("click", () => this.close());
    q('[data-qp="send"]').addEventListener("click", () => this._submit());
    this._preview();
  }

  _raw() {
    const raw = {};
    for (const d of this._denoms) raw[d.key] = this._content.querySelector(`[name="amt-${d.key}"]`)?.value;
    return raw;
  }

  /** The document that pays: the fixed actor when sending, the chosen source when receiving. */
  _payer() {
    if (this.mode === "send") return this.actor;
    const uuid = this._content.querySelector('[name="other"]').value;
    if (!uuid || uuid === NOWHERE) return null;
    try {
      return fromUuidSync(uuid) ?? null;
    } catch {
      return null;
    }
  }

  _preview() {
    const c = this._content;
    const denoms = this._denoms;
    const payer = this._payer();
    c.querySelector(".quickpay-balance").textContent = payer
      ? `${payer === this.actor ? "You hold" : `${payer.parent ? payer.parent.name + ": " : ""}${payer.name} holds`}: ${balanceText(getBalance(payer), denoms)}`
      : "";
    const out = c.querySelector(".quickpay-preview");
    const parsed = parseAmounts(this._raw());
    if (!parsed.ok) {
      out.textContent = parsed.error;
      return;
    }
    if (parsed.empty) {
      out.textContent = "";
      return;
    }
    const res = payer
      ? previewLines(quote(payer, parsed.amount, { hidden: this.hidden }).plan, getBalance(payer), denoms)
      : this.mode === "receive" && c.querySelector('[name="other"]').value === NOWHERE
        ? mintLines(parsed.amount, denoms)
        : { ok: true, lines: [] };
    out.innerHTML = res.lines.map((l) => `<div class="${res.ok ? "" : "quickpay-bad"}">${esc(l)}</div>`).join("");
  }

  async _submit() {
    if (this.busy) return;
    const c = this._content;
    const q = (sel) => c.querySelector(sel);
    const otherSel = q('[name="other"]');
    const other = otherSel.value;
    if (!other) return ui.notifications.warn(this.mode === "receive" ? "Choose where the coins come from." : "Choose who to send to.");
    const parsed = parseAmounts(this._raw());
    if (!parsed.ok) return ui.notifications.warn(parsed.error);
    if (parsed.empty) return ui.notifications.warn("Enter an amount.");

    this.busy = true;
    const buttons = c.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    try {
      let ledgerId = q('[name="ledger"]').value || null;
      if (ledgerId === NEW_LEDGER) {
        const made = await callGM("createLedger", q('[name="newLedger"]').value, {});
        if (!made?.ok) return ui.notifications.warn(made?.error ?? "Couldn't create that ledger.");
        ledgerId = made.id;
      }
      const otherUuid = other === NOWHERE ? null : other;
      const res = await callGM("request", {
        senderUuid: this.mode === "send" ? this.actor.uuid : otherUuid,
        recipientUuid: this.mode === "send" ? otherUuid : this.actor.uuid,
        amount: parsed.amount,
        note: q('[name="note"]').value,
        visibility: q('[name="visibility"]').value,
        ledgerId,
      });
      if (res?.offline) return; // callGM already told the user
      const recipientName =
        this.mode === "send" ? otherSel.selectedOptions[0]?.textContent ?? "the recipient" : this.actor.name;
      const msg = resultMessage(res, recipientName);
      ui.notifications[msg.type](msg.text);
      if (res?.ok) this.close();
    } finally {
      this.busy = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  }
}

/** Open the dialog for an actor (document or UUID). */
export async function openSend(actorOrUuid, mode = "send") {
  const actor = typeof actorOrUuid === "string" ? await fromUuid(actorOrUuid) : actorOrUuid;
  if (actor?.documentName !== "Actor") return ui.notifications.warn("That isn't an actor.");
  if (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER")) {
    return ui.notifications.warn("You can only send coins from an actor you own.");
  }
  return new SendDialog(actor, { mode }).render({ force: true });
}
