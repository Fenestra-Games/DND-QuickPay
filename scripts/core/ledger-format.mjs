/**
 * Ledger entries, filtering, totals, and the HTML table. Pure functions: no Foundry globals.
 *
 * A ledger lives in a journal entry's flags as { version, kind, entries: [...] }.
 *  - kind "business": a shared ledger a transfer is tagged to. Entries are from/to.
 *  - kind "personal": one character's own history. Entries are money in or out
 *    from that character's point of view, whatever the source.
 * The journal page is just a rendering of that data, rebuilt on every change.
 */
import { formatAmount, toUnits } from "./coins.mjs";
import { esc } from "./format.mjs";

export const ENTRY_VERSION = 1;

// ---- entries -------------------------------------------------------------------

/** A business-ledger entry made from a resolved transfer record. */
export function entryFromRecord(record, when) {
  return {
    version: ENTRY_VERSION,
    id: record.id,
    at: record.createdAt,
    resolvedAt: record.resolvedAt,
    when: when ?? "",
    status: record.status,
    resolution: record.resolution,
    from: record.sender?.name ?? null,
    to: record.recipient?.name ?? null,
    amount: { ...record.amount },
    note: record.note ?? "",
    by: record.initiatedByName ?? "",
  };
}

/**
 * A personal-ledger entry: what this character gained or lost.
 *
 * @param {object} record
 * @param {"in"|"out"} side  "in" if the character received the coins, "out" if they sent them
 * @param {object} [opts]
 * @param {string} [opts.when]      formatted in-world time
 * @param {string[]} [opts.ownerIds] the character's non-GM owners. A GM-only transfer hides its
 *   source and note from them, unless they started it themselves. With no owners there is
 *   nobody to hide anything from (an NPC's ledger is only ever read by the GM).
 */
export function personalEntryFromRecord(record, side, { when = "", ownerIds = [] } = {}) {
  const hidden =
    record.visibility === "gm" && ownerIds.length > 0 && !ownerIds.includes(record.initiatedBy);
  const other = side === "in" ? record.sender : record.recipient;
  return {
    version: ENTRY_VERSION,
    id: record.id,
    at: record.createdAt,
    resolvedAt: record.resolvedAt,
    when,
    status: record.status,
    resolution: record.resolution,
    direction: side,
    hidden,
    counterparty: hidden ? null : other?.name ?? null,
    // for a hidden withdrawal, what was taken from: "actor" (their pocket) or "container" (named)
    takenFrom: hidden && side === "out" ? (String(record.sender?.uuid ?? "").includes(".Item.") ? record.sender?.name ?? "" : "") : "",
    amount: { ...record.amount },
    note: hidden ? "" : record.note ?? "",
    by: hidden ? "" : record.initiatedByName ?? "",
  };
}

/** "Deposit", "Withdrawal", "Unknown deposit" or "Unknown withdrawal" (personal entries). */
export function entryLabel(e) {
  const base = e.direction === "in" ? "deposit" : "withdrawal";
  const text = e.hidden && e.direction === "out" ? "Pickpocketed" : e.hidden ? `Unknown ${base}` : e.direction === "in" ? "Deposit" : "Withdrawal";
  return text;
}

/** Who the other side was, in words. */
export function counterpartyText(e) {
  if (e.hidden && e.direction === "out") {
    return e.takenFrom ? `The GM has picked ${e.takenFrom}` : "The GM has picked your pocket";
  }
  if (e.hidden) return "Unknown";
  if (e.counterparty) return e.counterparty;
  return e.direction === "in" ? "The GM" : "Removed by the GM";
}

// ---- amounts and totals --------------------------------------------------------

const amountText = (e, denoms) => formatAmount(e.amount ?? {}, denoms ?? []);

/** An amount with a sign for personal entries: +2 gp or -5 sp. */
export function signedAmountText(e, denoms) {
  const text = amountText(e, denoms);
  if (e.direction === "in") return `+${text}`;
  if (e.direction === "out") return `-${text}`;
  return text;
}

/** Break a number of smallest-coin units into coins, largest first. Skips no-change coins like electrum. */
export function unitsToAmount(units, denoms) {
  const out = {};
  let left = Math.abs(units);
  for (const d of [...denoms].filter((x) => !x.noChange).sort((a, b) => b.value - a.value)) {
    const n = Math.floor(left / d.value);
    if (n) {
      out[d.key] = n;
      left -= n * d.value;
    }
  }
  return out;
}

