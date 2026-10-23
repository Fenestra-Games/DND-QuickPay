# DND QuickPay

A Foundry VTT module for sending coins between players, GMs, actors, and containers. Built for Foundry v14.367+ and dnd5e, with socketlib required. A system adapter layer is in place so other systems can be added later.

**Status:** stage 1 of the build (coin maths and the dnd5e adapter). There is no UI yet.

## Install

1. Publish a release on GitHub (tag it like `v0.1.0`). The release workflow attaches `module.json` and `module.zip`.
2. In Foundry, go to Add-on Modules, then Install Module, and paste:
   `https://github.com/<your-user>/<your-repo>/releases/latest/download/module.json`
3. Install socketlib if it isn't already, then enable both in your world.

## Try it (GM console)

```js
const api = game.modules.get("dnd-quickpay").api;
console.log(api.getDenominations());               // check coin values
const actor = game.actors.getName("Some Actor");
console.log(api.quote(actor, { sp: 15 }));         // dry run, writes nothing
```

## Tests

```
npm test
```

Runs the pure coin maths tests in Node. No dependencies.

## Roadmap

1. Coin maths and dnd5e adapter (done)
2. GM-side executor, escrow, and pending transfers
3. Ledgers, send dialog, sheet header and token HUD buttons
4. Options menus (GM and player)
