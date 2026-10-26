import { t } from "../i18n.mjs";
/**
 * Click a token on the canvas to choose it. The caller hides its own window first.
 *
 * Clicks on the canvas are captured before Foundry sees them, so picking does not select,
 * target, or drag anything. Right-click, Enter, or Escape finishes; with `multiple: false`
 * the first valid token finishes it.
 */

/** The topmost token (last in the list) whose rectangle contains the point. */
export function tokenAt(point, tokens) {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const b = tokens[i].bounds;
    if (b && point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
      return tokens[i];
    }
  }
  return null;
}

/**
 * @param {object} opts
 * @param {(token: Token) => boolean} opts.allow  which tokens may be picked
 * @param {boolean} [opts.multiple]
 * @param {(actor: Actor) => void} [opts.onPick]  called as each token is picked
 * @returns {Promise<Actor[]>} the picked actors, in order
 */
export function pickTokens({ allow, multiple = false, onPick = () => {} }) {
  return new Promise((resolve) => {
    const surface = canvas.app?.canvas ?? canvas.app?.view;
    if (!surface) return resolve([]);
    const picked = [];
    const hint = multiple
      ? t("QUICKPAY.pick.many")
      : t("QUICKPAY.pick.one");
    ui.notifications.info(hint, { permanent: false });
    const previousCursor = surface.style.cursor;
    surface.style.cursor = "crosshair";

    const EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu"];
    const stop = (ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };

    const finish = () => {
      for (const name of EVENTS) window.removeEventListener(name, onMouse, true);
      window.removeEventListener("keydown", onKey, true);
      surface.style.cursor = previousCursor;
      resolve(picked);
    };

    function onMouse(ev) {
      if (ev.target !== surface) return; // let the rest of the interface work normally
      stop(ev);
      if (ev.type === "contextmenu") return finish();
      if (ev.type !== "pointerdown" || ev.button !== 0) return;
      const point = canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
      const token = tokenAt(point, (canvas.tokens?.placeables ?? []).filter(allow));
      if (!token?.actor) return;
      if (!picked.some((a) => a.uuid === token.actor.uuid)) {
        picked.push(token.actor);
        onPick(token.actor);
      }
      if (!multiple) finish();
    }

    function onKey(ev) {
      if (ev.key === "Escape" || ev.key === "Enter") {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        finish();
      }
    }

    for (const name of EVENTS) window.addEventListener(name, onMouse, true);
    window.addEventListener("keydown", onKey, true);
  });
}
