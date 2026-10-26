import { MODULE_ID, FLAGS } from "../constants.mjs";
import { getDenominations } from "../adapters/dnd5e.mjs";
import { esc } from "../core/format.mjs";
import { t } from "../i18n.mjs";
import { PERMISSION_RULES } from "../core/options.mjs";
import { fromFormValues, triValue } from "../core/options-form.mjs";
import { worldOptions, permissionGrid, playerOptions, savePlayerOptions } from "../options-store.mjs";
import { creatorSetting, listLedgers, setPersonalEnabled } from "../ledger.mjs";

// The base class only exists inside Foundry. A stand-in lets the file load in tests.
const Base = globalThis.foundry?.applications?.api?.ApplicationV2 ?? class {};

// ---- small builders for a consistent layout -------------------------------------
/** One row: label and hint on the left, the control on the right. The whole row is a label, so a click toggles a checkbox. */
const row = (label, control, hint = "") =>
  `<label class="quickpay-row"><span class="quickpay-row-text"><span class="quickpay-row-label">${esc(label)}</span>` +
  `${hint ? `<small>${esc(hint)}</small>` : ""}</span><span class="quickpay-row-control">${control}</span></label>`;
const toggle = (name, on, label, hint = "") =>
  row(label, `<input type="checkbox" name="${esc(name)}"${on ? " checked" : ""}>`, hint);
