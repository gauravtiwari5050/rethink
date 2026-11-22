---
title: A phone call orders groceries
date: 2026-11-22
status: Working
summary: You call the phone and ask for milk. The assistant answers, Claude shops on blinkit.com in the phone's own browser while the assistant tells you each step, and nothing is ordered until you say yes.
---

## What it does

You call the Rethink phone from another phone and ask for groceries. The AI assistant answers. While you stay on the line, Claude opens blinkit.com in the phone's own browser, finds the item, fills the cart and goes to checkout. The assistant tells you what it's doing as it goes. When the cart is ready, it reads it back to you: items, total, delivery time, address and pay on delivery. It places the order only after you say yes.

All of it runs on the phone: answering the call, the voice, Claude, the browser. The laptop only recorded the screen.

<video controls preload="metadata" playsinline poster="/assets/experiments/03/poster.jpg" src="/assets/experiments/03/blinkit-order.mp4" width="720" height="916" style="width:100%;max-width:540px;height:auto;margin-inline:auto"></video>

## What you are watching

The Rethink phone's screen, mirrored to a laptop with [scrcpy](https://github.com/Genymobile/scrcpy), with Gaurav on a webcam beside it. He calls from his other phone.

1. **0:43** The phone answers on its own, and at 0:55 the assistant greets him.
2. **1:04** "Can you place an order for a carton of milk on Blinkit for me." Chromium comes to the front.
3. **1:13–2:10** Claude works in the browser. It checks the cart is empty, picks the saved address, searches for milk, adds Amul Taaza 1 litre (₹80), opens the cart and checks out with cash. The assistant relays each step.
4. **2:28** The assistant reads back the cart: ₹80 of milk plus ₹74 in fees, ₹154 total, about 9 minutes, pay on delivery. "Should I place the order?"
5. **2:33** "Yeah, yeah. Please go ahead and place it."
6. **2:35–3:33** Claude checks the total is still ₹154 and cash is selected, presses Pay Now, and waits for the order page. The assistant reads out the order number.
7. **3:45** Gaurav asks it to text him when the order is delivered. It says it can't, which is true, and hangs up when asked.

The sound is the call itself, recorded on the phone. Gaurav is on the left channel of the original and the assistant on the right; the video mixes both.

| | |
|---|---|
| Voice | OpenAI GPT-Live (`gpt-live-1`, voice `marin`), with `gpt-6-luna` behind it for tools |
| Shopping | Claude Code v2.1.330, headless, on the phone, using the browser through [Playwright MCP](https://github.com/microsoft/playwright-mcp) 0.0.84 |
| Browser | Chromium 160 (an official snapshot build, pinned by checksum), logged in to Blinkit beforehand by hand |
| Payment | Cash on delivery. No card, UPI or wallet is used, and the code refuses any other payment |
| Takes | One earlier call at 18:25 was refused: the phone couldn't read the caller's number, so it wouldn't order (see below). This take, at 18:31, is the first that ordered. A later call that evening ordered peas, and isn't shown |
| Rehearsal | Before the calls, two dry runs without a call, which stop before ordering, to check the flow on the real site. The cart was emptied before this take |
| Edits | Cropped to the phone, with the webcam moved beside it. The delivery address, the list of saved addresses, the last digits of saved cards, and the map and delivery partner after ordering are covered. The address is muted with a tone where it's spoken, five times. The laptop's microphone track is replaced with the phone's call recording, aligned to the video. Re-encoded at 30 fps. No cuts, no speed changes |
| Log | [call-log.json](/assets/experiments/03/call-log.json): the transcript with timings, every browser step Claude took, and the tool calls. Address redacted |

## How it works

- **Answering.** A small Java program runs as root on the phone. When a call rings, it saves the caller's number, answers after 2 seconds, and streams the call audio both ways to the call bridge.
- **The call bridge** is a Node.js program in the phone's Debian (from [Experiment 02](/experiments/claude-runs-on-the-phone/)). It connects the call to GPT-Live, the voice. The voice has two ordering tools: `blinkit_order` and `blinkit_confirm`.
- **Ordering** starts Claude Code on the phone in headless mode, with a prompt that asks for one short sentence before each step. Each sentence goes to the voice, which says it on the call.
- **Two phases.** `blinkit_order` fills the cart and stops at checkout, returning the items, total, address and payment method. `blinkit_confirm` resumes the same Claude session and places the order. The voice is told to call it only after an explicit yes.
- **The browser** is ordinary Chromium on the phone's screen. Claude drives it through Chromium's DevTools port, so the person holding the phone sees every tap.

## Guardrails, and what's enforced where

Enforced by code, not by asking the model:

- Only calls from the owner's number can order. Anyone else is refused before Claude starts.
- The order is placed only if the cart came back with pay on delivery and a total of ₹500 or less.
- The ordering Claude has no shell, no files and no other tools: only the browser.

Asked of the models, not enforced:

- The voice must wait for an explicit yes before confirming.
- Claude must stay on blinkit.com, add only what was asked, and not place the order if the total changed.

One correction: in this take, Claude Code's built-in file-reading tools were still switched on. They're now off (`--tools ""`). The log shows Claude used only browser tools.

## What went wrong first

- **The caller's number.** The first call was refused: "orders are only available when Gaurav calls from their own number". Android only shows the incoming number while the phone is ringing, and clears it once the call is answered. The bridge read it after answering, so it always came back empty. Now the answering program saves it during the ring.
- **Tabs.** In a dry run, clicks did nothing until Claude brought its tab to the front. Our "show the browser" step had opened a second tab, and Chromium ignores clicks in a tab that isn't showing. Now it reuses the current tab.
- **Six saved addresses, all called "Home".** Claude stopped instead of guessing. The owner now sets which one to use, outside the code.

## Limits

- The assistant speaks a beat behind the browser, and once ran ahead of itself ("it's being placed" while Claude was still checking the total).
- It can't watch the order after the call or text you about it.
- It depends on Blinkit's website as it is today. A redesign could break it until the prompt is adjusted.
- Blinkit login is done once by hand in the browser. The voice and the model run in OpenAI's and Anthropic's clouds.
- The repository is private while we prepare it, and will be public soon.
