// Orders groceries on blinkit.com in the phone's own browser, by running Claude Code headless on the phone.
//
// Two phases, so nothing is bought without a spoken "yes" on the call:
//   prepare(request)  Claude finds the items, fills the cart, opens checkout and stops. Returns the cart summary.
//   confirm()         Only after the caller says yes: resumes the same Claude session, which places the order.
//
// Guardrails enforced here, not just requested of Claude:
//   - Claude's only tools are the browser's (Playwright MCP over Chromium's DevTools). No shell, no files, no phone.
//   - confirm() refuses unless prepare() returned a ready cart with Pay on delivery and a total <= MAX_ORDER_RUPEES.
//   - The confirm phase is told the confirmed total and must not place the order if it changed; a placed order
//     whose reported total differs is flagged.
// Every step Claude takes is streamed to onProgress and saved with the call log.

import { spawn, execFile } from 'node:child_process';
import path from 'node:path';

const CLAUDE = process.env.CLAUDE_BIN || path.join(process.env.HOME || '/home/rethink', '.local/bin/claude');
const MCP_CONFIG = process.env.BROWSER_MCP_CONFIG || '/opt/rethink/browser/mcp.json';
const WORKDIR = process.env.BLINKIT_WORKDIR || '/opt/rethink/blinkit';
export const MAX_ORDER_RUPEES = Number(process.env.MAX_ORDER_RUPEES || 500);
const TIMEOUT_MS = 4 * 60 * 1000;
// Which saved address to deliver to, when the account has several (set on the phone, in bridge/.env; never committed)
const ADDRESS = (process.env.DELIVERY_ADDRESS || '').trim();

const RULES = `You are ordering groceries on blinkit.com for the phone's owner, in the Chromium browser on this phone.
A person is on a phone call listening to your progress, so:
- Before each step, write ONE short plain sentence saying what you are doing, e.g. "Searching Blinkit for milk."
  or "Adding Amul Taaza 1 litre to the cart, 68 rupees." No markdown. These sentences are read out on the call.
- Use only the browser tools. Stay on blinkit.com. The owner is already logged in.
- Work in the one tab that is in front. If there are other tabs, close them first.
- Deliver to ${ADDRESS ? `the saved address that matches: "${ADDRESS}". If none matches, stop and report it` : 'the saved Home address'}.
- Read the page with snapshots; don't guess. If a pop-up asks to download the app, choose to continue on web.
- Payment must be "Pay on delivery" / cash. Never enter card, UPI or wallet details.
- The cart must end up with exactly what the caller asked for: if it already has items, remove the others and fix
  the quantities.
- Never add things the caller didn't ask for. If an item is unavailable or ambiguous, pick the closest common option
  and say so, or stop and report it.`;

const PREPARE = (request) => `${RULES}

The caller asked: "${request}"

Do this: open blinkit.com (bring the existing tab to it), search for each item, add the right quantity to the cart,
open the cart and proceed to checkout until you can see the bill total, the delivery address and the payment options.
Select Pay on delivery if it is offered. STOP before the final "Place order" / "Pay" step. Do not place the order.

Finish with one line of JSON and nothing after it:
{"status":"ready","items":[{"name":"...","quantity":1,"price":68}],"item_total":68,"fees":16,"total":84,"eta":"12 minutes","address":"Villa 1, Some Road, City","payment":"Pay on delivery"}
or {"status":"failed","reason":"..."} if you could not get there (also if Pay on delivery isn't offered).`;

const CONFIRM = (cart) => `${RULES}

The caller has said yes on the call. Place the order now: on the checkout page, make sure Pay on delivery is selected,
check the total is still ${cart.total} rupees, then press the button that places the order ONCE. If nothing seems to
happen, wait and take a snapshot; never press it a second time, which could place a second order. If the total changed,
or Pay on delivery is not selected, do NOT place it; report that instead.

Finish with one line of JSON and nothing after it:
{"status":"placed","order_id":"...","total":${cart.total},"eta":"..."}  or  {"status":"failed","reason":"..."}`;