const select = (name, value, choices) =>
  `<select name="${esc(name)}">${choices.map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const number = (name, value, min, max) =>
  `<input type="number" name="${esc(name)}" value="${esc(value)}" min="${min}" max="${max}" step="1">`;
const section = (title, ...rows) => `<section class="quickpay-section"><h3>${esc(title)}</h3>${rows.join("")}</section>`;
const note = (text) => `<p class="quickpay-note-text">${esc(text)}</p>`;

const VIS = () => [["public", t("QUICKPAY.vis.public")], ["gm-recipient", t("QUICKPAY.vis.gmRecipient")], ["gm", t("QUICKPAY.vis.gm")]];
const TRI = () => [["default", t("QUICKPAY.opt.useDefault")], ["on", t("QUICKPAY.opt.on")], ["off", t("QUICKPAY.opt.off")]];

/** Player characters: character actors that a non-GM user owns. */
const playerCharacters = () =>
  game.actors.contents.filter((a) => a.type === "character" && game.users.contents.some((u) => !u.isGM && a.testUserPermission(u, "OWNER")));

const coinChecks = (prefix, hiddenKeys, denoms, labelOf = (d) => d.abbreviation ?? d.key) =>
  `<div class="quickpay-coins">${denoms
    .map((d) => `<label><input type="checkbox" name="${prefix}.${esc(d.key)}"${hiddenKeys.includes(d.key) ? " checked" : ""}> ${esc(labelOf(d))}</label>`)
    .join("")}</div>`;

// ---- the panes --------------------------------------------------------------------
const PANES = {
  me() {
    const gm = game.user.isGM;
    const o = worldOptions();
    const mine = playerOptions();
    const denoms = getDenominations({ hidden: [] });
    const ledgers = listLedgers();
    const myCharacters = playerCharacters().filter((a) => a.testUserPermission(game.user, "OWNER"));
    return (
      section(
        t("QUICKPAY.sec.sending"),
        row(t("QUICKPAY.opt.defaultVisibility"), select("p.defaultVisibility", mine.defaultVisibility, [["", t("QUICKPAY.opt.worldDefault")], ...VIS()])),
        row(t("QUICKPAY.opt.defaultLedger"), select("p.defaultLedger", mine.defaultLedger, [["", t("QUICKPAY.opt.none")], ...ledgers.map((l) => [l.id, l.name])])),
        toggle("p.rememberRecipients", mine.rememberRecipients, t("QUICKPAY.opt.rememberRecipients"), t("QUICKPAY.opt.rememberRecipientsHint")),
        toggle("p.confirmBeforeSend", mine.confirmBeforeSend, t("QUICKPAY.opt.confirmBeforeSend")),
      ) +
      section(t("QUICKPAY.sec.receiving"), toggle("p.notifyOnReceive", mine.notifyOnReceive, t("QUICKPAY.opt.notifyOnReceive"))) +
      section(
        t("QUICKPAY.sec.myHidden"),
        note(t("QUICKPAY.note.myHidden")),
        coinChecks("p.hide", mine.hiddenDenominations, denoms),
      ) +
      (gm
        ? ""
        : section(
            t("QUICKPAY.sec.myCharacters"),
            o.playersMayChangeAcceptance
              ? myCharacters.length
                ? myCharacters
                    .map((a) => row(a.name, select(`acc.${a.id}`, triValue(a.getFlag(MODULE_ID, FLAGS.requiresAcceptance)), TRI()), t("QUICKPAY.opt.acceptCharacterHint")))
                    .join("")
                : note(t("QUICKPAY.note.noCharacters"))
              : note(t("QUICKPAY.note.gmSetAcceptance")),
          ))
    );
  },

  permissions() {
    const grid = permissionGrid();
    return (
      note(t("QUICKPAY.note.permissions")) +
      section(
        t("QUICKPAY.sec.whoPay"),
        ...PERMISSION_RULES.map(({ key, labelKey }) =>
          row(t(labelKey), select(`perm.${key}`, grid[key], [["allow", t("QUICKPAY.perm.allow")], ["approval", t("QUICKPAY.perm.approval")], ["block", t("QUICKPAY.perm.block")]])),
        ),
      )
    );
  },

  transfers() {
    const o = worldOptions();
    return (
      section(
        t("QUICKPAY.sec.acceptance"),
        toggle("opt.acceptanceDefault", o.acceptanceDefault, t("QUICKPAY.opt.acceptanceDefault"), t("QUICKPAY.opt.acceptanceDefaultHint")),
        toggle("opt.playersMayChangeAcceptance", o.playersMayChangeAcceptance, t("QUICKPAY.opt.playersMayChange")),
        toggle("opt.gmGiftsSkipAcceptance", o.gmGiftsSkipAcceptance, t("QUICKPAY.opt.gmSkip")),
      ) +
      section(
        t("QUICKPAY.sec.timing"),
        row(t("QUICKPAY.opt.expiry"), number("expiryHours", Number(game.settings.get(MODULE_ID, "expiryHours")) || 12, 1, 720), t("QUICKPAY.opt.expiryHint")),
        row(t("QUICKPAY.opt.offlineMessage"), `<input type="text" name="offlineMessage" value="${esc(game.settings.get(MODULE_ID, "offlineMessage") ?? "")}" maxlength="200">`),
      ) +
      section(
        t("QUICKPAY.sec.chat"),
        row(t("QUICKPAY.opt.worldVisibility"), select("opt.defaultVisibility", o.defaultVisibility, VIS())),
        toggle("opt.waitingCard", o.waitingCard, t("QUICKPAY.opt.waitingCard")),
      ) +
      section(
        t("QUICKPAY.sec.limits"),
        row(t("QUICKPAY.opt.confirmAbove"), number("opt.confirmAboveGp", o.confirmAboveGp, 0, 1000000000), t("QUICKPAY.opt.confirmAboveHint")),
        row(t("QUICKPAY.opt.maxPerTransfer"), number("opt.maxPerTransferGp", o.maxPerTransferGp, 0, 1000000000), t("QUICKPAY.opt.maxPerTransferHint")),
        row(t("QUICKPAY.opt.maxRecipients"), number("opt.maxRecipients", o.maxRecipients, 1, 25)),
      )
    );
  },

  ledgers() {
    const o = worldOptions();
    const creators = creatorSetting();
    const players = game.users.contents.filter((u) => !u.isGM);
    return (
      section(
        t("QUICKPAY.sec.creating"),
        row(t("QUICKPAY.creators.label"), select("creatorsMode", creators.mode, [["gm", t("QUICKPAY.creators.gm")], ["users", t("QUICKPAY.creators.users")], ["all", t("QUICKPAY.vis.public")]])),
        note(t("QUICKPAY.note.chosen")),
        ...players.map((u) => toggle(`creator.${u.id}`, creators.users.includes(u.id), u.name)),
        row(t("QUICKPAY.opt.ledgerReaders"), select("opt.ledgerDefaultReaders", o.ledgerDefaultReaders, [["gm", t("QUICKPAY.opt.readersGm")], ["all", t("QUICKPAY.vis.public")]])),
      ) +
      section(
        t("QUICKPAY.sec.personal"),
        toggle("opt.personalLedgers", o.personalLedgers, t("QUICKPAY.opt.personalOn"), t("QUICKPAY.opt.personalOnHint")),
        toggle("opt.autoCreatePersonal", o.autoCreatePersonal, t("QUICKPAY.opt.autoCreate")),
        toggle("opt.maskGmOnly", o.maskGmOnly, t("QUICKPAY.opt.maskGmOnly")),
      ) +
      section(t("QUICKPAY.sec.containers"), row(t("QUICKPAY.opt.containerFlagging"), select("opt.containerFlagging", o.containerFlagging, [["owner", t("QUICKPAY.opt.flagOwner")], ["gm", t("QUICKPAY.creators.gm")]])))
    );
  },

  coins() {
    const denoms = getDenominations({ hidden: [] });
    const hidden = game.settings.get(MODULE_ID, "hiddenDenominations")?.list ?? [];
    return (
      note(t("QUICKPAY.note.hiddenCoins")) +
      section(t("QUICKPAY.sec.hiddenCoins"), coinChecks("hide", hidden, denoms, (d) => `${d.label ?? d.key} (${d.abbreviation ?? d.key})`))
    );
  },

  characters() {
    const pcs = playerCharacters();
    return (
      note(t("QUICKPAY.note.pcsOnly")) +
      (pcs.length
        ? `<table class="quickpay-table"><thead><tr><th>${esc(t("QUICKPAY.col.character"))}</th><th>${esc(t("QUICKPAY.col.mustAccept"))}</th><th>${esc(t("QUICKPAY.col.personalLedger"))}</th></tr></thead><tbody>` +
          pcs
            .map(
              (a) =>
                `<tr><td>${esc(a.name)}</td><td>${select(`acc.${a.id}`, triValue(a.getFlag(MODULE_ID, FLAGS.requiresAcceptance)), TRI())}</td><td>${select(`pl.${a.id}`, triValue(a.getFlag(MODULE_ID, "personalLedger")), TRI())}</td></tr>`,
            )
            .join("") +
          `</tbody></table>`
        : note(t("QUICKPAY.note.noPcs")))
    );
  },
};

/** The panes that appear as buttons on the module's settings page. */
export const PANE_LIST = [
  { key: "me", titleKey: "QUICKPAY.pane.me", hintKey: "QUICKPAY.pane.meHint", icon: "fa-solid fa-user", gmOnly: false },
  { key: "permissions", titleKey: "QUICKPAY.pane.permissions", hintKey: "QUICKPAY.pane.permissionsHint", icon: "fa-solid fa-shield-halved", gmOnly: true },
  { key: "transfers", titleKey: "QUICKPAY.pane.transfers", hintKey: "QUICKPAY.pane.transfersHint", icon: "fa-solid fa-right-left", gmOnly: true },
  { key: "ledgers", titleKey: "QUICKPAY.pane.ledgers", hintKey: "QUICKPAY.pane.ledgersHint", icon: "fa-solid fa-book", gmOnly: true },
  { key: "coins", titleKey: "QUICKPAY.pane.coins", hintKey: "QUICKPAY.pane.coinsHint", icon: "fa-solid fa-coins", gmOnly: true },
  { key: "characters", titleKey: "QUICKPAY.pane.characters", hintKey: "QUICKPAY.pane.charactersHint", icon: "fa-solid fa-users", gmOnly: true },
];

/** One window for one pane. Saving writes only the fields that are on its page. */
class PaneApp extends Base {
  static PANE = "me";
  static DEFAULT_OPTIONS = {
    classes: ["dnd-quickpay", "quickpay-options"],
    tag: "div",
    window: { title: "QUICKPAY.title", icon: "fa-solid fa-coins quickpay-gold", resizable: true },
    position: { width: 540, height: "auto" },
  };

  get title() {
    const meta = PANE_LIST.find((p) => p.key === this.constructor.PANE);
    return t("QUICKPAY.opt.paneTitle", { pane: meta ? t(meta.titleKey) : "" });
  }

  async _renderHTML() {
    return {};
  }

  _replaceHTML(_result, content) {
    const key = this.constructor.PANE;
    const meta = PANE_LIST.find((p) => p.key === key);
    if (meta?.gmOnly && !game.user.isGM) {
      content.innerHTML = `<div class="quickpay-pane"><p>${esc(t("QUICKPAY.note.gmOnly"))}</p></div>`;
      return;
    }
    content.innerHTML =
      `<div class="quickpay-pane">${PANES[key]()}` +
      `<div class="quickpay-buttons"><button type="button" data-qp="save">${esc(t("QUICKPAY.btn.save"))}</button><button type="button" data-qp="close">${esc(t("QUICKPAY.btn.close"))}</button></div></div>`;
    this._root = content;
    content.querySelector('[data-qp="close"]').addEventListener("click", () => this.close());
    content.querySelector('[data-qp="save"]').addEventListener("click", () => this._save());
  }

  _values() {
    const v = {};
    for (const el of this._root.querySelectorAll("[name]")) v[el.name] = el.type === "checkbox" ? el.checked : el.value;
    return v;
  }

  async _save() {
    const gm = game.user.isGM;
    const denoms = getDenominations({ hidden: [] });
    const r = fromFormValues(this._values(), {
      denomKeys: denoms.map((d) => d.key),
      playerIds: game.users.contents.filter((u) => !u.isGM).map((u) => u.id),
      actorIds: playerCharacters().map((a) => a.id),
    });
    const set = (key, value) => game.settings.set(MODULE_ID, key, value);
    try {
      if (gm) {
        if (r.options) await set("options", { ...worldOptions(), ...r.options });
        if (r.permissions) await set("permissions", r.permissions);
        if (r.hidden) await set("hiddenDenominations", { list: r.hidden });
        if (r.expiryHours) await set("expiryHours", r.expiryHours);
        if (r.offlineMessage !== undefined) await set("offlineMessage", r.offlineMessage);
        if (r.creators) await set("ledgerCreators", r.creators);
      }
      if (r.player) await savePlayerOptions(r.player);

      const mayAcceptance = gm || worldOptions().playersMayChangeAcceptance;
      for (const [id, flags] of Object.entries(r.actors ?? {})) {
        const actor = game.actors.get(id);
        if (!actor || !(gm || actor.testUserPermission(game.user, "OWNER"))) continue;
        if ("acceptance" in flags && mayAcceptance) {
          if (flags.acceptance === null) await actor.unsetFlag(MODULE_ID, FLAGS.requiresAcceptance);
          else await actor.setFlag(MODULE_ID, FLAGS.requiresAcceptance, flags.acceptance);
        }
        if (gm && "personal" in flags) {
          if (flags.personal === null) await actor.unsetFlag(MODULE_ID, "personalLedger");
          else await setPersonalEnabled(actor, flags.personal);
        }
      }
      ui.notifications.info(t("QUICKPAY.opt.saved"));
      this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | could not save options`, err);
      ui.notifications.error(t("QUICKPAY.opt.saveFailed"));
    }
  }
}

