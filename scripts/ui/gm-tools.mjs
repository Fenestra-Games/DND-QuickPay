import { MODULE_ID } from "../constants.mjs";
import { esc } from "../core/format.mjs";
import { creatorSetting, createAllPersonal } from "../ledger.mjs";
import { t } from "../i18n.mjs";

const selectedActor = () => canvas?.tokens?.controlled?.[0]?.actor ?? null;

const needToken = () => ui.notifications.warn(t("QUICKPAY.tool.selectToken"));

async function ledgerCreators() {
  const { DialogV2 } = foundry.applications.api;
  const cur = creatorSetting();
  const players = game.users.contents.filter((u) => !u.isGM);
  const content =
    `<div class="form-group"><label>${esc(t("QUICKPAY.creators.label"))}</label><select name="mode">` +
    [["gm", "QUICKPAY.creators.gm"], ["users", "QUICKPAY.creators.users"], ["all", "QUICKPAY.creators.all"]]
      .map(([v, l]) => `<option value="${v}"${cur.mode === v ? " selected" : ""}>${esc(t(l))}</option>`)
      .join("") +
    `</select></div><fieldset><legend>${esc(t("QUICKPAY.creators.chosen"))}</legend>` +
    players.map((u) => `<label><input type="checkbox" name="u-${esc(u.id)}"${cur.users.includes(u.id) ? " checked" : ""}> ${esc(u.name)}</label>`).join("<br>") +
    `</fieldset>`;
  const data = await DialogV2.input({ window: { title: t("QUICKPAY.creators.label") }, content, ok: { label: t("QUICKPAY.btn.save") } });
  if (!data) return;
  const users = players.filter((u) => data[`u-${u.id}`]).map((u) => u.id);
  await game.settings.set(MODULE_ID, "ledgerCreators", { mode: ["gm", "users", "all"].includes(data.mode) ? data.mode : "gm", users });
  ui.notifications.info(t("QUICKPAY.tool.saved"));
}

/** A QuickPay group in the scene controls toolbar, GM only. */
export function initGMTools() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const open = async (file, fn, ...args) => (await import(file))[fn](...args);
    const tool = (name, title, icon, order, onChange) => ({ name, title, icon, order, button: true, onChange });
    controls.quickpay = {
      name: "quickpay",
      order: 90,
      title: t("QUICKPAY.title"),
      icon: "fa-solid fa-coins quickpay-gold",
      visible: true,
      activeTool: "qp-send",
      onChange: () => {},
      onToolChange: () => {},
      tools: {
        "qp-send": tool("qp-send", t("QUICKPAY.tool.send"), "fa-solid fa-coins quickpay-gold", 1, () => {
          const a = selectedActor();
          return a ? open("./send-dialog.mjs", "openSend", a, "send") : needToken();
        }),
        "qp-receive": tool("qp-receive", t("QUICKPAY.tool.receive"), "fa-solid fa-hand-holding-dollar quickpay-gold", 2, () => {
          const a = selectedActor();
          return a ? open("./send-dialog.mjs", "openSend", a, "receive") : needToken();
        }),
        "qp-ledgers": tool("qp-ledgers", t("QUICKPAY.menu.ledgers"), "fa-solid fa-book quickpay-gold", 3, () => open("./ledger-app.mjs", "openLedgerViewer")),
        "qp-containers": tool("qp-containers", t("QUICKPAY.menu.containers"), "fa-solid fa-box-open quickpay-gold", 4, () => open("./public-containers.mjs", "openPublicContainers")),
        "qp-options": tool("qp-options", t("QUICKPAY.menu.options"), "fa-solid fa-sliders quickpay-gold", 5, () => open("./options-app.mjs", "openOptions")),
        "qp-personal": tool("qp-personal", t("QUICKPAY.tool.personal"), "fa-solid fa-user-plus quickpay-gold", 6, async () => {
          const n = await createAllPersonal();
          ui.notifications.info(t(n === 1 ? "QUICKPAY.tool.personalReadyOne" : "QUICKPAY.tool.personalReady", { n }));
        }),
        "qp-creators": tool("qp-creators", t("QUICKPAY.creators.label"), "fa-solid fa-user-gear quickpay-gold", 7, ledgerCreators),
      },
    };
  });
}
