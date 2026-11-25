# Rethink Phone

An AI-first phone, built in the open on a real handset: a OnePlus Nord CE 3 Lite running LineageOS 24.

Everything here is open source (MIT) and meant to be reproduced exactly. Each folder says what it was tested on.
Where something is a concept rather than working code, it says so.

> [!WARNING]
> **Highly experimental. Proceed with caution.** This means unlocking the bootloader, flashing a new operating
> system and running code as root. One wrong step can brick your phone or erase everything on it, and there is no
> warranty or support. Use a spare phone you can afford to lose, and follow each step exactly.

| Folder | What it is | Status |
|---|---|---|
| [`mcp/`](mcp/) | MCP server that runs **on the phone** so Claude (or any MCP client) can see and operate it | Working |
| [`phone/linux/`](phone/linux/) | Debian + SSH + Claude Code **on the phone**: SSH in and run `claude` there | Working |
| [`probe/`](probe/) + [`bridge/`](bridge/) | Call bridge: answers real phone calls with a live voice model, using Android's call-audio APIs. Runs on the phone, in the Debian from `phone/linux/`. Can order groceries on Blinkit during a call | Working; started over USB after each reboot |
| [`docs/`](docs/) | Setup and step-by-step reproduction guides | Tested on the phone above |
| [`site/`](site/) | [rethinkphone.tech](https://rethinkphone.tech): the website, the experiment write-ups, and the Blender script that renders the concept hardware | Live; concept renders labelled as such |
| `research/` | Notes from bringing up the device | Notes |

## Experiments

Each feature is tried on the real phone and written up with a video and a log at
[rethinkphone.tech/experiments](https://rethinkphone.tech/experiments/). The write-ups are in
[`site/experiments/`](site/experiments/).

## Reproduce them

Start with [Set up your phone](docs/setup.md), then follow the guide for each experiment:

1. [Claude operates the phone](docs/reproduce/01-claude-operates-the-phone.md)
2. [Claude runs on the phone, with root](docs/reproduce/02-claude-runs-on-the-phone.md)
3. [A phone call orders groceries](docs/reproduce/03-a-phone-call-orders-groceries.md)

The same guides are on the site, at [rethinkphone.tech/setup](https://rethinkphone.tech/setup/).

## Third-party services

These are proprietary, so we name them:
- **Claude** (Anthropic) is the client used in our demos. The phone side is plain MCP and works with any MCP client.
- **The live voice model** used by `bridge/` (OpenAI Realtime/GPT-Live). Your own API key goes in the gitignored
  `bridge/.env`.
- **Blinkit**, for the grocery-ordering experiment. You log in to blinkit.com once, by hand, in Chromium on the phone.

## License

MIT, see [LICENSE](LICENSE).
