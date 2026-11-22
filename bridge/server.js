// Rethink call bridge, running on the phone (in its Debian, see phone/linux/): call audio <-> OpenAI GPT-Live.
//
//   node server.js            # listens on 127.0.0.1:7070
//
// The phone-side CallBridge (probe/) auto-answers incoming calls and connects here over the phone's localhost
// (raw 16 kHz mono s16le both ways). Closing the socket from this side hangs the call up.
//
// Brain: GPT-Live with Responses delegation. OpenAI runs the backend model (with hosted web search); our own
// function tools (end_call, take_message, blinkit_order, blinkit_confirm) are executed here.
// Phone commands go through `sudo android` (phone/linux/provision.sh).

import 'dotenv/config';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import WebSocket from 'ws';
import { BlinkitOrder, MAX_ORDER_RUPEES } from './blinkit.js';

const env = (k, d) => (process.env[k] ?? '').trim() || d;
const PORT = Number(env('BRIDGE_PORT', 7070));
const OPENAI_API_KEY = env('OPENAI_API_KEY');
const OWNER = env('OWNER_NAME', 'the owner');
const OWNER_CONTEXT = env('OWNER_CONTEXT', '');
const VOICE = env('LIVE_VOICE', 'marin');
const MODEL = env('LIVE_MODEL', 'gpt-live-1');
const BACKEND_MODEL = env('BACKEND_MODEL', 'gpt-6-luna');
// Numbers allowed to order groceries (comma-separated, digits only compared). Empty: nobody can order.
const ORDER_CALLERS = env('ORDER_ALLOWED_CALLERS', '').split(',').map((n) => n.replace(/\D/g, '').slice(-10)).filter(Boolean);
const RATE = 16000;
const BYTES_PER_MS = (RATE * 2) / 1000; // 32
const FRAME = 20 * BYTES_PER_MS; // 640 bytes = 20 ms
const LEAD_MS = 120; // how far ahead of real time we push audio to the phone
const HANGUP_IDLE_MS = 1200; // after end_call, hang up once the agent has been quiet this long
const HANGUP_MAX_MS = 15000;

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in bridge/.env');
  process.exit(1);
}

const INSTRUCTIONS = `You are the AI phone assistant for ${OWNER}, answering a phone call on their behalf because they are unavailable.
- You are an AI assistant; say so if asked. Never pretend to be ${OWNER}.
- Be warm, brief and natural, like a good human receptionist. One or two sentences at a time.
- Find out who is calling and why. Offer to take a message.
- Callers may speak English, Hindi or Hinglish; reply in the language they use.
- You can only do things through your backend: looking things up, saving a message for ${OWNER}, ordering groceries
  from Blinkit (only when the caller is ${OWNER}), and ending the call.
  Hand those off and wait for the result. Never claim you did something (saved a message, ended the call, looked something up) unless the backend confirmed it.
- While the backend is working, tell the caller briefly ("One moment, let me check.") — don't go silent.
- Grocery orders: while the order is being prepared you'll receive short progress notes about what the browser is
  doing. Relay them briefly and naturally, so the caller can follow along. When the cart is ready, read back the
  items, the total in rupees, the delivery time, the address and that it's pay on delivery, and ask clearly whether
  to place the order. Only an explicit yes counts. Never say an order was placed unless the backend confirmed it.
- To end the call (caller says bye / asks you to hang up / conversation is clearly over), hand off "end the call", then say a short goodbye.`;

const BACKEND_INSTRUCTIONS = `You are the backend for a phone receptionist answering calls for ${OWNER}.
${OWNER_CONTEXT ? `About ${OWNER}: ${OWNER_CONTEXT}\n` : ''}Today is ${new Date().toDateString()}.
- Your output is spoken on a phone call: answer in one or two short, plain sentences. No markdown, lists or URLs.
- Use web_search for current facts (weather, news, opening hours, etc.).
- When the caller leaves a message for ${OWNER}, call take_message with everything they said (name, callback number if given, the message, urgency).
- When the caller wants to end the call or the conversation is over, call end_call.
- Never share private details about ${OWNER} (location, schedule, contacts).
- Groceries: when the caller asks to order something, call blinkit_order with exactly what they asked for. It starts
  the work and returns at once; progress and the cart summary arrive separately. When the caller explicitly says yes
  to the cart that was read back to them, call blinkit_confirm. If they say no or want changes, don't call it.`;

