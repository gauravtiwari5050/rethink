// Simulated phone for testing the bridge without a real call.
// Speaks scripted caller lines (macOS `say`) into the bridge in real time, like CallBridge would.
//
//   BRIDGE_PORT=7071 node server.js   &   node sim-caller.js 7071
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PORT = Number(process.argv[2] || 7071);
const SCRIPT = [
  [3000, 'Hi, this is Rahul. What is the weather like in Bangalore today?'],
  [14000, 'Okay. Can you tell Gaurav to call me back about the dinner on Friday? My number is 98450 12345.'],
  [12000, "That's all, thanks. You can hang up now. Bye!"],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'simcaller-'));
function tts(text, i) {
  const aiff = path.join(tmp, `${i}.aiff`);
  const wav = path.join(tmp, `${i}.wav`);
  execFileSync('say', ['-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav]);
  const b = fs.readFileSync(wav);
  const at = b.indexOf('data');
  return b.subarray(at + 8, at + 8 + b.readUInt32LE(at + 4));
}
const lines = SCRIPT.map(([gap, text], i) => ({ gap, text, pcm: tts(text, i) }));

const sock = net.connect(PORT, '127.0.0.1', () => console.log('sim: connected'));
let agentBytes = 0;
sock.on('data', (d) => (agentBytes += d.length));
sock.on('close', () => {
  console.log(`sim: bridge closed the line (agent audio ${Math.round(agentBytes / 32)} ms) — hung up by agent`);
  process.exit(0);
});

// Build the caller timeline: gap of silence, then the line, ...
const parts = [];
for (const l of lines) parts.push(Buffer.alloc(Math.round(l.gap * 32)), l.pcm);
parts.push(Buffer.alloc(40000 * 32)); // trailing silence; agent should hang up during this
const timeline = Buffer.concat(parts);
let off = 0;
let lineIdx = 0;
let nextLineAt = lines[0].gap * 32;
const iv = setInterval(() => {
  if (off >= timeline.length) {
    clearInterval(iv);
    console.log('sim: script finished without hang-up');
    sock.end();
    return;
  }
  if (lineIdx < lines.length && off >= nextLineAt) {
    console.log(`sim: 👤 "${lines[lineIdx].text}"`);
    nextLineAt += lines[lineIdx].pcm.length + (lines[lineIdx + 1]?.gap ?? 0) * 32;
    lineIdx++;
  }
  sock.write(timeline.subarray(off, off + 640));
  off += 640;
}, 20);
