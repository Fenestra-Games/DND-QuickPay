/**
 * Option and permission defaults, validation, and the permission matrix. Pure functions.
 * Whatever is stored is run through these on every read, so a bad or missing value
 * (a hand-edited setting, an older version) falls back to the default instead of breaking.
 */

export const VISIBILITIES = ["public", "gm-recipient", "gm"];
export const MAX_RECIPIENTS = 25;

export const DEFAULT_OPTIONS = Object.freeze({
  // acceptance
  acceptanceDefault: true,
  playersMayChangeAcceptance: true,
  gmGiftsSkipAcceptance: false,
  // containers
  containerFlagging: "owner", // "owner" (owner and GM) or "gm"
  // ledgers
  ledgerDefaultReaders: "gm", // "gm" or "all"
  personalLedgers: true,
  autoCreatePersonal: false,
  maskGmOnly: true,
  // limits, in gold pieces (0 means none)
  confirmAboveGp: 100,
  maxPerTransferGp: 0,
  maxRecipients: MAX_RECIPIENTS,
  // chat
  defaultVisibility: "public",
  waitingCard: true,
});

export const PERMISSION_RULES = Object.freeze([
  { key: "playerToOwnActor", label: "Player to another of their own characters" },
  { key: "playerToPlayer", label: "Player to another player's character" },
  { key: "playerToGMActor", label: "Player to an NPC or other GM-side actor" },
  { key: "playerToOwnContainer", label: "Player to a container they own" },
  { key: "playerToPublicContainer", label: "Player to a public container" },
  { key: "playerToOtherContainer", label: "Player to any other container" },
]);
export const PERMISSION_VALUES = ["allow", "approval", "block"];

export const DEFAULT_PERMISSIONS = Object.freeze({
  playerToOwnActor: "allow",
  playerToPlayer: "allow",
  playerToGMActor: "allow",
  playerToOwnContainer: "allow",
  playerToPublicContainer: "allow",
  playerToOtherContainer: "block",
});

export const DEFAULT_PLAYER_OPTIONS = Object.freeze({
  defaultVisibility: "", // "" means use the world default
  defaultLedger: "",
  rememberRecipients: false,
  confirmBeforeSend: false,
  notifyOnReceive: true,
  hiddenDenominations: [],
});

const bool = (v, d) => (typeof v === "boolean" ? v : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, d, min, max) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

/** World options, validated, with defaults for anything missing. */
export function mergeOptions(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_OPTIONS;
  return {
    acceptanceDefault: bool(r.acceptanceDefault, d.acceptanceDefault),
    playersMayChangeAcceptance: bool(r.playersMayChangeAcceptance, d.playersMayChangeAcceptance),
    gmGiftsSkipAcceptance: bool(r.gmGiftsSkipAcceptance, d.gmGiftsSkipAcceptance),
    containerFlagging: oneOf(r.containerFlagging, ["owner", "gm"], d.containerFlagging),
    ledgerDefaultReaders: oneOf(r.ledgerDefaultReaders, ["gm", "all"], d.ledgerDefaultReaders),
    personalLedgers: bool(r.personalLedgers, d.personalLedgers),
    autoCreatePersonal: bool(r.autoCreatePersonal, d.autoCreatePersonal),
    maskGmOnly: bool(r.maskGmOnly, d.maskGmOnly),
    confirmAboveGp: num(r.confirmAboveGp, d.confirmAboveGp, 0, 1_000_000_000),
    maxPerTransferGp: num(r.maxPerTransferGp, d.maxPerTransferGp, 0, 1_000_000_000),
    maxRecipients: num(r.maxRecipients, d.maxRecipients, 1, MAX_RECIPIENTS),
    defaultVisibility: oneOf(r.defaultVisibility, VISIBILITIES, d.defaultVisibility),
    waitingCard: bool(r.waitingCard, d.waitingCard),
  };
}

/** The permission grid, validated. */
export function mergePermissions(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const { key } of PERMISSION_RULES) out[key] = oneOf(r[key], PERMISSION_VALUES, DEFAULT_PERMISSIONS[key]);
  return out;
}

/** One player's own options, validated. `knownDenoms` limits which coins may be hidden. */
export function mergePlayerOptions(raw, knownDenoms = null) {
  const r = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_PLAYER_OPTIONS;
  const hidden = Array.isArray(r.hiddenDenominations)
    ? [...new Set(r.hiddenDenominations.filter((k) => typeof k === "string" && (!knownDenoms || knownDenoms.includes(k))))]
    : [];
  return {
    defaultVisibility: r.defaultVisibility === "" ? "" : oneOf(r.defaultVisibility, VISIBILITIES, d.defaultVisibility),
    defaultLedger: typeof r.defaultLedger === "string" ? r.defaultLedger.slice(0, 64) : d.defaultLedger,
    rememberRecipients: bool(r.rememberRecipients, d.rememberRecipients),
    confirmBeforeSend: bool(r.confirmBeforeSend, d.confirmBeforeSend),
    notifyOnReceive: bool(r.notifyOnReceive, d.notifyOnReceive),
    hiddenDenominations: hidden,
  };
}

/**
 * Which row of the permission grid a player's transfer falls under.
 * @param {{recipientKind:"actor"|"container", ownsRecipient:boolean, isPublic:boolean, isPlayerOwned:boolean}} c
 */
export function classifyRecipient(c) {
  if (c.recipientKind === "container") {
    if (c.ownsRecipient) return "playerToOwnContainer";
    if (c.isPublic) return "playerToPublicContainer";
    return "playerToOtherContainer";
  }
  if (c.ownsRecipient) return "playerToOwnActor";
  return c.isPlayerOwned ? "playerToPlayer" : "playerToGMActor";
}

/** "allow", "approval", or "block" for a player's transfer. GMs are never restricted. */
export function decidePermission(permissions, rule) {
  return permissions[rule] ?? "block";
}

/** A gold limit as smallest-coin units, or null when there is none or no gold coin exists. */
export function limitUnits(gp, denoms) {
  if (!gp) return null;
  const g = denoms.find((x) => x.key === "gp");
  return g ? gp * g.value : null;
}
