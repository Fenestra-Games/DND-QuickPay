import { holdsCurrency } from "../adapters/dnd5e.mjs";

/** Can the current user open QuickPay for this actor? */
const usableFor = (actor) =>
  !!actor && actor.documentName === "Actor" && holdsCurrency(actor) && (game.user.isGM || actor.testUserPermission(game.user, "OWNER"));

const send = async (actor, mode) => (await import("./send-dialog.mjs")).openSend(actor, mode);
const viewer = async () => (await import("./ledger-app.mjs")).openLedgerViewer();

/** Sheet header menu and token HUD buttons. */
export function initEntryPoints() {
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app.document;
    if (!usableFor(actor) || controls.some((c) => c.action === "quickpay-send")) return;
    controls.push({
      icon: "fa-solid fa-coins quickpay-gold",
      label: "Send coins",
      action: "quickpay-send",
      onClick: () => send(actor, "send"),
    });
    if (game.user.isGM) {
      controls.push({
        icon: "fa-solid fa-hand-holding-dollar quickpay-gold",
        label: "Receive coins",
        action: "quickpay-receive",
        onClick: () => send(actor, "receive"),
      });
    }
    if (actor.items.contents.some((i) => i.type === "container")) {
      controls.push({
        icon: "fa-solid fa-box-open quickpay-gold",
        label: "Public containers",
        action: "quickpay-containers",
        onClick: async () => (await import("./public-containers.mjs")).openPublicContainers(actor),
      });
    }
    controls.push({
      icon: "fa-solid fa-book quickpay-gold",
      label: "Coin ledgers",
      action: "quickpay-ledgers",
      onClick: () => viewer(),
    });
  });

  Hooks.on("renderTokenHUD", (hud, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const actor = hud.object?.actor ?? hud.document?.actor;
    if (!root || !usableFor(actor) || root.querySelector("[data-quickpay]")) return;
    const make = (mode, icon, tip) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "control-icon";
      b.dataset.quickpay = mode;
      b.dataset.tooltip = tip;
      b.setAttribute("aria-label", tip);
      b.innerHTML = `<i class="${icon} quickpay-gold" inert></i>`;
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        send(actor, mode);
      });
      return b;
    };
    const col = root.querySelector(".col.left") ?? root;
    col.append(make("send", "fa-solid fa-coins", "Send coins"));
    if (game.user.isGM) col.append(make("receive", "fa-solid fa-hand-holding-dollar", "Receive coins"));
  });
}
