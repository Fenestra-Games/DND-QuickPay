import { MODULE_ID } from "./constants.mjs";
import { getDenominations, getBalance, holdsCurrency, quote } from "./adapters/dnd5e.mjs";

Hooks.once("init", () => {
  if (game.system.id !== "dnd5e") {
    console.warn(`${MODULE_ID} | Only dnd5e is supported so far. Disabling.`);
    return;
  }
  game.modules.get(MODULE_ID).api = { getDenominations, getBalance, holdsCurrency, quote };
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") return;
  // Stage 1 has no UI yet. Dry-run from the console:
  //   const api = game.modules.get("dnd-quickpay").api;
  //   api.getDenominations();
  //   api.quote(await fromUuid("Actor.<id>"), { sp: 15 });
  console.log(`${MODULE_ID} | stage 1 loaded (no UI yet)`);
});