const TOOLS = [
  'browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_click', 'browser_type',
  'browser_press_key', 'browser_select_option', 'browser_wait_for', 'browser_tabs', 'browser_hover',
  'browser_handle_dialog', 'browser_fill_form', 'browser_take_screenshot', 'browser_find',
].map((t) => `mcp__browser__${t}`);

function runClaude(prompt, { resume, onProgress, onEvent }) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
      // No built-in tools at all (no shell, files or web fetch); only the browser MCP server, and of its tools only
      // TOOLS: anything else is refused without asking (dontAsk).
      '--tools', '', '--mcp-config', MCP_CONFIG, '--strict-mcp-config',
      '--allowedTools', TOOLS.join(','), '--permission-mode', 'dontAsk'];
    if (resume) args.push('--resume', resume);
    const child = spawn(CLAUDE, args, { cwd: WORKDIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let sessionId = resume;
    let finalText = '';
    // A text block is spoken only once Claude goes on to use a tool: the last one is its closing summary, which the
    // bridge reads out itself from the JSON result.
    let unsaid = null;
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        onEvent?.(ev);
        if (ev.session_id) sessionId = ev.session_id;
        if (ev.type === 'assistant') {
          for (const c of ev.message?.content || []) {
            if (c.type === 'text' && c.text.trim()) {
              const text = c.text.trim();
              finalText = text;
              unsaid = text.split('\n').filter((l) => !l.trim().startsWith('{')).join(' ').trim() || null;
            } else if (c.type === 'tool_use') {
              if (unsaid) onProgress?.(unsaid);
              unsaid = null;
              onProgress?.(null, { tool: c.name.replace('mcp__browser__', ''), input: c.input });
            }
          }
        } else if (ev.type === 'result') {
          if (ev.result) finalText = ev.result;
        }
      }
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      const m = finalText.match(/\{[^\n]*\}\s*$/);
      let out = null;
      try { out = m && JSON.parse(m[0]); } catch {}
      if (!out) out = { status: 'failed', reason: code ? `claude exited ${code}: ${err.slice(-300)}` : 'no result reported' };
      resolve({ sessionId, out });
    });
  });
}

// Brings Chromium (its current tab) to the front, so the person watching sees the work. Opening a URL here would
// start a second tab, and Chromium ignores clicks in a tab that is in the background.
export function showBrowser() {
  return new Promise((r) => execFile('sudo', ['android',
    'am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n org.chromium.chrome/com.google.android.apps.chrome.Main'],
    () => r()));
}

export class BlinkitOrder {
  constructor({ onProgress, onEvent }) {
    this.onProgress = onProgress;
    this.onEvent = onEvent;
    this.cart = null;
    this.sessionId = null;
    this.busy = false;
  }

  async prepare(request) {
    if (this.busy) return { status: 'failed', reason: 'already working on an order' };
    this.busy = true;
    try {
      await showBrowser();
      const { sessionId, out } = await runClaude(PREPARE(request), this);
      this.sessionId = sessionId;
      if (out.status === 'ready') {
        const total = Number(out.total);
        if (!(total > 0)) return { status: 'failed', reason: 'could not read the cart total' };
        if (total > MAX_ORDER_RUPEES) return { status: 'failed', reason: `total ${total} is over the ${MAX_ORDER_RUPEES} rupee limit` };
        if (!/deliver|cash/i.test(out.payment || '')) return { status: 'failed', reason: 'Pay on delivery is not selected' };
        this.cart = { ...out, total };
      }
      return out;
    } finally {
      this.busy = false;
    }
  }

  async confirm() {
    if (!this.cart || !this.sessionId) return { status: 'failed', reason: 'there is no prepared cart to confirm' };
    if (this.busy) return { status: 'failed', reason: 'still working' };
    this.busy = true;
    try {
      const { out } = await runClaude(CONFIRM(this.cart), { ...this, resume: this.sessionId });
      if (out.status === 'placed' && Number(out.total) !== this.cart.total) {
        out.warning = `the order was placed, but its total (${out.total}) differs from the confirmed ${this.cart.total}`;
      }
      this.cart = null;
      return out;
    } finally {
      this.busy = false;
    }
  }
}
