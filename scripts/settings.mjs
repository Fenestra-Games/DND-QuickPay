import { MODULE_ID, DEFAULT_OFFLINE_MESSAGE } from "./constants.mjs";
import { PANE_LIST, PANE_CLASSES } from "./ui/options-app.mjs";
import { PublicContainers } from "./ui/public-containers.mjs";

export function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);

  // Internal state (not shown in the settings window)
  reg("pending", { scope: "world", config: false, type: Object, default: {} });
  reg("log", { scope: "world", config: false, type: Object, default: { records: [] } });
  reg("hiddenDenominations", { scope: "world", config: false, type: Object, default: { list: [] } });

  reg("options", { scope: "world", config: false, type: Object, default: {} });
  reg("permissions", { scope: "world", config: false, type: Object, default: {} });
  reg("ledgerCreators", { scope: "world", config: false, type: Object, default: { mode: "gm", users: [] } });

  // Shown to the GM
  reg("expiryHours", {
    name: "Pending transfer expiry (in-world hours)",
    hint: "How long a transfer waiting for acceptance lasts before the coins go back to the sender. Counted in game time, so it only runs out when the world clock moves (for example on a long rest).",
    scope: "world",
    config: false,
    type: Number,
    default: 12,
    range: { min: 1, max: 720, step: 1 },
  });
  reg("offlineMessage", {
    name: "Message when no GM is online",
    hint: "Shown to a player who tries to send coins while no GM is connected. Leave it blank for a plain message.",
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_OFFLINE_MESSAGE,
  });

  // Each section is its own button on the module's settings page. GM-only ones are hidden from players.
  for (const p of PANE_LIST) {
    game.settings.registerMenu(MODULE_ID, `options-${p.key}`, {
      name: p.title,
      label: p.label,
      hint: p.hint,
      icon: p.icon,
      type: PANE_CLASSES[p.key],
      restricted: p.gmOnly,
    });
  }
  game.settings.registerMenu(MODULE_ID, "options-containers", {
    name: "Public containers",
    label: "Public containers",
    hint: "Tick the containers that anyone may send coins to.",
    icon: "fa-solid fa-box-open",
    type: PublicContainers,
    restricted: false,
  });
}