const TOOLS = [
  { type: 'web_search' },
  {
    type: 'function',
    name: 'take_message',
    description: `Save a message for ${OWNER}. ${OWNER} gets it as a notification right after the call.`,
    parameters: {
      type: 'object',
      properties: {
        caller_name: { type: 'string', description: 'Who is calling, if known' },
        callback_number: { type: 'string', description: 'Number to call back, if given' },
        message: { type: 'string', description: 'The message, in the caller’s words, concise' },
        urgency: { type: 'string', enum: ['low', 'normal', 'urgent'] },
      },
      required: ['message'],
    },
  },
  {
    type: 'function',
    name: 'blinkit_order',
    description: `Start ordering groceries on Blinkit for ${OWNER} (pay on delivery, max ${MAX_ORDER_RUPEES} rupees). Only works when the caller is ${OWNER}. Fills the cart and stops at checkout; nothing is bought until blinkit_confirm.`,
    parameters: {
      type: 'object',
      properties: { request: { type: 'string', description: 'What to order, in the caller’s words, e.g. "one litre of milk"' } },
      required: ['request'],
    },
  },
  {
    type: 'function',
    name: 'blinkit_confirm',
    description: 'Place the prepared Blinkit order. Call only after the caller explicitly said yes to the cart summary.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'end_call',
    description: 'Hang up the phone call. The line is closed a moment after the agent finishes its goodbye.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why the call is ending' } },
    },
  },
];

const GREETING = `Greet the caller: "Hi, you've reached ${OWNER}'s phone. I'm their AI assistant — they can't take the call right now. Who's calling?"`;

const CALLS_DIR = path.join(import.meta.dirname, 'calls');
fs.mkdirSync(CALLS_DIR, { recursive: true });

const ts = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
let eventSeq = 0;
const eid = (p) => `${p}_${Date.now()}_${eventSeq++}`;

net
  .createServer((sock) => handleCall(sock))
  .listen(PORT, '127.0.0.1', () =>
    console.log(`[${ts()}] bridge listening on 127.0.0.1:${PORT} — live=${MODEL} backend=${BACKEND_MODEL} voice=${VOICE}`),
  );

