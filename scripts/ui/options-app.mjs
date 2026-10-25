import { MODULE_ID, FLAGS } from "../constants.mjs";
import { getDenominations } from "../adapters/dnd5e.mjs";
import { esc } from "../core/format.mjs";
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

const VIS = [["public", "Everyone"], ["gm-recipient", "GM and recipient"], ["gm", "GM only"]];
const TRI = [["default", "Use default"], ["on", "On"], ["off", "Off"]];

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
        "Sending",
        row("Default visibility", select("p.defaultVisibility", mine.defaultVisibility, [["", "Use the world default"], ...VIS])),
        row("Default ledger", select("p.defaultLedger", mine.defaultLedger, [["", "None"], ...ledgers.map((l) => [l.id, l.name])])),
        toggle("p.rememberRecipients", mine.rememberRecipients, "Remember my last recipients", "They are chosen for you the next time you open Send."),
        toggle("p.confirmBeforeSend", mine.confirmBeforeSend, "Ask me to confirm before sending"),
      ) +
      section("Receiving", toggle("p.notifyOnReceive", mine.notifyOnReceive, "Tell me when coins arrive")) +
      section(
        "Coins I never want used",
        note("These are skipped when you pay, and when change is made for you."),
        coinChecks("p.hide", mine.hiddenDenominations, denoms),
      ) +
      (gm
        ? ""
        : section(
            "Coins sent to my characters",
            o.playersMayChangeAcceptance
              ? myCharacters.length
                ? myCharacters
                    .map((a) => row(a.name, select(`acc.${a.id}`, triValue(a.getFlag(MODULE_ID, FLAGS.requiresAcceptance)), TRI), "Do you need to accept coins sent to this character?"))
                    .join("")
                : note("You don't own any characters.")
              : note("The GM has set acceptance for everyone."),
          ))
    );
  },

  permissions() {
    const grid = permissionGrid();
    return (
      note("What players may do. A player must always own the actor they pay from, and GMs are never restricted.") +
      section(
        "Who a player may pay",
        ...PERMISSION_RULES.map(({ key, label }) =>
          row(label, select(`perm.${key}`, grid[key], [["allow", "Allowed"], ["approval", "Needs GM approval"], ["block", "Blocked"]])),
        ),
      )
    );
  },

  transfers() {
    const o = worldOptions();
    return (
      section(
        "Acceptance",
        toggle("opt.acceptanceDefault", o.acceptanceDefault, "Player characters must accept incoming coins", "The default for each character."),
        toggle("opt.playersMayChangeAcceptance", o.playersMayChangeAcceptance, "Players may change that for their own characters"),
        toggle("opt.gmGiftsSkipAcceptance", o.gmGiftsSkipAcceptance, "Coins from a GM skip acceptance"),
      ) +
      section(
        "Timing",
        row("Pending transfers expire after", number("expiryHours", Number(game.settings.get(MODULE_ID, "expiryHours")) || 12, 1, 720), "In-world hours. The clock only moves when world time does."),
        row("Message when no GM is online", `<input type="text" name="offlineMessage" value="${esc(game.settings.get(MODULE_ID, "offlineMessage") ?? "")}" maxlength="200">`),
      ) +
      section(
        "Chat",
        row("Default visibility of new transfers", select("opt.defaultVisibility", o.defaultVisibility, VIS)),
        toggle("opt.waitingCard", o.waitingCard, "Show the sender a waiting card"),
      ) +
      section(
        "Limits",
        row("Ask to confirm above", number("opt.confirmAboveGp", o.confirmAboveGp, 0, 1000000000), "In gp. 0 means never."),
        row("Largest transfer a player may make", number("opt.maxPerTransferGp", o.maxPerTransferGp, 0, 1000000000), "In gp. 0 means no limit."),
        row("Most recipients in one send", number("opt.maxRecipients", o.maxRecipients, 1, 25)),
      )
    );
  },

  ledgers() {
    const o = worldOptions();
    const creators = creatorSetting();
    const players = game.users.contents.filter((u) => !u.isGM);
    return (
      section(
        "Creating ledgers",
        row("Who can create ledgers", select("creatorsMode", creators.mode, [["gm", "Only the GM"], ["users", "The GM and chosen players"], ["all", "Everyone"]])),
        note("Chosen players:"),
        ...players.map((u) => toggle(`creator.${u.id}`, creators.users.includes(u.id), u.name)),
        row("New ledgers can be read by", select("opt.ledgerDefaultReaders", o.ledgerDefaultReaders, [["gm", "Only the GM and their creator"], ["all", "Everyone"]])),
      ) +
      section(
        "Personal ledgers",
        toggle("opt.personalLedgers", o.personalLedgers, "Personal ledgers are on", "One journal per player character, recording their money in and out."),
        toggle("opt.autoCreatePersonal", o.autoCreatePersonal, "Create them for every player character when the world loads"),
        toggle("opt.maskGmOnly", o.maskGmOnly, "GM-only transfers show players an unknown source and no note"),
      ) +
      section("Containers", row("Who can mark a container public", select("opt.containerFlagging", o.containerFlagging, [["owner", "Its owner and the GM"], ["gm", "Only the GM"]])))
    );
  },

  coins() {
    const denoms = getDenominations({ hidden: [] });
    const hidden = game.settings.get(MODULE_ID, "hiddenDenominations")?.list ?? [];
    return (
      note("Hidden coins are ignored completely for everyone: never spent, never given as change, and never offered in the Send window.") +
      section("Hidden coins", coinChecks("hide", hidden, denoms, (d) => `${d.label ?? d.key} (${d.abbreviation ?? d.key})`))
    );
  },

  characters() {
    const pcs = playerCharacters();
    return (
      note("Player characters only.") +
      (pcs.length
        ? `<table class="quickpay-table"><thead><tr><th>Character</th><th>Must accept coins</th><th>Personal ledger</th></tr></thead><tbody>` +
          pcs
            .map(
              (a) =>
                `<tr><td>${esc(a.name)}</td><td>${select(`acc.${a.id}`, triValue(a.getFlag(MODULE_ID, FLAGS.requiresAcceptance)), TRI)}</td><td>${select(`pl.${a.id}`, triValue(a.getFlag(MODULE_ID, "personalLedger")), TRI)}</td></tr>`,
            )
            .join("") +
          `</tbody></table>`
        : note("No player characters found."))
    );
  },
};

