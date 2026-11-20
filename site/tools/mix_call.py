"""Mix a bridge call recording (caller downlink + agent uplink) into one mono track.

Both tracks run until the call ends, so they are aligned at the end.
Usage: python3 -I mix_call.py <call-base> <out.wav> [start:end,start:end ...]  (seconds, optional cuts to keep)
"""
import array, math, sys, wave

def read(path):
    w = wave.open(path)
    return array.array('h', w.readframes(w.getnframes())), w.getframerate()

base, out = sys.argv[1], sys.argv[2]
caller, rate = read(base + '-caller.wav')
agent, _ = read(base + '-agent.wav')
n = max(len(caller), len(agent))
caller = array.array('h', [0] * (n - len(caller))) + caller
agent = array.array('h', [0] * (n - len(agent))) + agent
mix = array.array('h', (max(-32767, min(32767, int(c * 0.9 + a * 0.9))) for c, a in zip(caller, agent)))

if len(sys.argv) > 3:
    fade = int(rate * 0.08)
    kept = array.array('h')
    for seg in sys.argv[3].split(','):
        s, e = (int(float(x) * rate) for x in seg.split(':'))
        piece = mix[s:e]
        for i in range(min(fade, len(piece))):
            piece[i] = int(piece[i] * i / fade)
            piece[-1 - i] = int(piece[-1 - i] * i / fade)
        kept += piece + array.array('h', [0] * int(rate * 0.25))
    mix = kept
else:
    for t in range(0, len(mix), rate // 2):
        seg = mix[t:t + rate // 2]
        rms = math.sqrt(sum(x * x for x in seg) / max(1, len(seg)))
        print(f'{t / rate:6.1f}s {int(rms):6d} ' + '#' * int(rms / 300))

w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(mix.tobytes()); w.close()