/** Completed money in and out for a set of personal entries. */
export function totals(entries, denoms) {
  let inUnits = 0;
  let outUnits = 0;
  for (const e of entries ?? []) {
    if (e.status !== "completed") continue;
    const u = toUnits(e.amount ?? {}, denoms);
    if (e.direction === "in") inUnits += u;
    else if (e.direction === "out") outUnits += u;
  }
  const net = inUnits - outUnits;
  return {
    inText: formatAmount(unitsToAmount(inUnits, denoms), denoms),
    outText: formatAmount(unitsToAmount(outUnits, denoms), denoms),
    netText: `${net < 0 ? "-" : net > 0 ? "+" : ""}${formatAmount(unitsToAmount(net, denoms), denoms)}`,
    net,
  };
}

// ---- searching and filtering ---------------------------------------------------

/** Everything searchable about an entry, lower-cased. */
export function entrySearchText(e, denoms) {
  const parts = [e.from, e.to, e.by, e.note, e.status, e.when, amountText(e, denoms)];
  if (e.direction) parts.push(entryLabel(e), counterpartyText(e));
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * @param {object} f
 * @param {string} [f.text]       words that must all appear somewhere in the entry
 * @param {string} [f.status]     "completed" (default), "all", or a specific status
 * @param {string} [f.party]      exact name that must be the sender, recipient, or other side
 * @param {string} [f.direction]  "in" or "out" (personal ledgers)
 * @param {string} [f.sort]       "newest" (default) or "oldest"
 */
export function filterEntries(entries, f = {}, denoms = []) {
  const words = String(f.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const status = f.status ?? "completed";
  const party = f.party ?? "";
  const direction = f.direction ?? "";
  const out = (entries ?? []).filter((e) => {
    if (status !== "all" && e.status !== status) return false;
    if (direction && e.direction !== direction) return false;
    if (party && e.from !== party && e.to !== party && e.counterparty !== party) return false;
    if (words.length) {
      const hay = entrySearchText(e, denoms);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const key = (e) => e.resolvedAt ?? e.at ?? 0;
  out.sort((a, b) => (f.sort === "oldest" ? key(a) - key(b) : key(b) - key(a)));
  return out;
}

/** Every distinct name that appears in a ledger, sorted. */
export function partyNames(entries) {
  const set = new Set();
  for (const e of entries ?? []) {
    for (const n of [e.from, e.to, e.counterparty]) if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ---- HTML ----------------------------------------------------------------------

export function rowsHTML(entries, denoms) {
  return entries
    .map((e) => {
      if (e.direction) {
        return (
          `<tr class="quickpay-row quickpay-${esc(e.status)} quickpay-${esc(e.direction)}">` +
          `<td>${esc(e.when)}</td>` +
          `<td>${esc(entryLabel(e))}</td>` +
          `<td>${esc(counterpartyText(e))}</td>` +
          `<td>${esc(signedAmountText(e, denoms))}</td>` +
          `<td>${esc(e.status)}</td>` +
          `<td>${esc(e.note)}</td>` +
          `</tr>`
        );
      }
      return (
        `<tr class="quickpay-row quickpay-${esc(e.status)}">` +
        `<td>${esc(e.when)}</td>` +
        `<td>${esc(e.from ?? "(nowhere)")}</td>` +
        `<td>${esc(e.to ?? "(removed)")}</td>` +
        `<td>${esc(amountText(e, denoms))}</td>` +
        `<td>${esc(e.status)}</td>` +
        `<td>${esc(e.note)}</td>` +
        `<td>${esc(e.by)}</td>` +
        `</tr>`
      );
    })
    .join("");
}

export function headerHTML(personal) {
  return personal
    ? `<tr><th>When</th><th>Type</th><th>Other side</th><th>Amount</th><th>Status</th><th>Note</th></tr>`
    : `<tr><th>When</th><th>From</th><th>To</th><th>Amount</th><th>Status</th><th>Note</th><th>By</th></tr>`;
}

/**
 * The static table written to the journal page: completed entries, newest first,
 * capped so the page stays light. The filterable viewer shows everything.
 */
export function tableHTML(entries, denoms, { limit = 300, personal = false } = {}) {
  const shown = filterEntries(entries, { status: "completed" }, denoms);
  const rows = shown.slice(0, limit);
  const total = (entries ?? []).length;
  let note =
    `<p class="quickpay-ledger-note">Showing ${rows.length} of ${shown.length} completed transfers` +
    `${total > shown.length ? ` (${total - shown.length} other entries are in the viewer)` : ""}. ` +
    `Open the ledger viewer to search and filter.</p>`;
  if (personal && shown.length) {
    const t = totals(entries, denoms);
    note += `<p class="quickpay-totals">In: ${esc(t.inText)} &middot; Out: ${esc(t.outText)} &middot; Net: ${esc(t.netText)}</p>`;
  }
  if (!rows.length) return `${note}<p><em>No transfers recorded yet.</em></p>`;
  return (
    `${note}<table class="quickpay-ledger-table"><thead>${headerHTML(personal)}</thead>` +
    `<tbody>${rowsHTML(rows, denoms)}</tbody></table>`
  );
}
