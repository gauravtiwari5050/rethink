# Rethink Phone

An AI-first phone, built in the open on a real handset: a OnePlus Nord CE 3 Lite running LineageOS 24.

Everything here is open source (MIT) and meant to be reproduced exactly. Each folder says what it was tested on.
Where something is a concept rather than working code, it says so.

| Folder | What it is | Status |
|---|---|---|
| [`mcp/`](mcp/) | MCP server that runs **on the phone** so Claude (or any MCP client) can see and operate it | Working |
| [`phone/linux/`](phone/linux/) | Debian + SSH + Claude Code **on the phone**: SSH in and run `claude` there | Working |
| [`probe/`](probe/) + [`bridge/`](bridge/) | Call bridge: answers real phone calls with a live voice model, using Android's call-audio APIs | Working; needs a laptop over USB for now |
| [`site/`](site/) | The launch website, plus the Blender script that renders the concept hardware | Concept renders, labelled as such |
| `research/` | Notes from bringing up the device | Notes |

## Third-party services

These are proprietary, so we name them:
- **Claude** (Anthropic) is the client used in our demos. The phone side is plain MCP and works with any MCP client.
- **The live voice model** used by `bridge/` (OpenAI Realtime/GPT-Live). Your own API key goes in the gitignored
  `bridge/.env`.

## License

MIT, see [LICENSE](LICENSE).
