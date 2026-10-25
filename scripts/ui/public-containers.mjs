import { MODULE_ID, FLAGS } from "../constants.mjs";
import { holdsCurrency } from "../adapters/dnd5e.mjs";
import { esc } from "../core/format.mjs";
import { worldOptions } from "../options-store.mjs";

// The base class only exists inside Foundry. A stand-in lets the file load in tests.
const ApplicationV2 = globalThis.foundry?.applications?.api?.ApplicationV2 ?? class {};

/** Container items the current user may flag: owned ones, or every one for a GM. Optionally one actor's only. */
export function flaggableContainers(user = game.user, actor = null) {
  if (!user.isGM && worldOptions().containerFlagging === "gm") return [];
  const actors = actor ? [actor] : game.actors.contents;
  return actors
    .filter((a) => user.isGM || a.testUserPermission(user, "OWNER"))
    .flatMap((a) => a.items.contents.filter((i) => i.type === "container" && holdsCurrency(i)));
}

/** Tick a container to let any player send coins to it (a swear jar, a party chest). */
export class PublicContainers extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "dnd-quickpay-public-containers",
    classes: ["dnd-quickpay", "quickpay-public"],
    tag: "div",
    window: { title: "Public containers", icon: "fa-solid fa-coins quickpay-gold", resizable: true },
    position: { width: 420, height: "auto" },
  };

  constructor(actor = null, options = {}) {
    super(options);
    this.actor = actor;
  }

  async _renderHTML() {
    return {};
  }

  _replaceHTML(_result, content) {
    const list = flaggableContainers(game.user, this.actor).sort((a, b) =>
      `${a.parent.name}${a.name}`.localeCompare(`${b.parent.name}${b.name}`),
    );
    if (!list.length) {
      content.innerHTML = "<p>No containers to show.</p>";
      return;
    }
    content.innerHTML =
      `<div class="quickpay-form"><p>Anyone can send coins to a ticked container.</p>` +
      `<input type="search" name="filter" placeholder="Search">` +
      `<div class="quickpay-scroll">` +
      list
        .map(
          (c) =>
            `<label class="quickpay-row-check" data-name="${esc(`${c.parent.name}: ${c.name}`.toLowerCase())}">` +
            `<input type="checkbox" data-uuid="${esc(c.uuid)}"${c.getFlag(MODULE_ID, FLAGS.publicRecipient) === true ? " checked" : ""}> ` +
            `${esc(c.parent.name)}: ${esc(c.name)}</label>`,
        )
        .join("") +
      `</div></div>`;
    content.querySelector('[name="filter"]').addEventListener("input", (ev) => {
      const text = ev.target.value.toLowerCase().trim();
      content.querySelectorAll(".quickpay-row-check").forEach((row) => (row.hidden = !!text && !row.dataset.name.includes(text)));
    });
    content.addEventListener("change", async (ev) => {
      const box = ev.target.closest("input[data-uuid]");
      if (!box) return;
      box.disabled = true;
      try {
        const item = await fromUuid(box.dataset.uuid);
        if (!item) throw new Error("missing");
        if (box.checked) await item.setFlag(MODULE_ID, FLAGS.publicRecipient, true);
        else await item.unsetFlag(MODULE_ID, FLAGS.publicRecipient);
      } catch (err) {
        console.error(`${MODULE_ID} | could not change that container`, err);
        ui.notifications.warn("Couldn't change that container. You need to own it.");
        box.checked = !box.checked;
      } finally {
        box.disabled = false;
      }
    });
  }
}

export const openPublicContainers = (actor = null) => new PublicContainers(actor).render({ force: true });
