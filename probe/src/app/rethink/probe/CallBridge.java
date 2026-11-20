package app.rethink.probe;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.os.Looper;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Dev-loop call bridge (runs via app_process as root).
 *
 * Waits for an incoming call, auto-answers after a delay, then streams the caller's audio
 * (16 kHz mono s16le) to 127.0.0.1:<port> — which `adb reverse` forwards to the Mac — and plays
 * whatever bytes come back into the call uplink. Raw PCM both ways, no framing.
 *
 *   CallBridge [port=7070] [answerDelayMs=4000]
 */
public class CallBridge {
    static final int RATE = 16000;
    static final int CHUNK = RATE / 50 * 2; // 20 ms

    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 7070;
        long answerDelay = args.length > 1 ? Long.parseLong(args[1]) : 4000;
        Looper.prepareMainLooper();
        Context ctx = Probe.systemContext();
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        log("ready; port=" + port + " answerDelayMs=" + answerDelay);

        while (true) {
            // 1 = MODE_RINGTONE (incoming call ringing)
            while (am.getMode() != AudioManager.MODE_RINGTONE) Thread.sleep(200);
            log("incoming call ringing; answering in " + answerDelay + " ms");
            long until = System.currentTimeMillis() + answerDelay;
            boolean stillRinging = true;
            while (System.currentTimeMillis() < until) {
                if (am.getMode() != AudioManager.MODE_RINGTONE) { stillRinging = false; break; }
                Thread.sleep(100);
            }
            if (!stillRinging) {
                log("ringing stopped before auto-answer (answered manually or caller hung up)");
                if (am.getMode() != AudioManager.MODE_IN_CALL) continue;
            } else {
                Runtime.getRuntime().exec(new String[]{"input", "keyevent", "KEYCODE_CALL"}).waitFor();
            }
            long t0 = System.currentTimeMillis();
            while (am.getMode() != AudioManager.MODE_IN_CALL && System.currentTimeMillis() - t0 < 5000) Thread.sleep(50);
            if (am.getMode() != AudioManager.MODE_IN_CALL) { log("call did not become active"); continue; }
            log("call active");
            try {
                bridge(am, port);
            } catch (Throwable t) {
                log("bridge error: " + Probe.root(t));
            }
            while (am.getMode() == AudioManager.MODE_IN_CALL) Thread.sleep(200);
            log("call ended");
        }
    }

    static void bridge(AudioManager am, int port) throws Exception {
        AudioFormat inFmt = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
        AudioFormat outFmt = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build();
        // Let the voice call audio path settle before attaching (attaching ~1 s after answer was silent).
        Thread.sleep(1500);
        AudioRecord rec = null;
        AudioTrack track = null;
        for (int attempt = 1; attempt <= 5; attempt++) {
            rec = (AudioRecord) AudioManager.class
                    .getMethod("getCallDownlinkExtractionAudioRecord", AudioFormat.class).invoke(am, inFmt);
            track = inCallMusicTrack(am, outFmt);
            boolean ok = rec.getState() == AudioRecord.STATE_INITIALIZED && track.getState() == AudioTrack.STATE_INITIALIZED;
            log("attempt " + attempt + ": rec.state=" + rec.getState() + " track.state=" + track.getState());
            if (ok) break;
            rec.release();
            track.release();
            rec = null;
            track = null;
            Thread.sleep(500);
        }
        if (rec == null) throw new IllegalStateException("could not attach to call audio");
        Socket sock = new Socket();
        sock.setTcpNoDelay(true);
        sock.connect(new InetSocketAddress("127.0.0.1", port), 3000);
        log("connected to Mac bridge");
        OutputStream out = sock.getOutputStream();
        InputStream in = sock.getInputStream();

        rec.startRecording();
        track.play();
        Thread.sleep(200);
        log("rec routed=" + dev(rec.getRoutedDevice()) + " recording=" + rec.getRecordingState()
                + " | track routed=" + dev(track.getRoutedDevice()) + " playing=" + track.getPlayState()
                + " bufFrames=" + track.getBufferSizeInFrames());
        // The agent owns this call: mute the handset mic so room sound (incl. the earpiece playing the
        // caller) isn't sent back to the caller as echo. In-call music is mixed separately.
        boolean micWasMuted = am.isMicrophoneMute();
        if (!"0".equals(System.getenv("MUTE_MIC"))) {
            am.setMicrophoneMute(true);
            log("handset mic muted=" + am.isMicrophoneMute());
        }
        final AudioRecord frec = rec;
        final AudioTrack ftrack = track;

        Thread down = new Thread(() -> {
            byte[] b = new byte[CHUNK];
            try {
                while (am.getMode() == AudioManager.MODE_IN_CALL) {
                    int n = frec.read(b, 0, b.length);
                    if (n <= 0) break;
                    out.write(b, 0, n);
                }
            } catch (Throwable t) {
                log("downlink: " + Probe.root(t));
            }
            try { sock.close(); } catch (Throwable ignored) { }
        });
        down.start();

        byte[] b = new byte[CHUNK * 4];
        long injected = 0, lastLog = System.currentTimeMillis();
        try {
            int n;
            while ((n = in.read(b)) > 0) {
                if ((n & 1) == 1) { // keep sample alignment
                    int m = in.read(b, n, 1);
                    if (m > 0) n += m;
                }
                int w = ftrack.write(b, 0, n);
                if (w < 0) log("track.write error " + w);
                else injected += w;
                if (System.currentTimeMillis() - lastLog > 5000) {
                    lastLog = System.currentTimeMillis();
                    log("injected " + (injected / 32) + " ms; track routed=" + dev(ftrack.getRoutedDevice())
                            + " underruns=" + ftrack.getUnderrunCount());
                }
            }
        } catch (Throwable t) {
            if (am.getMode() == AudioManager.MODE_IN_CALL) log("uplink: " + Probe.root(t));
        }
        if (am.getMode() == AudioManager.MODE_IN_CALL) {
            // Mac side closed the stream while the call is still up: the agent ended the call.
            log("agent ended the call -> hanging up");
            Runtime.getRuntime().exec(new String[]{"input", "keyevent", "KEYCODE_ENDCALL"}).waitFor();
        }
        down.join(2000);
        try { am.setMicrophoneMute(micWasMuted); } catch (Throwable ignored) { }
        try { sock.close(); } catch (Throwable ignored) { }
        try { rec.stop(); } catch (Throwable ignored) { }
        rec.release();
        try { track.stop(); } catch (Throwable ignored) { }
        track.release();
        log("bridge closed");
    }

    /**
     * AudioTrack that lands on the HAL's AUDIO_OUTPUT_FLAG_INCALL_MUSIC output (mixed into the call uplink).
     *
     * getCallUplinkInjectionAudioTrack() creates a USAGE_CALL_ASSISTANT track, which the policy routes to the
     * plain `voice_tx` mixPort — on this Qualcomm HAL that never reaches the modem. AudioPolicyManager only
     * picks INCALL_MUSIC for a MUSIC / VOICE_COMMUNICATION track that explicitly requests TELEPHONY_TX while
     * in call, so we build exactly that.
     */
    static AudioTrack inCallMusicTrack(AudioManager am, AudioFormat outFmt) {
        android.media.AudioDeviceInfo tx = null;
        for (android.media.AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (d.getType() == android.media.AudioDeviceInfo.TYPE_TELEPHONY) tx = d;
        }
        AudioTrack t = new AudioTrack.Builder()
                .setAudioAttributes(new android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build())
                .setAudioFormat(outFmt)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(RATE / 5 * 2) // 200 ms
                .build();
        if (tx != null) t.setPreferredDevice(tx);
        log("inCallMusicTrack: telephony tx device=" + dev(tx));
        return t;
    }

    static String dev(android.media.AudioDeviceInfo d) {
        return d == null ? "null" : d.getType() + "/" + d.getProductName();
    }

    static void log(String s) {
        System.out.println("[bridge " + new java.text.SimpleDateFormat("HH:mm:ss").format(new java.util.Date()) + "] " + s);
        System.out.flush();
    }
}