function handleCall(sock) {
  sock.setNoDelay(true);
  const callId = new Date().toISOString().replace(/[:.]/g, '-');
  const log = { callId, startedAt: new Date().toISOString(), transcript: [], messages: [], tools: [], order: [] };
  // Who is calling: only the allowed numbers can order. Read from Android at the start of the call.
  const caller = { number: null };
  callerNumber().then((n) => {
    caller.number = n;
    log.callerAllowedToOrder = !!n && ORDER_CALLERS.includes(n);
    console.log(`[${ts()}] caller ${n ? '…' + n.slice(-4) : 'unknown'}; may order: ${log.callerAllowedToOrder}`);
  });
  // Progress from the ordering agent, relayed to the voice model to say. At most one note every few seconds.
  let lastSaid = 0;
  let pendingNote = null;
  const say = (content, force) => {
    const now = Date.now();
    if (!force && now - lastSaid < 3500) { pendingNote = content; return; }
    lastSaid = now;
    pendingNote = null;
    send({ type: 'session.commentary.append', event_id: eid('note'), delegation_id: null, content });
  };
  const noteTimer = setInterval(() => pendingNote && say(pendingNote), 1000);
  const order = new BlinkitOrder({
    onProgress: (text, tool) => {
      log.order.push({ atMs: Date.now() - t0, ...(text ? { text } : { tool }) });
      if (text) {
        console.log(`[${ts()}] 🛒 ${text}`);
        say(`Progress on the Blinkit order (tell the caller briefly, in your own words): ${text}`);
      } else console.log(`[${ts()}]    · ${tool.tool} ${JSON.stringify(tool.input).slice(0, 120)}`);
    },
  });
  const callerPcm = [];
  const agentPcm = [];
  const t0 = Date.now();
  console.log(`\n[${ts()}] ☎️  call connected (${callId})`);

  // ---- outbound (agent -> phone) pacing queue
  let queue = [];
  let queued = 0;
  let playhead = 0;
  let hangup = null; // { requestedAt }
  let lastAgentSpeechAt = 0;
  const pacer = setInterval(() => {
    const now = Date.now();
    if (playhead < now) playhead = now;
    while (queued >= FRAME && playhead - now < LEAD_MS) {
      if (!sock.destroyed) sock.write(take(FRAME));
      playhead += 20;
    }
    if (hangup) {
      // Wait for the backend turn that ran end_call to complete, then for the agent to speak (its goodbye)
      // and fall quiet. Hard cap in case the goodbye never comes.
      const since = now - hangup.requestedAt;
      const spokeAfter = hangup.completedAt && lastAgentSpeechAt > hangup.completedAt;
      const quiet = now - lastAgentSpeechAt;
      const noGoodbye = hangup.completedAt && now - hangup.completedAt > 6000;
      if ((spokeAfter && quiet > HANGUP_IDLE_MS) || noGoodbye || since > HANGUP_MAX_MS) {
        console.log(`[${ts()}] 📴 hanging up (agent requested end_call)`);
        hangup = null;
        finish('agent');
        sock.end();
      }
    }
  }, 10);
  function take(n) {
    const out = Buffer.alloc(n);
    let off = 0;
    while (off < n) {
      const head = queue[0];
      const k = Math.min(head.length, n - off);
      head.copy(out, off, 0, k);
      off += k;
      if (k === head.length) queue.shift();
      else queue[0] = head.subarray(k);
    }
    queued -= n;
    return out;
  }

  // ---- GPT-Live session
  const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });
  let started = false;
  let pending = Buffer.alloc(0);
  const send = (obj) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));
  const lines = { caller: '', agent: '' };
  const flushLine = (who) => {
    const text = lines[who].replace(/\s+/g, ' ').trim();
    if (text) {
      log.transcript.push({ who, text, atMs: Date.now() - t0 });
      console.log(`[${ts()}] ${who === 'caller' ? '👤 caller' : '🤖 agent '}: ${text}`);
    }
    lines[who] = '';
  };
  // Flush a speaker's line once they've been quiet for a moment (keeps transcript lines whole).
  const lastDelta = { caller: 0, agent: 0 };
  const lineTimer = setInterval(() => {
    for (const who of ['caller', 'agent']) if (lines[who] && Date.now() - lastDelta[who] > 900) flushLine(who);
  }, 200);

  ws.on('open', () => {
    send({
      type: 'session.start',
      event_id: eid('start'),
      session: {
        model: MODEL,
        instructions: INSTRUCTIONS,
        audio: { format: { type: 'audio/pcm', rate: RATE }, output: { voice: VOICE } },
        delegation: {
          type: 'responses',
          responses: {
            model: BACKEND_MODEL,
            instructions: BACKEND_INSTRUCTIONS,
            tools: TOOLS,
            tool_choice: 'auto',
            parallel_tool_calls: false,
          },
        },
      },
    });
  });

  // Ordering runs for a minute or two, so these tools return at once and the outcome is spoken via commentary.
  function startOrderTool(name, args) {
    if (!log.callerAllowedToOrder) {
      return { status: 'refused', note: `Ordering is only available when ${OWNER} calls from their own number. Tell the caller you can't order for them.` };
    }
    if (order.busy) return { status: 'busy', note: 'Still working on the order; progress updates will follow.' };
    if (name === 'blinkit_order') {
      order.prepare(args.request).then((r) => {
        log.order.push({ atMs: Date.now() - t0, prepared: r });
        console.log(`[${ts()}] 🛒 prepared: ${JSON.stringify(r)}`);
        if (r.status === 'ready') {
          const items = r.items.map((i) => `${i.quantity} × ${i.name} (${i.price} rupees)`).join(', ');
          say(`The Blinkit cart is ready but NOT ordered yet: ${items}. Item total ${r.item_total} rupees, fees ${r.fees} rupees, total ${r.total} rupees. Delivery to ${r.address} in about ${r.eta}. Payment: ${r.payment}. Read this back briefly and ask the caller whether to place the order.`, true);
        } else {
          say(`The Blinkit order could not be prepared: ${r.reason}. Tell the caller briefly.`, true);
        }
      });
      return { status: 'started', note: 'Working on it in the phone’s browser. Tell the caller you’re on it; progress updates and the cart summary will follow. Nothing is ordered yet.' };
    }
    if (!order.cart) return { status: 'error', note: 'There is no prepared cart to confirm yet.' };
    order.confirm().then((r) => {
      log.order.push({ atMs: Date.now() - t0, confirmed: r });
      console.log(`[${ts()}] 🛒 confirm: ${JSON.stringify(r)}`);
      if (r.status === 'placed') {
        say(`The Blinkit order is placed. ${r.order_id ? 'Order ' + r.order_id + '. ' : ''}Total ${r.total} rupees, pay on delivery, arriving in about ${r.eta}.${r.warning ? ' Note: ' + r.warning + '.' : ''} Tell the caller.`, true);
        notifyPhone('🛒 Blinkit order placed', `${r.order_id || ''} · ${r.total} rupees, pay on delivery · ${r.eta}`, `order-${callId}`);
      } else {
        say(`The Blinkit order was NOT placed: ${r.reason}. Tell the caller.`, true);
      }
    });
    return { status: 'placing', note: 'Placing the order now. Tell the caller; the confirmation will follow. It is not placed yet.' };
  }

  function runTool(delegationId, item) {
    let args = {};
    try {
      args = JSON.parse(item.arguments || '{}');
    } catch {}
    log.tools.push({ name: item.name, args, atMs: Date.now() - t0 });
    console.log(`[${ts()}] 🔧 ${item.name}(${JSON.stringify(args)})`);
    let output;
    if (item.name === 'take_message') {
      log.messages.push(args);
      output = { status: 'saved', note: `${OWNER} will get this as a notification right after the call.` };
    } else if (item.name === 'blinkit_order' || item.name === 'blinkit_confirm') {
      output = startOrderTool(item.name, args);
    } else if (item.name === 'end_call') {
      hangup = { requestedAt: Date.now() };
      output = { status: 'ok', note: 'The line will close right after your goodbye. Say a brief goodbye now.' };
    } else {
      output = { status: 'error', error: `unknown tool ${item.name}` };
    }
    send({
      type: 'response.item.create',
      event_id: eid('tool'),
      item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(output) },
    });
    send({ type: 'response.create', event_id: eid('cont') });
  }

  ws.on('message', (raw) => {
    let ev;
    try {
      ev = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (ev.type) {
      case 'session.started':
        started = true;
        console.log(`[${ts()}] live session started (${ev.session?.id ?? '?'})`);
        send({ type: 'session.commentary.append', event_id: eid('greet'), delegation_id: null, content: GREETING });
        break;
      case 'session.output_audio.delta': {
        const buf = Buffer.from(ev.delta, 'base64');
        queue.push(buf);
        queued += buf.length;
        agentPcm.push(buf);
        break;
      }
      case 'session.input_transcript.delta':
        lines.caller += ev.delta;
        lastDelta.caller = Date.now();
        break;
      case 'session.output_transcript.delta':
        lines.agent += ev.delta;
        lastDelta.agent = lastAgentSpeechAt = Date.now();
        break;
      case 'session.delegation.created':
        console.log(`[${ts()}] ↪️  handed off to backend (${ev.delegation?.id})`);
        break;
      case 'response.event': {
        const e = ev.event || {};
        if (e.type === 'response.completed' && hangup && !hangup.completedAt) hangup.completedAt = Date.now();
        if (e.type === 'response.output_item.done' && e.item?.type === 'function_call') {
          runTool(ev.delegation_id, e.item);
        } else if (e.type === 'response.output_item.done' && e.item?.type === 'web_search_call') {
          console.log(`[${ts()}] 🔎 web search: ${JSON.stringify(e.item.action?.query ?? e.item.action ?? '')}`);
        } else if (e.type === 'response.output_item.done' && e.item?.type === 'message') {
          const text = (e.item.content || []).map((c) => c.text || '').join(' ').trim();
          if (text) console.log(`[${ts()}] 🧠 backend: ${text}`);
        } else if (e.type === 'response.failed' || e.type === 'error') {
          console.log(`[${ts()}] ⚠️  backend: ${JSON.stringify(e.response?.error ?? e.error ?? e)}`);
        } else if (process.env.DEBUG) {
          console.log(`[${ts()}]    · ${e.type}`);
        }
        break;
      }
      case 'error':
        console.log(`[${ts()}] ⚠️  error: ${JSON.stringify(ev.error ?? ev)}`);
        break;
      case 'session.closed':
        log.usage = ev.usage;
        console.log(`[${ts()}] live session closed; usage=${JSON.stringify(ev.usage)}`);
        break;
      default:
        if (process.env.DEBUG && !/appended|usage\.updated/.test(ev.type)) console.log(`[${ts()}] ${ev.type}`);
    }
  });

  ws.on('close', (code) => {
    if (process.env.DEBUG) console.log(`[${ts()}] live websocket closed (${code})`);
    if (!sock.destroyed) sock.end();
  });
  ws.on('error', (e) => console.log(`[${ts()}] websocket error: ${e.message}`));

  // ---- inbound (phone -> agent)
  sock.on('data', (chunk) => {
    callerPcm.push(chunk);
    if (!started) return; // drop audio until session is ready
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const usable = pending.length - (pending.length % FRAME);
    if (usable <= 0) return;
    send({ type: 'session.input_audio.append', audio: pending.subarray(0, usable).toString('base64') });
    pending = pending.subarray(usable);
  });

  function finish(endedBy) {
    if (log.endedAt) return;
    log.endedAt = new Date().toISOString();
    log.endedBy = endedBy;
    clearInterval(pacer);
    clearInterval(lineTimer);
    clearInterval(noteTimer);
    flushLine('caller');
    flushLine('agent');
    if (ws.readyState === WebSocket.OPEN) {
      send({ type: 'session.close', event_id: eid('close') });
      setTimeout(() => ws.readyState === WebSocket.OPEN && ws.close(), 15000);
    }
    const base = path.join(CALLS_DIR, callId);
    fs.writeFileSync(`${base}.json`, JSON.stringify(log, null, 2));
    writeWav(`${base}-caller.wav`, Buffer.concat(callerPcm));
    writeWav(`${base}-agent.wav`, Buffer.concat(agentPcm));
    console.log(`[${ts()}] 📴 call ended by ${endedBy} after ${Math.round((Date.now() - t0) / 1000)} s — saved calls/${callId}.json`);
    summarizeAndNotify(log).catch((e) => console.log(`[${ts()}] summary failed: ${e.message}`));
  }
  sock.on('close', () => finish(log.endedBy || 'caller'));
  sock.on('error', (e) => {
    console.log(`[${ts()}] phone socket error: ${e.message}`);
    finish('error');
  });
}

