---
title: A phone call orders groceries
date: 2026-11-22
status: Working
summary: I called my Rethink phone from my other phone and asked it for a carton of milk. It shopped on blinkit.com in its own browser, told me each step while I stayed on the line, and ordered only after I said yes.
---

> [!WARNING]
> **Highly experimental. Proceed with caution.** Reproducing this means flashing a new operating system and running
> code as root. One wrong step can brick your phone or erase everything on it. Use a spare phone you can afford to lose.

## What I wanted to try

Can I call my phone and have it run an errand while I listen?

So I called the Rethink phone from my other phone and asked for a carton of milk on Blinkit. The AI assistant picked up. While I stayed on the line, Claude opened blinkit.com in the phone's own browser, found the milk, filled the cart and went to checkout, and the assistant told me what it was doing as it went. When the cart was ready it read it back to me: the item, the total, the delivery time and that I'd pay on delivery. It placed the order only after I said yes.

Everything ran on the phone: answering the call, the voice, Claude and the browser. My laptop only recorded the screen.

<video controls preload="metadata" playsinline poster="/assets/experiments/03/poster.jpg" src="/assets/experiments/03/blinkit-order.mp4" width="720" height="916" style="width:100%;max-width:540px;height:auto;margin-inline:auto"></video>

## What you're watching

The Rethink phone's screen, mirrored to my laptop with [scrcpy](https://github.com/Genymobile/scrcpy), with me on the webcam beside it. I'm calling from my other phone, on speaker.

1. **0:43** The phone answers on its own, and at 0:55 the assistant greets me.
2. **1:04** I ask: "Can you place an order for a carton of milk on Blinkit for me." Chromium comes to the front.
3. **1:13–2:10** Claude works in the browser. It checks the cart is empty, picks my saved address, searches for milk, adds Amul Taaza 1 litre (₹80), opens the cart and checks out with cash. The assistant tells me each step.
4. **2:28** It reads the cart back: ₹80 of milk plus ₹74 in fees, ₹154 total, about 9 minutes, pay on delivery. "Should I place the order?"
5. **2:33** I say yes.
6. **2:35–3:33** Claude checks the total is still ₹154 and cash is still selected, presses Pay Now and waits for the order page. The assistant reads me the order number.
7. **3:45** I ask it to text me when the order arrives. It says it can't, which is true. I ask it to hang up, and it does.

From 0:45 to 4:05 the sound is the call itself, recorded on the phone. Before and after that, it's my laptop's microphone. I owe ₹154 for that milk now, but it worked end to end.

| | |
|---|---|
| Voice | OpenAI GPT-Live (`gpt-live-1`, voice `marin`), with `gpt-6-luna` behind it for tools |
| Shopping | Claude Code v2.1.330, headless, on the phone, using the browser through [Playwright MCP](https://github.com/microsoft/playwright-mcp) 0.0.84 |
| Browser | Chromium 160 (an official snapshot build, pinned by checksum). I logged in to Blinkit once beforehand, by hand |
| Payment | Cash on delivery. No card, UPI or wallet is used, and the code refuses any other payment |
| Takes | My first call, at 18:25, was refused: the phone couldn't read my number, so it wouldn't order (more below). This take, at 18:31, is the first that ordered. I made one more call that evening and ordered peas; it isn't shown |
| Rehearsal | Before calling, I did two dry runs without a call. They stop before ordering, so I could check the flow on the real site. I emptied the cart before this take |
| Edits | Cropped to the phone, with the webcam moved beside it. My delivery address, the list of saved addresses, the last digits of saved cards, and the map and delivery partner after ordering are covered. Where my address is spoken (five times), it's muted with a tone. During the call, the sound is the phone's own call recording, lined up with the video, in place of the microphone. Re-encoded at 30 fps. No cuts, no speed changes |
| Log | [call-log.json](/assets/experiments/03/call-log.json): the transcript with timings, every browser step Claude took, and the tool calls. Address redacted |

## How it works

- **Answering.** A small Java program runs as root on the phone. When a call rings, it saves the caller's number, answers after 2 seconds, and streams the call audio both ways to the call bridge.
- **The call bridge** is a Node.js program in the phone's Debian (set up in [Experiment 02](/experiments/claude-runs-on-the-phone/)). It connects the call to GPT-Live, the voice. The voice has two ordering tools: `blinkit_order` and `blinkit_confirm`.
- **Ordering** starts Claude Code on the phone in headless mode, with a prompt that asks for one short sentence before each step. Each sentence goes to the voice, which says it on the call.
- **Two phases.** `blinkit_order` fills the cart and stops at checkout, returning the items, total, address and payment method. `blinkit_confirm` resumes the same Claude session and places the order. The voice is told to call it only after I say yes.
- **The browser** is ordinary Chromium on the phone's screen. Claude drives it through Chromium's DevTools port, so anyone holding the phone sees every tap.

## What stops it from going wrong

Enforced by code:

- Only calls from my number can order. Anyone else is refused before Claude even starts.
- The order goes through only if the cart came back with pay on delivery and a total of ₹500 or less.
- The ordering Claude has no shell, no files and no other tools. Only the browser.

These are asked of the models, not enforced:

- The voice must wait for a clear yes before confirming.
- Claude must stay on blinkit.com, add only what I asked for, and not place the order if the total changed.

One correction: in this take, Claude Code's built-in file-reading tools were still switched on. I've turned them off since (`--tools ""`). The log shows Claude used only browser tools.

## What went wrong first

- **It didn't know it was me.** My first call was refused: "orders are only available when Gaurav calls from their own number". Android shows the incoming number only while the phone is ringing, and clears it once the call is answered. The bridge was reading it after answering, so it always came back empty. Now the answering program saves it during the ring.
- **Clicks did nothing.** In a dry run, Claude's clicks did nothing until it brought its tab to the front. My "show the browser" step had opened a second tab, and Chromium ignores clicks in a tab that isn't showing. Now it reuses the current tab.
- **Six saved addresses, all called "Home".** Claude stopped instead of guessing. I now set which one to use in the phone's config, outside the code.

## What it can't do yet

- The assistant speaks a beat behind the browser. Once it got ahead of itself: it said "it's being placed" while Claude was still checking the total.
- It can't keep an eye on the order after the call, or text me about it.
- It depends on Blinkit's website as it is today. If they redesign it, it may break until I adjust the prompt.
- I log in to Blinkit once by hand in the browser. The voice and the model run in OpenAI's and Anthropic's clouds.

## Reproduce it

Step by step, from a fresh phone: [Reproduce Experiment 03](/experiments/a-phone-call-orders-groceries/reproduce/). It starts from [Set up your phone](/setup/). The code is in [`bridge/`](https://github.com/gauravtiwari5050/rethink/tree/main/bridge), [`probe/`](https://github.com/gauravtiwari5050/rethink/tree/main/probe) and [`phone/linux/`](https://github.com/gauravtiwari5050/rethink/tree/main/phone/linux).
