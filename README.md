# DND QuickPay

A Foundry VTT module for sending coins between players, GMs, actors, and containers. Built for Foundry v14.367+ and dnd5e, with socketlib required. A system adapter layer is in place so other systems can be added later.

**Status:** stage 2 of the build. The transfer engine, escrow, and pending transfers work, but there is no UI yet. Everything is driven from the console or macros.

## Install

Use the manifest URL from a GitHub release:
`https://github.com/<user>/<repo>/releases/latest/download/module.json`

Install socketlib too, then enable both in your world.

## How transfers work

- Players can't edit other actors, so every transfer runs on the GM's client through socketlib. If no GM is online, the player sees "This transaction needs Bank Manager approval." (editable in module settings) and nothing is taken.
- The sender's coins leave immediately (escrow). Change is made automatically, and electrum is only handed back as change if nothing else works.
- Sending to a **player-owned actor** waits for that actor's owner to accept, unless the recipient owns both ends or has turned acceptance off (flag `dnd-quickpay.requiresAcceptance = false`). Sending to GM-side actors and containers completes straight away.
- A pending transfer expires after 12 in-world hours (setting), which returns the escrow. It only counts down when the world clock moves, for example on a long rest.
- Decline, expire, and cancel all return the coins to the sender. A GM can accept, decline, or cancel anything.
- Players can send from actors they own to any actor, to containers they own, or to containers flagged `dnd-quickpay.publicRecipient = true`. Only GMs can create coins from nowhere (null sender) or remove them (null recipient).

## Console API (stage 2)

```js
const qp = game.modules.get("dnd-quickpay").api;

await qp.request({
  senderUuid: "Actor.xxxx",          // null = coins from nowhere (GM only)
  recipientUuid: "Actor.yyyy",       // actor or container UUID; null = remove coins (GM only)
  amount: { gp: 2, sp: 5 },
  note: "Thanks for the rope",
  visibility: "public",              // "public" | "gm-recipient" | "gm" (stored for the chat stage)
  ledgerId: null                     // stored for the ledger stage
});

qp.pending();                        // your pending transfers (GM sees all)
await qp.accept(id);  await qp.decline(id);  await qp.cancel(id);
qp.log();                            // GM only: every resolved transfer
await qp.expireNow();                // GM only
```

Hooks for other modules and the upcoming chat stage: `dnd-quickpay.transferPending` and `dnd-quickpay.transferResolved`, both called with the transfer record.

## Known limits at this stage

- No chat messages, dialogs, or buttons yet.
- The pending list and the log live in world settings, so a technical player can read them from the console. The ledger stage moves them to GM-only journals. The log is capped at the latest 2000 transfers until then.
- The permission rules are fixed defaults. The configurable matrix comes later.

## Tests

```
npm test
```

Runs the coin maths, the engine (escrow, permissions, expiry, concurrency, and a randomised check that coins are never created or destroyed), and a smoke test of the Foundry wiring against stand-ins for Foundry's globals. No dependencies.

## Roadmap

1. Coin maths and dnd5e adapter (done)
2. GM-side executor, escrow, and pending transfers (done)
3. Ledgers, chat messages, send dialog, sheet header and token HUD buttons
4. Options menus (GM and player), predefined targets, public container flagging
