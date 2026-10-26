import { MODULE_ID } from "../constants.mjs";
import { toUnits, formatAmount } from "../core/coins.mjs";
import { limitUnits } from "../core/options.mjs";
import { worldOptions, playerOptions, savePlayerOptions, hiddenFor } from "../options-store.mjs";
import { getDenominations, getBalance, quote, holdsCurrency } from "../adapters/dnd5e.mjs";
import { esc } from "../core/format.mjs";
import {
  parseAmounts, balanceText, previewLines, mintLines, scaleAmount, resultMessage, resultManyMessage,
} from "../core/send-form.mjs";
import { callGM } from "../socket.mjs";
import { canCreate, listLedgers } from "../ledger.mjs";
import { buildTargets, NOWHERE } from "./targets.mjs";
import { pickTokens } from "./pick.mjs";
import { t } from "../i18n.mjs";

const { ApplicationV2 } = foundry.applications.api;
const NEW_LEDGER = "__new__";

/**
 * Send or receive coins. mode "send": the fixed actor pays and you pick one or more
 * recipients. mode "receive" (GM only): the fixed actor is paid and you pick one source.
 */
export class SendDialog extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "dnd-quickpay-send",
    classes: ["dnd-quickpay", "quickpay-send"],
    tag: "div",
    window: { title: "QUICKPAY.send.windowTitle", icon: "fa-solid fa-coins quickpay-gold", resizable: false },
    position: { width: 440, height: "auto" },
  };

  constructor(actor, { mode = "send", ...options } = {}) {
    super({ ...options, id: `dnd-quickpay-send-${actor.id}-${mode}` });
    this.actor = actor;
    this.mode = mode === "receive" && game.user.isGM ? "receive" : "send";
    this.busy = false;
    this.picking = false;
    this.selected = []; // [{ uuid, name }]
    this._built = false;
  }

  get title() {
    return t(this.mode === "receive" ? "QUICKPAY.send.titleReceive" : "QUICKPAY.send.titleSend", { name: this.actor.name });
  }

  get hidden() {
    return hiddenFor(game.user);
  }

  /** Re-fit the window to its content after anything is added or removed. */
  _fit() {
    if (this.rendered) this.setPosition({ height: "auto" });
  }

  get multi() {
    return this.mode === "send";
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
      nowhereLabel: game.user.isGM ? t(receive ? "QUICKPAY.send.nowhereCreate" : "QUICKPAY.send.nowhereRemove") : null,
    });
    this._names = new Map(targets.flatMap((g) => g.items.map((i) => [i.uuid, i.name])));
    const addOptions = targets
      .map((g) => `<optgroup label="${esc(g.label)}">${g.items.map((i) => `<option value="${esc(i.uuid)}">${esc(i.name)}</option>`).join("")}</optgroup>`)
      .join("");
    const ledgers = listLedgers();
    const ledgerOptions =
      `<option value="">${esc(t("QUICKPAY.send.noLedger"))}</option>` +
      ledgers.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("") +
      (canCreate(game.user.id) ? `<option value="${NEW_LEDGER}">${esc(t("QUICKPAY.send.newLedger"))}</option>` : "");

    content.innerHTML =
      `<div class="quickpay-form">` +
      `<p class="quickpay-balance"></p>` +
      `<div class="quickpay-who"><span class="quickpay-who-label">${esc(t(receive ? "QUICKPAY.send.from" : "QUICKPAY.send.to"))}</span>` +
      `<select name="add"><option value="">${esc(t(receive ? "QUICKPAY.send.chooseSource" : "QUICKPAY.send.addRecipient"))}</option>${addOptions}</select>` +
      `<button type="button" class="quickpay-pick" data-qp="pick" title="${esc(t("QUICKPAY.send.pick"))}" aria-label="${esc(t("QUICKPAY.send.pick"))}"><i class="fa-solid fa-crosshairs quickpay-gold"></i></button></div>` +
      `<div class="quickpay-chips"></div>` +
      `<div class="quickpay-amounts">${denoms.map((d) => `<label>${esc(d.abbreviation ?? d.key)} <input type="number" name="amt-${esc(d.key)}" min="0" step="1" inputmode="numeric" placeholder=""></label>`).join("")}</div>` +
      `<label>${esc(t("QUICKPAY.send.note"))} <input type="text" name="note" maxlength="500"></label>` +
      `<label>${esc(t("QUICKPAY.send.whoSees"))} <select name="visibility">` +
      `<option value="public">${esc(t("QUICKPAY.vis.public"))}</option><option value="gm-recipient">${esc(t("QUICKPAY.vis.gmRecipient"))}</option><option value="gm">${esc(t("QUICKPAY.vis.gm"))}</option></select></label>` +
      `<label>${esc(t("QUICKPAY.send.ledger"))} <select name="ledger">${ledgerOptions}</select></label>` +
      `<label class="quickpay-newledger" hidden>${esc(t("QUICKPAY.send.newLedgerName"))} <input type="text" name="newLedger" maxlength="60"></label>` +
      `<div class="quickpay-preview" aria-live="polite"></div>` +
      `<div class="quickpay-buttons"><button type="button" data-qp="send">${esc(t(receive ? "QUICKPAY.send.receive" : "QUICKPAY.send.send"))}</button><button type="button" data-qp="cancel">${esc(t("QUICKPAY.btn.cancel"))}</button></div>` +
      `</div>`;

    this._content = content;
    this._denoms = denoms;
    const q = (sel) => content.querySelector(sel);
    q('[name="ledger"]').addEventListener("change", (ev) => {
      q(".quickpay-newledger").hidden = ev.target.value !== NEW_LEDGER;
    });
    q('[name="add"]').addEventListener("change", (ev) => {
      const uuid = ev.target.value;
      ev.target.value = "";
      if (uuid) this._add({ uuid, name: this._names.get(uuid) ?? uuid });
    });
    q(".quickpay-chips").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-remove]");
      if (!btn) return;
      this.selected = this.selected.filter((s) => s.uuid !== btn.dataset.remove);
      this._refresh();
    });
    content.addEventListener("input", () => this._preview());
    content.addEventListener("change", () => this._preview());
    q('[data-qp="cancel"]').addEventListener("click", () => this.close());
    q('[data-qp="send"]').addEventListener("click", () => this._submit());
    q('[data-qp="pick"]').addEventListener("click", () => this._pick());

    // Your own defaults
    const mine = playerOptions();
    q('[name="visibility"]').value = mine.defaultVisibility || worldOptions().defaultVisibility;
    if (mine.defaultLedger && ledgers.some((l) => l.id === mine.defaultLedger)) q('[name="ledger"]').value = mine.defaultLedger;

    // Anything targeted on the canvas is a ready-made recipient
    const targeted = [...(game.user.targets ?? [])]
      .map((t) => t.actor)
      .filter((a) => a && holdsCurrency(a) && a.uuid !== this.actor.uuid);
    for (const a of this.multi ? targeted : targeted.slice(0, 1)) this._add({ uuid: a.uuid, name: a.name }, false);
    if (!this.selected.length && this.multi && mine.rememberRecipients) {
      const last = game.user.getFlag(MODULE_ID, "lastRecipients");
      for (const uuid of Array.isArray(last) ? last : []) if (this._names.has(uuid)) this._add({ uuid, name: this._names.get(uuid) }, false);
    }
    this._refresh();
  }

  /** Add a recipient (or replace the source when receiving). */
  _add(entry, refresh = true) {
    if (!this.multi) this.selected = [entry];
    else if (!this.selected.some((s) => s.uuid === entry.uuid)) {
      this.selected.push(entry);
    }
    if (refresh) this._refresh();
  }

  _refresh() {
    const chips = this._content.querySelector(".quickpay-chips");
    chips.innerHTML = this.selected
      .map((s) => `<span class="quickpay-chip">${esc(s.name)}<button type="button" data-remove="${esc(s.uuid)}" aria-label="${esc(t("QUICKPAY.send.remove", { name: s.name }))}">&times;</button></span>`)
      .join("");
    this._preview();
    this._fit();
  }

  async _pick() {
    if (this.picking || this.busy) return;
    if (!canvas?.ready) return ui.notifications.warn(t("QUICKPAY.send.noScene"));
    this.picking = true;
    const allow = (t) =>
      !!t.actor && holdsCurrency(t.actor) && t.actor.uuid !== this.actor.uuid && (game.user.isGM || (t.visible && !t.document?.hidden));
    try {
      await this.minimize();
      await pickTokens({
        allow,
        multiple: this.multi,
        onPick: (a) => this._add({ uuid: a.uuid, name: a.name }),
      });
    } finally {
      this.picking = false;
      if (this.rendered) await this.maximize();
    }
  }

  _raw() {
    const raw = {};
    for (const d of this._denoms) raw[d.key] = this._content.querySelector(`[name="amt-${d.key}"]`)?.value;
    return raw;
  }

  /** The document that pays: the fixed actor when sending, the chosen source when receiving. */
  _payer() {
    if (this.mode === "send") return this.actor;
    const uuid = this.selected[0]?.uuid;
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
      ? payer === this.actor
        ? t("QUICKPAY.send.youHold", { amount: balanceText(getBalance(payer), denoms) })
        : t("QUICKPAY.send.holds", { name: `${payer.parent ? payer.parent.name + ": " : ""}${payer.name}`, amount: balanceText(getBalance(payer), denoms) })
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
    const count = Math.max(1, this.multi ? this.selected.length : 1);
    let res;
    if (payer) {
      const total = scaleAmount(parsed.amount, count);
      res = previewLines(quote(payer, total, { hidden: this.hidden }).plan, getBalance(payer), denoms, { count, each: parsed.amount });
    } else if (this.mode === "receive" && this.selected[0]?.uuid === NOWHERE) {
      res = mintLines(parsed.amount, denoms);
    } else res = { ok: true, lines: [] };
    out.innerHTML = res.lines.map((l) => `<div class="${res.ok ? "" : "quickpay-bad"}">${esc(l)}</div>`).join("");
    this._fit();
  }

  /** Ask before a large send, or every send if the player prefers. */
  async _confirm(amount, count) {
    const denoms = this._denoms;
    const total = toUnits(amount, denoms) * count;
    const limit = limitUnits(worldOptions().confirmAboveGp, denoms);
    const large = limit != null && total > limit;
    if (!large && !playerOptions().confirmBeforeSend) return true;
    const who = this.mode === "receive" ? this.actor.name : count === 1 ? this.selected[0].name : t("QUICKPAY.send.nRecipients", { count });
    return foundry.applications.api.DialogV2.confirm({
      window: { title: t("QUICKPAY.send.confirmTitle") },
      content: `<p>${t(this.mode === "receive" ? (count > 1 ? "QUICKPAY.send.confirmReceiveEach" : "QUICKPAY.send.confirmReceive") : count > 1 ? "QUICKPAY.send.confirmSendEach" : "QUICKPAY.send.confirmSend", { amount: `<strong>${esc(formatAmount(amount, denoms))}</strong>`, who: `<strong>${esc(who)}</strong>` })}</p>`,
      rejectClose: false,
    });
  }

  async _submit() {
    if (this.busy || this.picking) return;
    const c = this._content;
    const q = (sel) => c.querySelector(sel);
    if (!this.selected.length) {
      return ui.notifications.warn(t(this.mode === "receive" ? "QUICKPAY.send.needSource" : "QUICKPAY.send.needRecipient"));
    }
    const parsed = parseAmounts(this._raw());
    if (!parsed.ok) return ui.notifications.warn(parsed.error);
    if (parsed.empty) return ui.notifications.warn(t("QUICKPAY.send.enterAmount"));

    if (!(await this._confirm(parsed.amount, this.multi ? this.selected.length : 1))) return;

    this.busy = true;
    const buttons = c.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    try {
      let ledgerId = q('[name="ledger"]').value || null;
      if (ledgerId === NEW_LEDGER) {
        const made = await callGM("createLedger", q('[name="newLedger"]').value, {});
        if (!made?.ok) return ui.notifications.warn(made?.error ?? t("QUICKPAY.send.ledgerFailed"));
        ledgerId = made.id;
      }
      const common = {
        amount: parsed.amount,
        note: q('[name="note"]').value,
        visibility: q('[name="visibility"]').value,
        ledgerId,
      };
      const toUuid = (u) => (u === NOWHERE ? null : u);

      let res;
      let msg;
      if (this.mode === "receive") {
        res = await callGM("request", { ...common, senderUuid: toUuid(this.selected[0].uuid), recipientUuid: this.actor.uuid });
        if (res?.offline) return;
        msg = resultMessage(res, this.actor.name);
      } else if (this.selected.length === 1) {
        res = await callGM("request", { ...common, senderUuid: this.actor.uuid, recipientUuid: toUuid(this.selected[0].uuid) });
        if (res?.offline) return;
        msg = resultMessage(res, this.selected[0].name);
      } else {
        res = await callGM("requestMany", { ...common, senderUuid: this.actor.uuid }, this.selected.map((s) => toUuid(s.uuid)));
        if (res?.offline) return;
        msg = resultManyMessage(res);
      }
      ui.notifications[msg.type](msg.text);
      if ((res?.ok || res?.done > 0) && this.multi && playerOptions().rememberRecipients) {
        await game.user.setFlag(MODULE_ID, "lastRecipients", this.selected.map((s) => s.uuid).filter((u) => u !== NOWHERE));
      }
      if (res?.ok || res?.done > 0) this.close();
    } finally {
      this.busy = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  }
}

/**
 * Open the dialog. With no actor it uses the selected token, then your own character.
 * @param {Actor|string} [actorOrUuid]
 * @param {"send"|"receive"} [mode]
 */
export async function openSend(actorOrUuid = null, mode = "send") {
  let actor = actorOrUuid;
  if (typeof actor === "string") actor = await fromUuid(actor);
  actor ??= canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
  if (actor?.documentName !== "Actor") return ui.notifications.warn(t("QUICKPAY.send.selectOrPass"));
  if (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER")) {
    return ui.notifications.warn(t("QUICKPAY.send.mustOwn"));
  }
  return new SendDialog(actor, { mode }).render({ force: true });
}
