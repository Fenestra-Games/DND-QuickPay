import { MODULE_ID } from "../constants.mjs";
import { getDenominations } from "../adapters/dnd5e.mjs";
import { esc } from "../core/format.mjs";
import { filterEntries, partyNames, rowsHTML, headerHTML, totals } from "../core/ledger-format.mjs";
import { listReadable, readEntries } from "../ledger.mjs";
import { t } from "../i18n.mjs";

const { ApplicationV2 } = foundry.applications.api;

const STATUSES = ["completed", "all", "pending", "declined", "expired", "cancelled"];

/** Searchable, filterable ledger viewer. Reads only ledgers the current user may open. */
export class LedgerViewer extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "dnd-quickpay-ledger-viewer",
    classes: ["dnd-quickpay", "quickpay-viewer"],
    tag: "div",
    window: { title: "QUICKPAY.viewer.title", resizable: true },
    position: { width: 760, height: "auto" },
  };

  constructor(ledgerId = null, options = {}) {
    super(options);
    this.ledgerId = ledgerId;
    this.filters = { text: "", status: "completed", party: "", direction: "", sort: "newest" };
  }

  async _renderHTML() {
    const ledgers = listReadable();
    if (!this.ledgerId || !ledgers.some((l) => l.id === this.ledgerId)) this.ledgerId = ledgers[0]?.id ?? null;
    return { ledgers };
  }

  _replaceHTML({ ledgers }, content) {
    if (!ledgers.length) {
      content.innerHTML = `<p>${esc(t("QUICKPAY.viewer.none"))}</p>`;
      return;
    }
    const opts = ledgers
      .map((l) => `<option value="${esc(l.id)}"${l.id === this.ledgerId ? " selected" : ""}>${esc(l.kind === "personal" ? t("QUICKPAY.viewer.personalPrefix") : "")}${esc(l.name)}</option>`)
      .join("");
    content.innerHTML =
      `<div class="quickpay-controls">` +
      `<select name="ledger">${opts}</select>` +
      `<input type="search" name="text" placeholder="${esc(t("QUICKPAY.viewer.search"))}" value="${esc(this.filters.text)}">` +
      `<select name="status">${STATUSES.map((s) => `<option value="${s}"${s === this.filters.status ? " selected" : ""}>${esc(t(`QUICKPAY.status.${s}`))}</option>`).join("")}</select>` +
      `<select name="party"></select>` +
      `<select name="direction"><option value="">${esc(t("QUICKPAY.viewer.inAndOut"))}</option><option value="in">${esc(t("QUICKPAY.viewer.moneyIn"))}</option><option value="out">${esc(t("QUICKPAY.viewer.moneyOut"))}</option></select>` +
      `<select name="sort"><option value="newest">${esc(t("QUICKPAY.viewer.newest"))}</option><option value="oldest">${esc(t("QUICKPAY.viewer.oldest"))}</option></select>` +
      `</div><div class="quickpay-summary"></div><div class="quickpay-scroll"></div>`;
    this._wire(content);
    this._fillTable(content);
  }

  _wire(content) {
    content.querySelector("[name=ledger]").addEventListener("change", (ev) => {
      this.ledgerId = ev.target.value;
      this.filters.party = "";
      this.render();
    });
    for (const name of ["text", "status", "party", "direction", "sort"]) {
      const el = content.querySelector(`[name=${name}]`);
      el.addEventListener(name === "text" ? "input" : "change", (ev) => {
        this.filters[name] = ev.target.value;
        this._fillTable(content);
      });
    }
  }

  _fillTable(content) {
    const data = readEntries(this.ledgerId);
    const scroll = content.querySelector(".quickpay-scroll");
    if (!data) {
      scroll.innerHTML = `<p>${esc(t("QUICKPAY.viewer.unavailable"))}</p>`;
      return;
    }
    const personal = data.kind === "personal";
    const denoms = getDenominations({ hidden: [] });

    const party = content.querySelector("[name=party]");
    const names = partyNames(data.entries);
    party.innerHTML =
      `<option value="">${esc(t("QUICKPAY.viewer.everyone"))}</option>` +
      names.map((n) => `<option value="${esc(n)}"${n === this.filters.party ? " selected" : ""}>${esc(n)}</option>`).join("");
    const dir = content.querySelector("[name=direction]");
    dir.hidden = !personal;
    dir.value = this.filters.direction;
    content.querySelector("[name=sort]").value = this.filters.sort;

    const rows = filterEntries(data.entries, this.filters, denoms);
    const summary = content.querySelector(".quickpay-summary");
    if (personal) {
      const tot = totals(rows, denoms);
      summary.innerHTML = `<p class="quickpay-totals">${esc(t("QUICKPAY.ledger.totals", { in: tot.inText, out: tot.outText, net: tot.netText }))} <small>${esc(t("QUICKPAY.viewer.completedOnly"))}</small></p>`;
    } else summary.innerHTML = "";
    scroll.innerHTML = rows.length
      ? `<table class="quickpay-ledger-table"><thead>${headerHTML(personal)}</thead><tbody>${rowsHTML(rows, denoms)}</tbody></table>`
      : `<p><em>${esc(t("QUICKPAY.viewer.nothing"))}</em></p>`;
  }
}

export const openLedgerViewer = (ledgerId = null) => new LedgerViewer(ledgerId).render({ force: true });
