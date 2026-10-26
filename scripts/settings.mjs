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
    name: "QUICKPAY.opt.expiry",
    hint: "QUICKPAY.opt.expirySettingHint",
    scope: "world",
    config: false,
    type: Number,
    default: 12,
    range: { min: 1, max: 720, step: 1 },
  });
  reg("offlineMessage", {
    name: "QUICKPAY.opt.offlineMessage",
    hint: "QUICKPAY.opt.offlineSettingHint",
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_OFFLINE_MESSAGE,
  });

  // Each section is its own button on the module's settings page. GM-only ones are hidden from players.
  for (const p of PANE_LIST) {
    game.settings.registerMenu(MODULE_ID, `options-${p.key}`, {
      name: p.titleKey,
      label: p.titleKey,
      hint: p.hintKey,
      icon: p.icon,
      type: PANE_CLASSES[p.key],
      restricted: p.gmOnly,
    });
  }
  game.settings.registerMenu(MODULE_ID, "options-containers", {
    name: "QUICKPAY.menu.containers",
    label: "QUICKPAY.menu.containers",
    hint: "QUICKPAY.containers.menuHint",
    icon: "fa-solid fa-box-open",
    type: PublicContainers,
    restricted: false,
  });
}
