# Reproduce Experiment 03: a phone call orders groceries

> [!WARNING]
> **Highly experimental. Proceed with caution.** Reproducing this means flashing a new operating system and running
> code as root. One wrong step can brick your phone or erase everything on it. Use a spare phone you can afford to lose.

You call the phone from another phone and ask for groceries. An AI voice answers; Claude shops on blinkit.com in the
phone's own browser and tells you each step; the order is placed, cash on delivery, only after you say yes.
Everything runs on the phone. Write-up and video:
[Experiment 03](https://rethinkphone.tech/experiments/a-phone-call-orders-groceries/).

**This places a real order.** You pay for it on delivery.

## You need

- [The setup, Parts 1 and 2](../setup.md): Debian and Claude Code on the phone, Claude signed in.
- A SIM with voice calls in the phone (the take used Airtel VoLTE), and a second phone to call it from.
- A [Blinkit](https://blinkit.com) account with a saved delivery address. Blinkit delivers only in Indian cities.
- An [OpenAI API key](https://platform.openai.com/api-keys) with access to GPT-Live (`gpt-live-1`). Calls cost about
  $0.05 a minute at November 2026 prices.

## Steps

1. **Check the phone can hear and speak into calls.** With the phone on USB:

   ```sh
   ./probe/run-probe.sh check
   ```

   You want `isPstnCallAudioInterceptable=true`. If it says `false`, this phone's audio setup doesn't expose call
   audio, and the rest won't work.

2. **Install Chromium on the phone:**

   ```sh
   ./phone/linux/browser.sh
   ```

   It downloads an official Chromium 160 build (441 MB, checksum-verified) and installs it. Claude drives it through
   its DevTools port, so you see every tap on the phone's screen.

3. **Log in to Blinkit in that browser.** On the phone, open **Chromium**, go to `blinkit.com`, log in with your
   phone number and the OTP, and check your delivery address is saved. Empty the cart.

4. **Write the bridge settings.** On your computer:

   ```sh
   cp bridge/.env.example bridge/.env
   ```

   Then edit `bridge/.env`:

   | Setting | Value |
   |---|---|
   | `OPENAI_API_KEY` | Your key |
   | `OWNER_NAME` | Your name. The voice says it answers for you |
   | `ORDER_ALLOWED_CALLERS` | The number you'll call from. Calls from any other number can't order |
   | `DELIVERY_ADDRESS` | Text that appears in only one of your saved Blinkit addresses, e.g. its first line |
   | `MAX_ORDER_RUPEES` | The most an order may cost. Default 500 |

   `bridge/.env` is gitignored. Keep it that way: it holds your key.

5. **Start everything:**

   ```sh
   ./phone/linux/start.sh
   ```

   The first time, it copies `bridge/.env` to the phone. Check the last lines show:

   ```
   call bridge: 127.0.0.1:7070
   call answering: on (answers after 2 s)
   ```

   You can unplug USB now. Nothing runs on your computer.

6. **Call the phone** from the number in `ORDER_ALLOWED_CALLERS`. It answers after two seconds and the voice
   greets you. Ask:

   ```
   Can you place an order for a carton of milk on Blinkit for me?
   ```

   Chromium comes to the front on the phone. While Claude works, the voice tells you each step: checking the cart,
   picking the address, searching, adding, checking out with cash. In the take this took about a minute.

7. **Listen to the read-back and answer.** The voice reads the items, total, delivery time, address and payment
   method, and asks whether to place the order. Say **yes** to order, or **no** to stop. On yes, Claude checks the
   total hasn't changed, presses the order button once, and the voice reads you the order number.

8. **Hang up**, or ask it to. A notification on the phone summarises the call.

## Logs and recordings

SSH in (`ssh -i ~/.ssh/rethink_phone -p 2222 rethink@<phone's Wi-Fi address>`), then:

- `tail -f /opt/rethink/bridge/bridge.log`: the conversation, tool calls and each browser step, live.
- `/opt/rethink/bridge/calls/`: per call, a JSON log and WAV recordings. `…-call.wav` is stereo, caller on the left,
  assistant on the right.
- `/var/log/android-commands.log`: every root command, including the notifications.

## Changing settings later

`start.sh` copies `bridge/.env` only when the phone has none. After editing it on your computer, push it again and
restart:

```sh
$ADB push bridge/.env /data/local/rethink/debian/opt/rethink/bridge/.env
./phone/linux/start.sh
```

## If something's off

- **The voice says orders are only available from the owner's number:** the number you called from isn't in
  `ORDER_ALLOWED_CALLERS`, or the phone couldn't read caller ID. Check the number, and that your carrier shows it.
- **`call bridge: NOT running`:** `bridge/.env` is missing on the phone, or has no `OPENAI_API_KEY`. See *Changing
  settings later*.
- **The phone doesn't answer:** services stop on reboot. Run `./phone/linux/start.sh` again.
- **Claude stops and reports several matching addresses:** make `DELIVERY_ADDRESS` more specific.
- **Clicks do nothing in the browser:** close Chromium's other tabs so only one is open.
- **Blinkit asks you to log in again:** log in once more in Chromium on the phone.

## What's enforced, and what's asked

Enforced in code: only `ORDER_ALLOWED_CALLERS` can order; the order is placed only if the cart came back with pay on
delivery and a total within `MAX_ORDER_RUPEES`; the ordering Claude has only browser tools (no shell, no files).
Asked of the models: wait for a clear yes, stay on blinkit.com, add only what was asked for.

## Code

[`bridge/`](../../bridge/) (`server.js`, the call bridge; `blinkit.js`, ordering), [`probe/`](../../probe/)
(`CallBridge.java`, answering and call audio), [`phone/linux/`](../../phone/linux/) (`browser.sh`, `boot.sh`).
