export const MODULE_ID = "dnd-quickpay";
export const MODULE_TITLE = "DND QuickPay";

/** Flag keys written to documents */
export const FLAGS = {
  publicRecipient: "publicRecipient", // on container items: any player may target it
  requiresAcceptance: "requiresAcceptance", // on actors, default true
};

/**
 * The global log is kept in a world setting for now. It is capped so the setting
 * can't grow without limit. The ledger stage moves it to journal entries.
 */
export const LOG_CAP = 2000;

export const DEFAULT_OFFLINE_MESSAGE = "This transaction needs Bank Manager approval.";
