# Reproduce Experiment 01: Claude operates the phone

> [!WARNING]
> **Highly experimental. Proceed with caution.** Reproducing this means flashing a new operating system and running
> code as root. One wrong step can brick your phone or erase everything on it. Use a spare phone you can afford to lose.

Claude Code on your computer drives the phone through an MCP server that runs on the phone: it reads the screen,
places a call and hangs up. Write-up and video: [Experiment 01](https://rethinkphone.tech/experiments/claude-operates-the-phone/).

## You need

- [Part 1 of the setup](../setup.md#part-1-a-rooted-phone-your-computer-can-reach): a rooted LineageOS phone on USB, the
  Android SDK, and the repository. Part 2 isn't needed.
- A SIM in the phone, for the call.
- [Claude Code](https://code.claude.com/docs/en/overview) on your computer, signed in:
  `curl -fsSL https://claude.ai/install.sh | bash`, then `claude` once to sign in. The take used v2.1.330 with
  Claude Opus 5.5.

## Steps

1. **Start the MCP server on the phone.** With the phone on USB, from the repository folder:

   ```sh
   ./mcp/run.sh
   ```

   It builds the server, pushes it to the phone, forwards port 7071 to your computer and starts it. Leave this terminal
   open: every tool call Claude makes is printed here.

2. **Check it answers**, in a second terminal:

   ```sh
   curl -s http://127.0.0.1:7071/mcp -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"device_status","arguments":{}}}'
   ```

   You should get the battery level, network and foreground app as JSON.

3. **Start Claude Code** in the same second terminal, from the repository folder:

   ```sh
   claude
   ```

   The repository's `.mcp.json` points Claude Code at the phone. Approve the **rethink-phone** server when asked.
   Type `/mcp` to check it shows as connected with 13 tools.

4. **Ask it to do things on the phone.** These are the prompts from the video:

   - `Can you tell me what is on my phones screen right now ?`
   - `can you call <a number or a contact's name>`
   - `please end the call`

   Claude Code asks before each tool call. Approve them, or press Shift+Tab to switch to auto mode, as in the video.

5. **Optional: send a text.** `Send a text to <name> saying hello`. Claude opens Messages with the text filled in,
   reads the screen, and taps Send itself. Nothing is sent without that visible tap.

6. **Read the audit log**, the phone's own record of every tool call:

   ```sh
   $ADB shell cat /data/local/tmp/rethink/mcp-audit.jsonl
   ```

Press Ctrl-C in the first terminal to stop the server.

## If something's off

- **`/mcp` shows rethink-phone as failed:** `mcp/run.sh` isn't running, or the phone was unplugged. Start it again.
- **The phone has been through `phone/linux/start.sh`:** the server is already running on the phone. `mcp/run.sh`
  restarts it in the foreground, which is fine.
- **Typing goes wrong:** `type_text` handles ASCII only.
- **Each screen read takes 2–3 seconds:** that's `uiautomator dump`. Expected.

## Code

[`mcp/`](../../mcp/): two Java files, built with `javac` and `d8`, run as root with `app_process`.