// ---- post-call: summarize with the backend model, push a notification to the phone
async function summarizeAndNotify(log) {
  const convo = log.transcript.map((l) => `${l.who === 'caller' ? 'Caller' : 'Assistant'}: ${l.text}`).join('\n');
  if (!convo) return;
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: BACKEND_MODEL,
      instructions: `Summarize this phone call that an AI assistant answered for ${OWNER}. Return JSON only: {"title": "<who called + why, max 8 words>", "summary": "<2-3 short sentences: who, what they wanted, any message or follow-up for ${OWNER}>", "urgent": true|false}`,
      input: `Return the JSON summary for this call.\n\nSaved messages: ${JSON.stringify(log.messages)}\n\nTranscript:\n${convo}`,
      text: { format: { type: 'json_object' } },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body.error ?? body).slice(0, 300));
  const text = body.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('') ?? '';
  const s = JSON.parse(text);
  log.summary = s;
  fs.writeFileSync(path.join(CALLS_DIR, `${log.callId}.json`), JSON.stringify(log, null, 2));
  console.log(`[${ts()}] 📝 ${s.urgent ? '🔴 ' : ''}${s.title} — ${s.summary}`);
  notifyPhone(`${s.urgent ? '🔴 ' : ''}📞 ${s.title}`, s.summary, log.callId);
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const android = (cmd, cb) => execFile('sudo', ['android', cmd], { timeout: 10000 }, cb);

function notifyPhone(title, body, tag) {
  const cmd = `cmd notification post -S bigtext -t ${q(title)} ${q('rethink-' + tag)} ${q(body)}`;
  android(cmd, (err) => err && console.log(`[${ts()}] notify failed: ${err.message}`));
}

// The current call's number, last 10 digits, from Android's telephony state (null if it can't be read).
function callerNumber() {
  return new Promise((resolve) =>
    // Only the live call state: dumpsys telecom also lists past calls, which could wrongly match an allowed number.
    android('dumpsys telephony.registry', (err, out = '') => {
      const m = out.match(/mCallIncomingNumber=\+?(\d{10,})/);
      resolve(m ? m[1].slice(-10) : null);
    }),
  );
}

function writeWav(file, pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}
