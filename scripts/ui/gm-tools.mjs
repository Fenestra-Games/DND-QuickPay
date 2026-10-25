import { MODULE_ID } from "../constants.mjs";
import { esc } from "../core/format.mjs";
import { creatorSetting, createAllPersonal } from "../ledger.mjs";

const selectedActor = () => canvas?.tokens?.controlled?.[0]?.actor ?? null;

const needToken = () => ui.notifications.warn("Select a token first.");

async function ledgerCreators() {
  const { DialogV2 } = foundry.applications.api;
  const cur = creatorSetting();
  const players = game.users.contents.filter((u) => !u.isGM);
  const content =
    `<div class="form-group"><label>Who can create ledgers</label><select name="mode">` +
    [["gm", "Only the GM"], ["users", "The GM and chosen players"], ["all", "Everyone"]]
      .map(([v, l]) => `<option value="${v}"${cur.mode === v ? " selected" : ""}>${l}</option>`)
      .join("") +
    `</select></div><fieldset><legend>Chosen players</legend>` +
    players.map((u) => `<label><input type="checkbox" name="u-${esc(u.id)}"${cur.users.includes(u.id) ? " checked" : ""}> ${esc(u.name)}</label>`).join("<br>") +
    `</fieldset>`;
  const data = await DialogV2.input({ window: { title: "Who can create ledgers" }, content, ok: { label: "Save" } });
  if (!data) return;
  const users = players.filter((u) => data[`u-${u.id}`]).map((u) => u.id);
  await game.settings.set(MODULE_ID, "ledgerCreators", { mode: ["gm", "users", "all"].includes(data.mode) ? data.mode : "gm", users });
  ui.notifications.info("Saved.");
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
      title: "DND QuickPay",
      icon: "fa-solid fa-coins quickpay-gold",
      visible: true,
      activeTool: "qp-send",
      onChange: () => {},
      onToolChange: () => {},
      tools: {
        "qp-send": tool("qp-send", "Send coins from selected token", "fa-solid fa-coins quickpay-gold", 1, () => {
          const a = selectedActor();
          return a ? open("./send-dialog.mjs", "openSend", a, "send") : needToken();
        }),
        "qp-receive": tool("qp-receive", "Give coins to selected token", "fa-solid fa-hand-holding-dollar quickpay-gold", 2, () => {
          const a = selectedActor();
          return a ? open("./send-dialog.mjs", "openSend", a, "receive") : needToken();
        }),
        "qp-ledgers": tool("qp-ledgers", "Coin ledgers", "fa-solid fa-book quickpay-gold", 3, () => open("./ledger-app.mjs", "openLedgerViewer")),
        "qp-containers": tool("qp-containers", "Public containers", "fa-solid fa-box-open quickpay-gold", 4, () => open("./public-containers.mjs", "openPublicContainers")),
        "qp-personal": tool("qp-personal", "Create personal ledgers", "fa-solid fa-user-plus quickpay-gold", 5, async () => {
          const n = await createAllPersonal();
          ui.notifications.info(`${n} personal ${n === 1 ? "ledger" : "ledgers"} ready.`);
        }),
        "qp-creators": tool("qp-creators", "Who can create ledgers", "fa-solid fa-user-gear quickpay-gold", 6, ledgerCreators),
      },
    };
  });
}
