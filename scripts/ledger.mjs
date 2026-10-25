import { MODULE_ID } from "./constants.mjs";
import { getDenominations } from "./adapters/dnd5e.mjs";
import { entryFromRecord, personalEntryFromRecord, tableHTML } from "./core/ledger-format.mjs";

/**
 * Journal-backed ledgers. Everything here runs on the GM's client (the engine calls it),
 * except the read helpers at the bottom, which any client may use.
 *
 * Each ledger is a JournalEntry with:
 *   flags.dnd-quickpay.ledger = { version, kind: "business"|"personal", name, entries: [...] }
 *   one text page that is a rendering of those entries.
 * Who can read a ledger is just that journal's ownership: OBSERVER or better.
 */
const FLAG = "ledger";
const ENTRY_CAP = 1000;
const FOLDERS = { business: "QuickPay Ledgers", personal: "QuickPay Personal Ledgers" };
const LEVEL = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;

const denoms = () => getDenominations({ hidden: [] });

/** In-world time as text, using the active calendar if there is one. */
export function whenText(seconds) {
  try {
    const out = game.time.calendar?.format?.(seconds);
    if (out) return String(out);
  } catch {
    /* fall through */
  }
  return `Day ${Math.floor(seconds / 86400) + 1}`;
}

// ---- permissions ---------------------------------------------------------------
export function creatorSetting() {
  const s = game.settings.get(MODULE_ID, "ledgerCreators") ?? {};
  return { mode: ["gm", "all", "users"].includes(s.mode) ? s.mode : "gm", users: Array.isArray(s.users) ? s.users : [] };
}

export function canCreate(userId) {
  const u = game.users.get(userId);
  if (!u) return false;
  if (u.isGM) return true;
  const { mode, users } = creatorSetting();
  return mode === "all" || (mode === "users" && users.includes(userId));
}

const journalOf = (id) => (typeof id === "string" ? game.journal?.get(id) : null);
const dataOf = (journal) => journal?.getFlag(MODULE_ID, FLAG) ?? null;

export function canUse(userId, ledgerId) {
  const journal = journalOf(ledgerId);
  const data = dataOf(journal);
  const user = game.users.get(userId);
  if (!journal || data?.kind !== "business" || !user) return false;
  return user.isGM || journal.testUserPermission(user, "OBSERVER");
}

// ---- journals ------------------------------------------------------------------
async function folderFor(kind) {
  const name = FOLDERS[kind];
  const found = game.folders?.find((f) => f.type === "JournalEntry" && f.name === name && f.getFlag(MODULE_ID, "kind") === kind);
  if (found) return found.id;
  const made = await Folder.create({ name, type: "JournalEntry", flags: { [MODULE_ID]: { kind } } });
  return made.id;
}

async function makeJournal({ kind, name, ownership, extra = {} }) {
  const data = { version: 1, kind, name, entries: [], ...extra };
  const journal = await JournalEntry.create({
    name,
    folder: await folderFor(kind),
    ownership,
    pages: [{ name: "Ledger", type: "text", text: { content: tableHTML([], denoms(), { personal: kind === "personal" }), format: 1 } }],
    flags: { [MODULE_ID]: { [FLAG]: data } },
  });
  return journal;
}

/** Save entries and rebuild the page. */
async function writeEntries(journal, entries) {
  const data = dataOf(journal) ?? {};
  const trimmed = entries.slice(-ENTRY_CAP);
  await journal.setFlag(MODULE_ID, FLAG, { ...data, entries: trimmed });
  const page = journal.pages.contents[0];
  const html = tableHTML(trimmed, denoms(), { personal: data.kind === "personal" });
  if (page) await page.update({ "text.content": html });
  else await journal.createEmbeddedDocuments("JournalEntryPage", [{ name: "Ledger", type: "text", text: { content: html, format: 1 } }]);
}

function upsert(entries, entry) {
  const i = entries.findIndex((e) => e.id === entry.id);
  if (i >= 0) entries[i] = entry;
  else entries.push(entry);
  return entries;
}

// ---- business ledgers ------------------------------------------------------------
export async function create(name, userId, { visibleToAll = false } = {}) {
  const user = game.users.get(userId);
  const L = LEVEL();
  const ownership = { default: visibleToAll ? L.OBSERVER : L.NONE };
  if (user && !user.isGM) ownership[userId] = L.OWNER;
  const journal = await makeJournal({ kind: "business", name, ownership });
  return { id: journal.id, name: journal.name };
}

export async function record(rec) {
  const journal = journalOf(rec.ledgerId);
  if (!journal || dataOf(journal)?.kind !== "business") return;
  const entries = [...(dataOf(journal).entries ?? [])];
  await writeEntries(journal, upsert(entries, entryFromRecord(rec, whenText(rec.resolvedAt ?? rec.createdAt))));
}

export async function reconcile(before, after) {
  if (before.ledgerId && before.ledgerId !== after.ledgerId) {
    const old = journalOf(before.ledgerId);
    if (old && dataOf(old)?.kind === "business") {
      await writeEntries(old, (dataOf(old).entries ?? []).filter((e) => e.id !== before.id));
    }
  }
  if (after.ledgerId) await record(after);
}

