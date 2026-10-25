import { MODULE_ID } from "../constants.mjs";
import { getDenominations } from "../adapters/dnd5e.mjs";
import { esc } from "../core/format.mjs";
import { filterEntries, partyNames, rowsHTML, headerHTML, totals } from "../core/ledger-format.mjs";
import { listReadable, readEntries } from "../ledger.mjs";

const { ApplicationV2 } = foundry.applications.api;

const STATUSES = ["completed", "all", "pending", "declined", "expired", "cancelled"];

/** Searchable, filterable ledger viewer. Reads only ledgers the current user may open. */
export class LedgerViewer extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "dnd-quickpay-ledger-viewer",
    classes: ["dnd-quickpay", "quickpay-viewer"],
    tag: "div",
    window: { title: "QuickPay Ledgers", resizable: true },
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
      content.innerHTML = "<p>You can't open any ledgers yet.</p>";
      return;
    }
    const opts = ledgers
      .map((l) => `<option value="${esc(l.id)}"${l.id === this.ledgerId ? " selected" : ""}>${esc(l.kind === "personal" ? "Personal: " : "")}${esc(l.name)}</option>`)
      .join("");
    content.innerHTML =
      `<div class="quickpay-controls">` +
      `<select name="ledger">${opts}</select>` +
      `<input type="search" name="text" placeholder="Search" value="${esc(this.filters.text)}">` +
      `<select name="status">${STATUSES.map((s) => `<option value="${s}"${s === this.filters.status ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>` +
      `<select name="party"></select>` +
      `<select name="direction"><option value="">in and out</option><option value="in">money in</option><option value="out">money out</option></select>` +
      `<select name="sort"><option value="newest">newest first</option><option value="oldest">oldest first</option></select>` +
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
      scroll.innerHTML = "<p>That ledger isn't available to you.</p>";
      return;
    }
    const personal = data.kind === "personal";
    const denoms = getDenominations({ hidden: [] });

    const party = content.querySelector("[name=party]");
    const names = partyNames(data.entries);
    party.innerHTML =
      `<option value="">everyone</option>` +
      names.map((n) => `<option value="${esc(n)}"${n === this.filters.party ? " selected" : ""}>${esc(n)}</option>`).join("");
    const dir = content.querySelector("[name=direction]");
    dir.hidden = !personal;
    dir.value = this.filters.direction;
    content.querySelector("[name=sort]").value = this.filters.sort;

    const rows = filterEntries(data.entries, this.filters, denoms);
    const summary = content.querySelector(".quickpay-summary");
    if (personal) {
      const t = totals(rows, denoms);
      summary.innerHTML = `<p class="quickpay-totals">In: ${esc(t.inText)} &middot; Out: ${esc(t.outText)} &middot; Net: ${esc(t.netText)} <small>(completed only)</small></p>`;
    } else summary.innerHTML = "";
    scroll.innerHTML = rows.length
      ? `<table class="quickpay-ledger-table"><thead>${headerHTML(personal)}</thead><tbody>${rowsHTML(rows, denoms)}</tbody></table>`
      : "<p><em>Nothing matches.</em></p>";
  }
}

export const openLedgerViewer = (ledgerId = null) => new LedgerViewer(ledgerId).render({ force: true });
