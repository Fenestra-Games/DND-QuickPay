import { MODULE_ID, FLAGS } from "../constants.mjs";
import { getDenominations } from "../adapters/dnd5e.mjs";
import { esc } from "../core/format.mjs";
import { PERMISSION_RULES } from "../core/options.mjs";
import { fromFormValues, triValue } from "../core/options-form.mjs";
import { worldOptions, permissionGrid, playerOptions, savePlayerOptions } from "../options-store.mjs";
import { creatorSetting, listLedgers, setPersonalEnabled } from "../ledger.mjs";

// The base class only exists inside Foundry. A stand-in lets the file load in tests.
const Base = globalThis.foundry?.applications?.api?.ApplicationV2 ?? class {};

const checkbox = (name, on, label, hint = "") =>
  `<label class="quickpay-check"><input type="checkbox" name="${esc(name)}"${on ? " checked" : ""}> ${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
const select = (name, value, choices) =>
  `<select name="${esc(name)}">${choices.map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const field = (label, control, hint = "") =>
  `<div class="quickpay-field"><label><span>${esc(label)}</span>${control}</label>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`;
const number = (name, value, min, max) =>
  `<input type="number" name="${esc(name)}" value="${esc(value)}" min="${min}" max="${max}" step="1">`;

const VIS = [["public", "Everyone"], ["gm-recipient", "GM and recipient"], ["gm", "GM only"]];
const TRI = [["default", "Use default"], ["on", "On"], ["off", "Off"]];

/** Player characters: character actors that a non-GM user owns. */
const playerCharacters = () =>
  game.actors.contents.filter((a) => a.type === "character" && game.users.contents.some((u) => !u.isGM && a.testUserPermission(u, "OWNER")));

export class OptionsApp extends Base {
  static DEFAULT_OPTIONS = {
    id: "dnd-quickpay-options",
    classes: ["dnd-quickpay", "quickpay-options"],
    tag: "div",
    window: { title: "DND QuickPay options", icon: "fa-solid fa-coins quickpay-gold", resizable: true },
    position: { width: 600, height: "auto" },
  };

  async _renderHTML() {
    return {};
  }

  _replaceHTML(_result, content) {
    const gm = game.user.isGM;
    const denoms = getDenominations({ hidden: [] });
    const o = worldOptions();
    const mine = playerOptions();
    const tabs = [["me", "Me"]];
    if (gm) tabs.push(["perms", "Permissions"], ["transfers", "Transfers"], ["ledgers", "Ledgers"], ["coins", "Coins"], ["chars", "Characters"]);

    const ledgers = listLedgers();
    const myCharacters = playerCharacters().filter((a) => gm || a.testUserPermission(game.user, "OWNER"));
    const worldHidden = game.settings.get(MODULE_ID, "hiddenDenominations")?.list ?? [];
    const creators = creatorSetting();
    const grid = permissionGrid();
    const players = game.users.contents.filter((u) => !u.isGM);

    const me =
      field("Default visibility", select("p.defaultVisibility", mine.defaultVisibility, [["", "Use the world default"], ...VIS])) +
      field("Default ledger", select("p.defaultLedger", mine.defaultLedger, [["", "None"], ...ledgers.map((l) => [l.id, l.name])])) +
      checkbox("p.rememberRecipients", mine.rememberRecipients, "Remember my last recipients", "They are chosen for you next time you open Send.") +
      checkbox("p.confirmBeforeSend", mine.confirmBeforeSend, "Ask me to confirm before sending") +
      checkbox("p.notifyOnReceive", mine.notifyOnReceive, "Tell me when coins arrive") +
      `<fieldset><legend>Coins I never want used</legend><small>These are skipped when you pay and when change is made for you.</small><div class="quickpay-checks">` +
      denoms.map((d) => checkbox(`p.hide.${d.key}`, mine.hiddenDenominations.includes(d.key), d.abbreviation ?? d.key)).join("") +
      `</div></fieldset>` +
      (gm
        ? ""
        : o.playersMayChangeAcceptance
        ? `<fieldset><legend>Do I need to accept coins sent to my characters?</legend>` +
          (myCharacters.length
            ? myCharacters.map((a) => field(a.name, select(`acc.${a.id}`, triValue(a.getFlag(MODULE_ID, FLAGS.requiresAcceptance)), TRI))).join("")
            : "<small>No characters to show.</small>") +
          `</fieldset>`
        : `<small>The GM has set acceptance for everyone.</small>`);

    const perms = gm
      ? `<p>What players may do. A player must always own the actor they pay from, and GMs are never restricted.</p>` +
        PERMISSION_RULES.map(({ key, label }) =>
          field(label, select(`perm.${key}`, grid[key], [["allow", "Allowed"], ["approval", "Needs GM approval"], ["block", "Blocked"]])),
        ).join("")
      : "";

    const transfers = gm
      ? checkbox("opt.acceptanceDefault", o.acceptanceDefault, "Player characters must accept incoming coins", "The default for each character. A player can change their own if allowed below.") +
        checkbox("opt.playersMayChangeAcceptance", o.playersMayChangeAcceptance, "Players may change that for their own characters") +
        checkbox("opt.gmGiftsSkipAcceptance", o.gmGiftsSkipAcceptance, "Coins from a GM skip acceptance") +
        field("Pending transfers expire after (in-world hours)", number("expiryHours", Number(game.settings.get(MODULE_ID, "expiryHours")) || 12, 1, 720)) +
        field("Message when no GM is online", `<input type="text" name="offlineMessage" value="${esc(game.settings.get(MODULE_ID, "offlineMessage") ?? "")}" maxlength="200">`) +
        field("Default visibility of new transfers", select("opt.defaultVisibility", o.defaultVisibility, VIS)) +
        checkbox("opt.waitingCard", o.waitingCard, "Show the sender a waiting card") +
        field("Ask to confirm above (gp, 0 = never)", number("opt.confirmAboveGp", o.confirmAboveGp, 0, 1000000000)) +
        field("Largest transfer a player may make (gp, 0 = no limit)", number("opt.maxPerTransferGp", o.maxPerTransferGp, 0, 1000000000)) +
        field("Most recipients in one send", number("opt.maxRecipients", o.maxRecipients, 1, 25))
      : "";

    const ledgersTab = gm
      ? field("Who can create ledgers", select("creatorsMode", creators.mode, [["gm", "Only the GM"], ["users", "The GM and chosen players"], ["all", "Everyone"]])) +
        `<fieldset><legend>Chosen players</legend>` +
        players.map((u) => checkbox(`creator.${u.id}`, creators.users.includes(u.id), u.name)).join("") +
        `</fieldset>` +
        field("New ledgers can be read by", select("opt.ledgerDefaultReaders", o.ledgerDefaultReaders, [["gm", "Only the GM and their creator"], ["all", "Everyone"]])) +
        checkbox("opt.personalLedgers", o.personalLedgers, "Personal ledgers are on", "One journal per player character that records their money in and out.") +
        checkbox("opt.autoCreatePersonal", o.autoCreatePersonal, "Create them for every player character when the world loads") +
        checkbox("opt.maskGmOnly", o.maskGmOnly, "GM-only transfers show players an unknown source and no note") +
        field("Who can mark a container public", select("opt.containerFlagging", o.containerFlagging, [["owner", "Its owner and the GM"], ["gm", "Only the GM"]])) +
        `<button type="button" data-qp="containers">Manage public containers...</button>`
      : "";

    const coins = gm
      ? `<p>Hidden coins are ignored completely for everyone: never spent, never given as change, and never offered in the Send window.</p><div class="quickpay-checks">` +
        denoms.map((d) => checkbox(`hide.${d.key}`, worldHidden.includes(d.key), `${d.label ?? d.key} (${d.abbreviation ?? d.key})`)).join("") +
        `</div>`
      : "";

    const chars = gm
      ? `<p>Player characters only.</p><table class="quickpay-ledger-table"><thead><tr><th>Character</th><th>Must accept coins</th><th>Personal ledger</th></tr></thead><tbody>` +
        (playerCharacters().length
          ? playerCharacters()
              .map(
                (a) =>
                  `<tr><td>${esc(a.name)}</td><td>${select(`acc.${a.id}`, triValue(a.getFlag(MODULE_ID, FLAGS.requiresAcceptance)), TRI)}</td><td>${select(`pl.${a.id}`, triValue(a.getFlag(MODULE_ID, "personalLedger")), TRI)}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="3">No player characters found.</td></tr>`) +
        `</tbody></table>`
      : "";

    const panes = { me, perms, transfers, ledgers: ledgersTab, coins, chars };
    content.innerHTML =
      `<div class="quickpay-form">` +
      `<nav class="quickpay-tabs">${tabs.map(([k, l], i) => `<button type="button" data-tab="${k}"${i === 0 ? ' class="active"' : ""}>${esc(l)}</button>`).join("")}</nav>` +
      tabs.map(([k], i) => `<section data-pane="${k}"${i === 0 ? "" : " hidden"}>${panes[k]}</section>`).join("") +
      `<div class="quickpay-buttons"><button type="button" data-qp="save">Save</button><button type="button" data-qp="close">Close</button></div></div>`;

    this._root = content;
    content.querySelector(".quickpay-tabs").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-tab]");
      if (!btn) return;
      content.querySelectorAll(".quickpay-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
      content.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== btn.dataset.tab));
    });
    content.querySelector('[data-qp="close"]').addEventListener("click", () => this.close());
    content.querySelector('[data-qp="save"]').addEventListener("click", () => this._save());
    content.querySelector('[data-qp="containers"]')?.addEventListener("click", async () =>
      (await import("./public-containers.mjs")).openPublicContainers(),
    );
  }

  _values() {
    const v = {};
    for (const el of this._root.querySelectorAll("[name]")) v[el.name] = el.type === "checkbox" ? el.checked : el.value;
    return v;
  }

  async _save() {
    const gm = game.user.isGM;
    const denoms = getDenominations({ hidden: [] });
    const pcs = playerCharacters();
    const r = fromFormValues(this._values(), {
      denomKeys: denoms.map((d) => d.key),
      playerIds: game.users.contents.filter((u) => !u.isGM).map((u) => u.id),
      actorIds: pcs.map((a) => a.id),
    });
    const set = (key, value) => game.settings.set(MODULE_ID, key, value);
    try {
      if (gm) {
        if (r.options) await set("options", r.options);
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

export const openOptions = () => new OptionsApp().render({ force: true });
