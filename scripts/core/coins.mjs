/**
 * Pure coin maths. No Foundry globals, so it can be tested in Node.
 *
 * A "denomination" looks like { key: "gp", value: 100, abbreviation: "gp", noChange: false }
 * where `value` is the coin's size in the smallest coin unit (cp = 1).
 * `noChange: true` means the coin is not handed back as change unless nothing else works.
 *
 * An "amount" or "delta" is a plain object keyed by denomination: { sp: 15 }.
 */

const fail = (reason) => ({ ok: false, reason });

/** Total size of an amount in the smallest coin unit. */
export function toUnits(amount, denoms) {
  let total = 0;
  for (const d of denoms) total += (amount[d.key] ?? 0) * d.value;
  return total;
}

/**
 * Validate an amount that came from outside (a dialog, a macro, or a player's
 * client over a socket) and return a clean copy.
 * Accepts only own keys that are enabled denominations, with whole numbers
 * greater than zero. Zero is skipped. Anything else is rejected.
 * @returns {{ok:false, reason:string} | {ok:true, receive:object, cost:number}}
 */
export function normalizeAmount(amount, denoms) {
  if (amount === null || typeof amount !== "object" || Array.isArray(amount)) {
    return fail("Invalid amount.");
  }
  const known = new Set(denoms.map((d) => d.key));
  const receive = {};
  for (const k of Object.keys(amount)) {
    const n = amount[k];
    if (n === 0) continue;
    if (!known.has(k)) return fail(`The denomination "${k}" is not available.`);
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) {
      return fail("Amounts must be whole, positive numbers.");
    }
    receive[k] = n;
  }
  const cost = toUnits(receive, denoms);
  if (!Number.isSafeInteger(cost)) return fail("That amount is too large.");
  if (cost <= 0) return fail("The amount must be greater than zero.");
  return { ok: true, receive, cost };
}

/** Human readable amount, largest coin first. e.g. "2 gp, 15 sp" */
export function formatAmount(amount, denoms) {
  const parts = [];
  for (const d of [...denoms].sort((a, b) => b.value - a.value)) {
    const n = amount[d.key] ?? 0;
    if (n) parts.push(`${n} ${d.abbreviation ?? d.key}`);
  }
  return parts.join(", ") || "nothing";
}

/** Flip a delta so it can be used to refund an escrowed payment. */
export function invertDelta(delta) {
  const out = {};
  for (const [k, n] of Object.entries(delta)) if (n) out[k] = -n;
  return out;
}

/** Apply a delta to a balance without mutating it. Returns null if any coin would go negative. */
export function applyDelta(balance, delta) {
  const out = { ...balance };
  for (const [k, n] of Object.entries(delta)) {
    out[k] = (out[k] ?? 0) + n;
    if (out[k] < 0) return null;
  }
  return out;
}

/**
 * Work out how a payer settles an amount, with automatic change-making.
 *
 * Order of spending:
 *  1. The requested denominations first, then smaller ones (largest first).
 *  2. If that is not enough, break coins with leftover balance, smallest first.
 *  3. Any overpay comes back as change in the fewest coins, using only
 *     denominations smaller than the largest coin that was broken.
 *
 * `denoms` must already exclude any filtered denominations, which are
 * ignored completely (never spent, never given as change).
 *
 * @returns {{ok:false, reason:string} | {ok:true, cost:number, receive:object,
 *           spend:object, change:object, delta:object}}
 *   `delta` is the payer's net change per denomination (negative = loses coin).
 *   `receive` is exactly what the recipient gets.
 */
export function planPayment(balance, amount, denoms) {
  const norm = normalizeAmount(amount, denoms);
  if (!norm.ok) return norm;
  const { receive, cost } = norm;

  const bal = {};
  for (const d of denoms) bal[d.key] = Math.max(0, Math.floor(balance[d.key] ?? 0));

  let held = 0;
  for (const d of denoms) held += bal[d.key] * d.value;
  if (held < cost) return fail("Not enough coin to cover that amount.");

  const desc = [...denoms].sort((a, b) => b.value - a.value);
  const spend = Object.fromEntries(denoms.map((d) => [d.key, 0]));
  const change = Object.fromEntries(denoms.map((d) => [d.key, 0]));

  const requested = desc.filter((d) => receive[d.key] > 0);
  const ceiling = requested[0].value;
  let remaining = cost;

  // Pass 1: requested denominations first, then smaller ones, largest first
  const pass1 = [
    ...requested,
    ...desc.filter((d) => d.value < ceiling && !receive[d.key]),
  ];
  for (const d of pass1) {
    const take = Math.min(bal[d.key], Math.floor(remaining / d.value));
    spend[d.key] += take;
    remaining -= take * d.value;
  }

  // Pass 2: break any coin with leftover balance, smallest first.
  // Every coin with leftover after pass 1 is worth more than what is still owed,
  // so one break is enough per coin type.
  let brokenValue = 0;
  const breakable = [...desc].reverse();
  for (const d of breakable) {
    if (remaining <= 0) break;
    const left = bal[d.key] - spend[d.key];
    if (left <= 0) continue;
    const take = Math.min(left, Math.ceil(remaining / d.value));
    spend[d.key] += take;
    remaining -= take * d.value;
    brokenValue = Math.max(brokenValue, d.value);
  }
  if (remaining > 0) return fail("Not enough coin to cover that amount.");

  // Change for any overpay, avoiding noChange coins (electrum) unless nothing else works
  const over = -remaining;
  if (over > 0) {
    const makeChange = (pool) => {
      let left = over;
      const out = {};
      for (const d of pool) {
        if (d.value >= brokenValue) continue;
        const n = Math.floor(left / d.value);
        if (n) out[d.key] = n;
        left -= n * d.value;
      }
      return { out, left };
    };
    let res = makeChange(desc.filter((d) => !d.noChange));
    if (res.left > 0) res = makeChange(desc);
    if (res.left > 0) return fail("Exact change can't be made with the available denominations.");
    for (const [k, n] of Object.entries(res.out)) change[k] += n;
  }

  const delta = {};
  for (const d of denoms) {
    const net = change[d.key] - spend[d.key];
    if (net) delta[d.key] = net;
  }

  return { ok: true, cost, receive, spend, change, delta };
}