export function nameOfLedger(ledgerId) {
  const journal = journalOf(ledgerId);
  return dataOf(journal)?.kind === "business" ? journal.name : null;
}

/** Ledgers this user may read (business only). */
export function listLedgers(user = game.user) {
  return (game.journal?.contents ?? [])
    .filter((j) => dataOf(j)?.kind === "business" && (user.isGM || j.testUserPermission(user, "OBSERVER")))
    .map((j) => ({ id: j.id, name: j.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- personal ledgers ----------------------------------------------------------
const PERSONAL_FLAG = "personalLedger"; // on the actor: true = on, false = off, unset = default
const JOURNAL_FLAG = "personalJournal"; // on the actor: the journal id

function ownersOf(actor) {
  return game.users.contents.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER")).map((u) => u.id);
}

/** Player characters by default, NPCs only when switched on for that actor. */
export function hasPersonalLedger(actor) {
  if (!actor || actor.documentName !== "Actor") return false;
  const setting = actor.getFlag(MODULE_ID, PERSONAL_FLAG);
  if (setting === true) return true;
  if (setting === false) return false;
  return actor.type === "character" && ownersOf(actor).length > 0;
}

async function personalJournal(actor) {
  const existing = journalOf(actor.getFlag(MODULE_ID, JOURNAL_FLAG));
  const L = LEVEL();
  const ownership = { default: L.NONE };
  for (const id of ownersOf(actor)) ownership[id] = L.OBSERVER;
  if (existing && dataOf(existing)?.kind === "personal") {
    // keep readers in step with who owns the character now
    const cur = existing.ownership ?? {};
    const same = Object.keys({ ...cur, ...ownership }).every((k) => k === "default" || (cur[k] ?? 0) === (ownership[k] ?? 0));
    if (!same) await existing.update({ ownership: { ...ownership } }, { diff: false, recursive: false });
    return existing;
  }
  const journal = await makeJournal({
    kind: "personal",
    name: `${actor.name} (QuickPay ledger)`,
    ownership,
    extra: { actorUuid: actor.uuid },
  });
  await actor.setFlag(MODULE_ID, JOURNAL_FLAG, journal.id);
  return journal;
}

/** The actor behind a record side. A container counts as its owner's money. */
function actorOf(side) {
  if (!side?.uuid) return null;
  try {
    const doc = fromUuidSync(side.uuid);
    if (!doc) return null;
    return doc.documentName === "Item" ? doc.parent : doc.documentName === "Actor" ? doc : null;
  } catch {
    return null;
  }
}

function sidesOf(rec) {
  const from = actorOf(rec.sender);
  const to = actorOf(rec.recipient);
  const out = [];
  if (from && hasPersonalLedger(from) && !(to && to.id === from.id)) out.push({ actor: from, side: "out" });
  if (to && hasPersonalLedger(to) && !(from && from.id === to.id)) out.push({ actor: to, side: "in" });
  return out;
}

export async function recordPersonal(rec) {
  for (const { actor, side } of sidesOf(rec)) {
    try {
      const journal = await personalJournal(actor);
      const entry = personalEntryFromRecord(rec, side, {
        when: whenText(rec.resolvedAt ?? rec.createdAt),
        ownerIds: ownersOf(actor),
      });
      await writeEntries(journal, upsert([...(dataOf(journal).entries ?? [])], entry));
    } catch (err) {
      console.error(`${MODULE_ID} | personal ledger write failed for ${actor.name}`, err);
    }
  }
}

export async function reconcilePersonal(_before, after) {
  await recordPersonal(after);
}

/** GM tool: make sure every player character has a ledger journal. Returns how many exist. */
export async function createAllPersonal() {
  let count = 0;
  for (const actor of game.actors?.contents ?? []) {
    if (!hasPersonalLedger(actor)) continue;
    await personalJournal(actor);
    count++;
  }
  return count;
}

export async function setPersonalEnabled(actor, on) {
  await actor.setFlag(MODULE_ID, PERSONAL_FLAG, on === null ? null : !!on);
  if (on) await personalJournal(actor);
}

// ---- reading (any client) --------------------------------------------------------
/** Entries in a ledger the current user can read, or null. */
export function readEntries(ledgerId, user = game.user) {
  const journal = journalOf(ledgerId);
  const data = dataOf(journal);
  if (!journal || !data) return null;
  if (!(user.isGM || journal.testUserPermission(user, "OBSERVER"))) return null;
  return { id: journal.id, name: journal.name, kind: data.kind, entries: structuredClone(data.entries ?? []) };
}

/** Every ledger (business and personal) the user can read, for the viewer's picker. */
export function listReadable(user = game.user) {
  return (game.journal?.contents ?? [])
    .filter((j) => dataOf(j) && (user.isGM || j.testUserPermission(user, "OBSERVER")))
    .map((j) => ({ id: j.id, name: j.name, kind: dataOf(j).kind }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
