# DND QuickPay: design notes

A plain-language walkthrough of how the module is built and why. It is meant for the author (and any maintainer) to read before changing the code, and to answer questions about the design.

> [!IMPORTANT]
> **AMEND:** These notes were written with Claude's help, so they are not proof that you understand the code. Read them alongside the source, in the order given in "Reading order" below. Fix anything that doesn't match what you see, and add your own words where a section is thin. The "Check yourself" questions at the end are there to find the gaps.

## The big idea

Players can't edit actors they don't own, but a payment changes two actors at once. So **every transfer is carried out by a GM's browser**. A player's client sends a request to the GM's client through socketlib. The GM's client checks the request, moves the coins, and posts the chat cards.

Coins are never "in flight" without a record. When a transfer needs the recipient to accept, the sender's coins are taken straight away and held (**escrow**) in a record in a world setting. They go to the recipient on acceptance, and back to the sender on decline, expiry, or cancel.

## Reading order

1. `scripts/core/coins.mjs`: the coin maths. Small, pure, and the base for everything else.
2. `scripts/core/engine.mjs`: the rules for a transfer (escrow, permissions, approval, expiry).
3. `scripts/foundry-deps.mjs`: how the engine is connected to real Foundry documents and settings.
4. `scripts/socket.mjs`: how requests get from a player to the GM.
5. `scripts/chat.mjs` and `scripts/core/format.mjs`: the chat cards.
6. `scripts/ledger.mjs` and `scripts/core/ledger-format.mjs`: the journals.
7. `scripts/ui/*`: windows and buttons. These contain no money rules.

## Layers

| Layer | Files | Rule |
| --- | --- | --- |
| Pure logic | `scripts/core/*.mjs` | No Foundry globals. Everything it needs is passed in. This is why it can be tested in plain Node. |
| System adapter | `scripts/adapters/dnd5e.mjs` | The only place that knows dnd5e's data model (`system.currency`, `CONFIG.DND5E.currencies`). Another system would add a sibling file. |
| Foundry glue | `scripts/foundry-deps.mjs`, `socket.mjs`, `settings.mjs`, `ledger.mjs`, `chat.mjs`, `main.mjs` | Reads and writes real documents, settings, and chat. |
| Interface | `scripts/ui/*.mjs` | Windows, sheet header buttons, token HUD buttons, toolbar. Asks the engine to do things. Never moves coins itself. |
| Text | `scripts/i18n.mjs`, `lang/en.json` | Every player-facing string is looked up here. |

## Coins (`core/coins.mjs`)

- Every denomination has a `value` in the smallest coin unit (copper is 1). The adapter works this out from dnd5e's `conversion` numbers, so a changed currency setup still works.
- `normalizeAmount` cleans an amount that came from outside (a dialog, a macro, or a socket). It rejects unknown coins, negatives, fractions, and anything unsafe.
- `planPayment` decides which coins to spend and what change to give back. It spends exact coins where it can, makes change from larger coins when it must, and uses electrum as change only as a last resort.
- Money is only ever changed through a **delta** (for example `{ gp: -1, sp: +5 }`). `applyDelta` refuses a result below zero, and `invertDelta` gives the refund.

## The engine (`core/engine.mjs`)

The engine is created with `createEngine(deps)`. `deps` supplies documents, coins, the pending store, the log, ledgers, settings, the clock, and an event emitter. In Foundry, `buildEngine()` in `foundry-deps.mjs` supplies real versions. In tests, fakes are supplied instead.

**Serialisation.** Every operation goes through a promise chain, so two requests run one after the other. This stops two payments spending the same coins.

**A request (`doRequest`)** works in this order:
1. Check who is asking and clean the input (note length, visibility, ledger id).
2. Find the sender and recipient documents and check both can hold coins.
3. Apply the **permission grid**. GMs are never restricted. A player must own the sender. Only GMs can send from or to "nowhere" (creating or removing coins). The recipient is classified (own actor, other player, GM-side actor, own container, public container, other container) and the grid says allow, needs approval, or block.
4. Check any ledger tag is one the user may use.
5. Work out the coins with `planPayment`, then apply limits (the per-transfer cap for players).
6. If the grid says "needs approval", store an approval record and stop. **No coins move.**
7. Otherwise take the coins from the sender (the escrow). If the recipient must accept, store a pending record. If not, credit the recipient now and finish. If crediting fails, the sender's debit is rolled back.

**Ending a transfer (`finish`)** removes it from the pending store, writes it to the log, writes any ledger entries (a ledger failure never undoes a transfer), and emits a hook.