/** The panes that appear as buttons on the module's settings page. */
export const PANE_LIST = [
  { key: "me", title: "My preferences", label: "My preferences", icon: "fa-solid fa-user", gmOnly: false, hint: "Your default visibility and ledger, confirmations, notices, and coins you never want used." },
  { key: "permissions", title: "Permissions", label: "Permissions", icon: "fa-solid fa-shield-halved", gmOnly: true, hint: "Who players may pay, and which payments need GM approval." },
  { key: "transfers", title: "Transfers and limits", label: "Transfers and limits", icon: "fa-solid fa-right-left", gmOnly: true, hint: "Acceptance, expiry, chat, confirmations, and limits." },
  { key: "ledgers", title: "Ledgers", label: "Ledgers", icon: "fa-solid fa-book", gmOnly: true, hint: "Who can create ledgers, personal ledgers, and who can make containers public." },
  { key: "coins", title: "Coins", label: "Coins", icon: "fa-solid fa-coins", gmOnly: true, hint: "Hide denominations for everyone." },
  { key: "characters", title: "Characters", label: "Characters", icon: "fa-solid fa-users", gmOnly: true, hint: "Per character: must they accept coins, and do they get a personal ledger." },
];

/** One window for one pane. Saving writes only the fields that are on its page. */
class PaneApp extends Base {
  static PANE = "me";
  static DEFAULT_OPTIONS = {
    classes: ["dnd-quickpay", "quickpay-options"],
    tag: "div",
    window: { title: "DND QuickPay", icon: "fa-solid fa-coins quickpay-gold", resizable: true },
    position: { width: 540, height: "auto" },
  };

  get title() {
    return `DND QuickPay: ${PANE_LIST.find((p) => p.key === this.constructor.PANE)?.title ?? ""}`;
  }

  async _renderHTML() {
    return {};
  }

  _replaceHTML(_result, content) {
    const key = this.constructor.PANE;
    const meta = PANE_LIST.find((p) => p.key === key);
    if (meta?.gmOnly && !game.user.isGM) {
      content.innerHTML = `<div class="quickpay-pane"><p>Only the GM can change these.</p></div>`;
      return;
    }
    content.innerHTML =
      `<div class="quickpay-pane">${PANES[key]()}` +
      `<div class="quickpay-buttons"><button type="button" data-qp="save">Save</button><button type="button" data-qp="close">Close</button></div></div>`;
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
      ui.notifications.info("DND QuickPay options saved.");
      this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | could not save options`, err);
      ui.notifications.error("Couldn't save everything. Check the console.");
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
    window: { title: "DND QuickPay options", icon: "fa-solid fa-coins quickpay-gold", resizable: false },
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
      list.map((p) => `<button type="button" data-pane="${esc(p.key)}"><i class="${esc(p.icon)} quickpay-gold"></i> ${esc(p.label)}</button>`).join("") +
      `<button type="button" data-pane="containers"><i class="fa-solid fa-box-open quickpay-gold"></i> Public containers</button></div>`;
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
