# DND QuickPay

A Foundry VTT module for sending coins between players, GMs, actors, and containers. Built for Foundry v14.367+ and dnd5e, with socketlib required. A system adapter layer is in place so other systems can be added later.

**Status:** stage 3b of the build, plus the GM toolbar. Players can send coins from a dialog, opened from the character sheet or the token HUD. The player Options menu, predefined targets, and the configurable permission matrix come in stage 4.

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

## Sending coins

- **Character sheet:** open the sheet's header menu (the three dots) and choose Send coins. GMs also get Receive coins. Everyone gets Coin ledgers, and Public containers if the character has a container.
- **Token HUD:** right-click a token you own. The coin buttons are in the left column. GMs get a second button to receive.
- **GM toolbar:** GMs get a DND QuickPay group in the scene controls with Send, Receive, Ledgers, Public containers, Create personal ledgers, and Who can create ledgers.
- The dialog shows what the sender holds, then a live preview of what will be paid, any change coming back, and what is left. Amount boxes start blank.
- **Targets prefill:** anything you have targeted on the canvas is already chosen as a recipient when the dialog opens.
- **Pick on the scene:** the crosshair button hides the dialog so you can click tokens. Right-click, Enter, or Escape finishes. Players can only pick tokens they can see.
- **Several recipients:** add as many as you like (up to 25). Each gets the full amount as its own transfer, with its own chat card and its own acceptance. The module checks that the sender can cover the whole total and that every recipient is allowed before any coin moves.
- Players can choose from targeted tokens, tokens they can see on the scene, player characters, their own containers, and public containers. GMs also get every actor and container, plus Nowhere (create or remove coins).
- **Public containers:** tick a container in the Public containers window and any player can send coins to it. Owners can tick their own, and GMs can tick any.
- From a macro: `game.modules.get("dnd-quickpay").api.openSend()` opens the dialog for your selected token, or your own character if nothing is selected. To receive as a GM: `game.modules.get("dnd-quickpay").api.openSend(canvas.tokens.controlled[0].actor, "receive")`.

## Chat cards

- The sender always sees a result card. Visibility `public` (the default) shows everyone, `gm-recipient` shows the GMs, the sender, and the recipient's owners, and `gm` shows the GMs and the sender.
- When acceptance is needed, the recipient's owners and the GMs get a card with Accept and Decline buttons (GMs also get Cancel). The sender gets a waiting card with Cancel. These turn into plain text once the transfer ends.

## Ledgers

- **Business ledgers** are named journals (for example "Jims Pickles") in a "QuickPay Ledgers" folder. Tag a transfer with `ledgerId` when sending, or add or change it later with `qp.amend(id, { ledgerId, note })`. Who can read a ledger is that journal's permission (Observer or better). Only GMs can create ledgers unless you change it with `qp.setLedgerCreators({ mode: "all" })` or `{ mode: "users", users: [userIds] }`.
- **Personal ledgers** are one journal per player character, in a "QuickPay Personal Ledgers" folder, made the first time a transfer touches the character. Owners can read their own. They show money in and out from the character's point of view and record every ended transfer, including declined and expired ones. A GM-only transfer shows the player as an "Unknown deposit" or "Unknown withdrawal" with no source and no note. NPCs have no personal ledger unless you switch one on with `qp.ledgers.setPersonal(actorUuid, true)`.
- `qp.ledgers.open()` opens a searchable viewer with filters for status, person, and direction. The journal page itself is a static table of completed transfers.

## Console API

```js
const qp = game.modules.get("dnd-quickpay").api;

await qp.request({
  senderUuid: "Actor.xxxx",          // null = coins from nowhere (GM only)
  recipientUuid: "Actor.yyyy",       // actor or container UUID; null = remove coins (GM only)
  amount: { gp: 2, sp: 5 },
  note: "Thanks for the rope",
  visibility: "public",              // "public" | "gm-recipient" | "gm"
  ledgerId: null                     // a business ledger id from qp.ledgers.list()
});

qp.pending();                        // your pending transfers (GM sees all)
await qp.accept(id);  await qp.decline(id);  await qp.cancel(id);
qp.log();                            // GM only: every resolved transfer
await qp.amend(id, { note: "fixed", ledgerId });
await qp.ledgers.create("Jims Pickles");  qp.ledgers.list();  qp.ledgers.open();
await qp.ledgers.createPersonal();   // GM only: journals for every player character
await qp.expireNow();                // GM only
```

Hooks for other modules: `dnd-quickpay.transferPending`, `dnd-quickpay.transferResolved`, and `dnd-quickpay.transferAmended`, both called with the transfer record.

## Known limits at this stage

- The send dialog and entry points have only been tested against stand-ins. Treat them as new until you've run them in your world.
- The Foundry-side ledger and chat code is tested against stand-ins only, so treat it as new until you have run it in your world.
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