**Accept, decline, cancel, approve, deny, amend** each check who is allowed (the recipient's owners, the sender, or any GM) and whether the record is still pending. Decline and cancel return the escrow through `refundSender`.

**Expiry** is based on in-world time (`game.time.worldTime`), so it only moves when the world clock moves.

**Several recipients (`requestMany`)** checks every recipient and the total cost first, then runs the sends one at a time. If something unexpected fails part-way, transfers already completed are not rolled back. This is a known limit.

## Where data lives

| Data | Where |
| --- | --- |
| Pending transfers and approval requests | World setting `pending` |
| Global log of ended transfers (capped at 2000) | World setting `log` |
| Options, permission grid, hidden coins, ledger creators | World settings |
| A player's own options | A flag on the user |
| Business and personal ledgers | JournalEntry documents with a `ledger` flag (capped at 1000 entries each) |
| "Must accept coins" per character, personal ledger switch | Flags on the actor |
| "Public container" | A flag on the container item |

## Socket and identity (`socket.mjs`)

socketlib runs the handler on a GM's client. Each handler reads **who asked from socketlib itself** (`this.socketdata.userId`), which the Foundry server supplies. It never trusts a user id sent in the arguments, so a player can't pretend to be someone else. If no GM is online, the player is told so and nothing is taken.

## Chat (`chat.mjs`, `core/format.mjs`)

Cards are built from the transfer record. Everything a player can type (notes, names) is HTML-escaped. Visibility decides who the card is whispered to. GM-only transfers show the recipient's owners a masked card (no sender, no note). Buttons on cards call back into the engine through the socket, so a click is checked like any other request.

## Ledgers (`ledger.mjs`)

A ledger is a JournalEntry whose flag holds the entries, with one text page that is a rendering of them. Who can read it is the journal's ownership (Observer or better). Personal ledgers record money in and out from the character's point of view and hide the source and note of GM-only transfers from the player. Writing a ledger can fail without affecting the transfer.

## Interface (`scripts/ui`)

- `send-dialog.mjs`: builds the Send/Receive window, previews the payment using the same `planPayment` the engine uses, and calls the engine through the socket.
- `targets.mjs`: builds the list of possible recipients, limited to what a player is allowed to see.
- `pick.mjs`: lets the user click tokens on the canvas.
- `entry-points.mjs` and `gm-tools.mjs`: sheet header menu, token HUD buttons, and the GM toolbar.
- `options-app.mjs`: one window per settings pane, plus a small hub window.
- `ledger-app.mjs` and `public-containers.mjs`: the viewer and the container list.

The preview in the dialog is a convenience only. The engine re-checks everything, so a player who bypasses the dialog gains nothing.

## Text and translation

`t(key, data)` in `scripts/i18n.mjs` looks up `lang/en.json` through `game.i18n`. Outside Foundry (in tests) it reads the same file. A missing key returns the key itself, so mistakes are easy to see. A test checks that every key used in the code exists, and every key in the file is used.

## Security stance

- Fail closed: an unknown rule or missing value means "no".
- The server-supplied user id is the only identity.
- Players cannot create or destroy coins.
- All player-entered text is escaped before it reaches HTML.
- Known limits (also in the README): the public-container flag and the pending/log data are readable or settable from the browser console by a determined player.

## Tests

`npm test` runs ten files. The engine tests include a randomised check that the total amount of coin in the system never changes except through GM creation or removal. The smoke test runs the real Foundry-facing scripts against stand-ins for Foundry's globals. What the tests **cannot** show is how Foundry itself behaves (rendering, permissions, real socketlib), which is why releases are checked in a live world.

## How to change things safely

- **A new rule about who can pay whom:** `core/options.mjs` (the rule list and classification), `core/engine.mjs` (where the grid is applied), then the Permissions pane in `ui/options-app.mjs`, `lang/en.json`, and tests.
- **A new setting:** add a default in `core/options.mjs`, a control in the relevant pane in `ui/options-app.mjs`, the strings in `lang/en.json`, and a test.
- **Support another game system:** add `adapters/<system>.mjs` with the same exports as `adapters/dnd5e.mjs`, and choose it in `main.mjs`.
- **A new translation:** copy `lang/en.json` to `lang/<code>.json`, translate the values, and add it to `languages` in `module.json`.

## Check yourself

If you can answer these without opening the code, you understand the design well enough to maintain it.

1. A player pays another player 5 gp and the recipient never answers. Where are the 5 gp, and what happens after 12 in-world hours?
2. What stops a player from sending a request pretending to be a GM?
3. Why does the engine run every operation through one promise chain?
4. What happens if the recipient's actor is deleted while a transfer is pending?
5. Why is the preview in the Send dialog not a security check?
6. If writing the ledger journal fails, what happens to the transfer?
7. Where would you add a new system's currency rules?
8. Which parts can the automated tests not verify?
9. What is the known weakness of the public-container flag?
10. What does `requestMany` do if the third of five sends fails?

> [!IMPORTANT]
> **AMEND:** Answer these yourself in your own words (a few lines each) and keep your answers somewhere handy. Foundry's AI policy says the maintainer must be able to explain the design if asked.
