# DND QuickPay

Send coins between players, GMs, actors, and containers in Foundry VTT, with escrow, automatic change, approvals, and ledgers.

> [!IMPORTANT]
> **AMEND:** Add a banner screenshot or a short GIF of a transfer here (Send dialog, then the chat card). Suggested size: about 900 px wide.

![Banner placeholder](docs/banner.png)

- **Foundry:** v14.367 or newer
- **System:** dnd5e (a system adapter layer is in place for others later)
- **Requires:** [socketlib](https://foundryvtt.com/packages/socketlib)
- **Licence:** MIT
- **Author:** Fenestra Games (support@fenestra.gripe). Made using Claude AI.

Full documentation is in the [wiki](https://github.com/Fenestra-Games/DND-QuickPay/wiki).

## What it does

- Send coins from the character sheet, the token HUD, or the GM toolbar.
- Coins leave the sender straight away (escrow) and come back if the transfer is declined, expires, or is cancelled.
- Change is made automatically. Electrum is only used as a last resort.
- Recipients can be required to accept. GM-side actors and containers accept automatically.
- Send the same amount to up to 25 recipients at once.
- Permissions, approvals, and limits for players, set by the GM.
- Business ledgers and per-character personal ledgers, kept as journals, with a searchable viewer.
- Public containers that any player may pay into.
- GM-only transfers can appear to players as "Unknown deposit" or "Pickpocketed".
- Gold coin icons throughout.

## Install

1. In Foundry, open **Add-on Modules, Install Module**.
2. Paste this into **Manifest URL**: `https://github.com/Fenestra-Games/DND-QuickPay/releases/latest/download/module.json`
3. Install **socketlib** as well.
4. Enable both in your world.

> [!IMPORTANT]
> **AMEND:** If you later list the module in the Foundry package directory, replace this section with a link to the package page.

## Quick start

1. Open a character sheet, click the three dots in the header, and choose **Send coins**.
2. Choose a recipient (or target a token first and it is chosen for you), type an amount, and send.
3. The recipient's owner gets a chat card with **Accept** and **Decline**.
4. GMs can open **Configure Settings, Module Settings, DND QuickPay** to set permissions, limits, and ledgers.

> [!IMPORTANT]
> **AMEND:** Add a screenshot of the Send dialog showing the balance, the preview, and the recipient chips.

## Documentation

| Page | What is in it |
| --- | --- |
| [Installation](https://github.com/Fenestra-Games/DND-QuickPay/wiki/Installation) | Install, requirements, updating |
| [Sending coins](https://github.com/Fenestra-Games/DND-QuickPay/wiki/Sending-coins) | The Send dialog, targets, multiple recipients |
| [Permissions and approvals](https://github.com/Fenestra-Games/DND-QuickPay/wiki/Permissions-and-approvals) | What players may do, GM approval, limits |
| [Ledgers](https://github.com/Fenestra-Games/DND-QuickPay/wiki/Ledgers) | Business and personal ledgers, the viewer |
| [Public containers](https://github.com/Fenestra-Games/DND-QuickPay/wiki/Public-containers) | Letting players pay into a container |
| [Options reference](https://github.com/Fenestra-Games/DND-QuickPay/wiki/Options-reference) | Every setting |
| [Macros and API](https://github.com/Fenestra-Games/DND-QuickPay/wiki/Macros-and-API) | Console, macros, and hooks |
| [Translating](https://github.com/Fenestra-Games/DND-QuickPay/wiki/Translating) | Adding another language |
| [FAQ and troubleshooting](https://github.com/Fenestra-Games/DND-QuickPay/wiki/FAQ-and-troubleshooting) | Common problems |

## How a transfer works, briefly

Players can't edit other actors, so every transfer runs on the GM's client through socketlib. If no GM is online, the player sees "This transaction needs Bank Manager approval." (the text is editable) and nothing is taken. A pending transfer lasts 12 in-world hours by default, and only counts down when the world clock moves.

## Known limitations

> [!IMPORTANT]
> **AMEND:** Review this list before release and update it if anything has changed.

- **Public container flag:** it is stored on the container item. A player who is comfortable in the browser console could set it themselves, even when only the GM is meant to. Treat that option as a guide for honest players.
- **Pending list, log, and options:** they are stored in world settings. They hold no secrets, but a player who reads the console can see them.
- **Log size:** the global transaction log keeps the latest 2000 transfers. Ledgers (journals) keep up to 1000 entries each.
- **Mid-batch failures:** when sending to several recipients, every recipient and the total are checked first. If something unexpected fails part-way, transfers already completed are not rolled back.
- **dnd5e only:** other systems need an adapter.
- **Tested mainly against stand-ins:** the automated tests cover the coin maths and engine thoroughly, and the Foundry wiring against stand-ins. Please report anything odd you find in a real world.

## Reporting problems

Open an issue at https://github.com/Fenestra-Games/DND-QuickPay/issues, or email support@fenestra.gripe. Please include your Foundry version, the module version, and any red console errors.

> [!IMPORTANT]
> **AMEND:** Decide whether you want a support Discord or a Ko-fi/Patreon link here.

## Translating

Every piece of text lives in `lang/en.json`. To add a language, copy that file to `lang/<code>.json` (for example `lang/fr.json`), translate the values and leave the keys alone, then add an entry to `languages` in `module.json`. See the [wiki](https://github.com/Fenestra-Games/DND-QuickPay/wiki/Translating).

## Development

Design notes for maintainers are in [docs/DESIGN.md](docs/DESIGN.md).

```
npm test
```

Runs the manifest checks, translation checks, coin maths, engine (escrow, permissions, expiry, concurrency, and a randomised check that coins are never created or destroyed), the options and form logic, and smoke tests of the Foundry wiring against stand-ins. There are no dependencies.

## Licence

MIT. See [LICENSE](LICENSE).