/** A separate class per pane, because Foundry creates a menu's window with `new type()`. */
const paneClass = (key) => {
  const C = class extends PaneApp {
    static PANE = key;
    static DEFAULT_OPTIONS = { ...PaneApp.DEFAULT_OPTIONS, id: `dnd-quickpay-options-${key}` };
  };
  Object.defineProperty(C, "name", { value: `QuickPay_${key}` });
  return C;
};

export const PANE_CLASSES = Object.fromEntries(PANE_LIST.map((p) => [p.key, paneClass(p.key)]));

/** A small window of buttons for the sheet header and the toolbar, so they don't need seven entries. */
export class OptionsHub extends Base {
  static DEFAULT_OPTIONS = {
    id: "dnd-quickpay-options-hub",
    classes: ["dnd-quickpay", "quickpay-options"],
    tag: "div",
    window: { title: "QUICKPAY.opt.hubTitle", icon: "fa-solid fa-coins quickpay-gold", resizable: false },
    position: { width: 360, height: "auto" },
  };

  async _renderHTML() {
    return {};
  }

  _replaceHTML(_result, content) {
    const gm = game.user.isGM;
    const list = PANE_LIST.filter((p) => gm || !p.gmOnly);
    content.innerHTML =
      `<div class="quickpay-pane quickpay-hub">` +
      list.map((p) => `<button type="button" data-pane="${esc(p.key)}"><i class="${esc(p.icon)} quickpay-gold"></i> ${esc(t(p.titleKey))}</button>`).join("") +
      `<button type="button" data-pane="containers"><i class="fa-solid fa-box-open quickpay-gold"></i> ${esc(t("QUICKPAY.menu.containers"))}</button></div>`;
    content.querySelectorAll("[data-pane]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const key = btn.dataset.pane;
        if (key === "containers") (await import("./public-containers.mjs")).openPublicContainers();
        else new PANE_CLASSES[key]().render({ force: true });
        this.close();
      }),
    );
  }
}

export const openOptions = () => new OptionsHub().render({ force: true });
