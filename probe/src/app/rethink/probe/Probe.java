package app.rethink.probe;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.Looper;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.reflect.Method;

/**
 * Call-audio feasibility probe. Runs via app_process as root (no APK install).
 *
 *   check                      - report whether PSTN call audio is interceptable
 *   test <secs> <in.pcm> <dir> - during a live call: record caller (downlink) for <secs>
 *                                while injecting <in.pcm> (16 kHz mono s16le) into the uplink.
 *
 * Tries the official Android 13+ SystemApi first (AudioManager#getCallDownlinkExtractionAudioRecord /
 * #getCallUplinkInjectionAudioTrack), then falls back to raw VOICE_DOWNLINK capture and a
 * USAGE_CALL_ASSISTANT AudioTrack.
 */
public class Probe {
    static final int RATE = 16000;

    public static void main(String[] args) throws Exception {
        String mode = args.length > 0 ? args[0] : "check";
        Looper.prepareMainLooper();
        Context ctx = systemContext();
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        log("audio mode=" + am.getMode() + " (2=IN_CALL)");

        Boolean interceptable = null;
        try {
            interceptable = (Boolean) AudioManager.class.getMethod("isPstnCallAudioInterceptable").invoke(am);
        } catch (Throwable t) {
            log("isPstnCallAudioInterceptable failed: " + root(t));
        }
        log("isPstnCallAudioInterceptable=" + interceptable);

        if (mode.equals("test")) {
            int secs = Integer.parseInt(args[1]);
            File in = new File(args[2]);
            File dir = new File(args[3]);
            test(am, secs, in, dir);
        }
        log("done");
        System.exit(0);
    }

    static void test(AudioManager am, int secs, File in, File dir) throws Exception {
        AudioFormat fmt = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .build();
        AudioFormat outFmt = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build();

        // ---- capture (caller -> us)
        AudioRecord rec = null;
        String recPath = null;
        try {
            rec = (AudioRecord) AudioManager.class
                    .getMethod("getCallDownlinkExtractionAudioRecord", AudioFormat.class).invoke(am, fmt);
            recPath = "api:getCallDownlinkExtractionAudioRecord";
        } catch (Throwable t) {
            log("downlink API failed: " + root(t));
            try {
                int buf = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT) * 4;
                rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_DOWNLINK, RATE,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, buf);
                if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("not initialized");
                recPath = "fallback:VOICE_DOWNLINK";
            } catch (Throwable t2) {
                log("VOICE_DOWNLINK fallback failed: " + root(t2));
                rec = null;
            }
        }
        log("capture path=" + recPath);

        // ---- injection (us -> caller)
        AudioTrack track = null;
        String trackPath = null;
        try {
            track = (AudioTrack) AudioManager.class
                    .getMethod("getCallUplinkInjectionAudioTrack", AudioFormat.class).invoke(am, outFmt);
            trackPath = "api:getCallUplinkInjectionAudioTrack";
        } catch (Throwable t) {
            log("uplink API failed: " + root(t));
            try {
                AudioAttributes.Builder ab = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH);
                // USAGE_CALL_ASSISTANT = 17 (SystemApi)
                AudioAttributes.Builder.class.getMethod("setSystemUsage", int.class).invoke(ab, 17);
                track = new AudioTrack.Builder()
                        .setAudioAttributes(ab.build())
                        .setAudioFormat(outFmt)
                        .setTransferMode(AudioTrack.MODE_STREAM)
                        .build();
                trackPath = "fallback:USAGE_CALL_ASSISTANT";
            } catch (Throwable t2) {
                log("CALL_ASSISTANT fallback failed: " + root(t2));
                track = null;
            }
        }
        log("inject path=" + trackPath);

        final AudioRecord r = rec;
        final File recFile = new File(dir, "caller.pcm");
        Thread recThread = null;
        if (r != null) {
            recThread = new Thread(() -> {
                long bytes = 0, peak = 0;
                try (FileOutputStream fos = new FileOutputStream(recFile)) {
                    r.startRecording();
                    log("recording state=" + r.getRecordingState());
                    byte[] b = new byte[RATE / 5 * 2]; // 200ms
                    long end = System.currentTimeMillis() + secs * 1000L;
                    while (System.currentTimeMillis() < end) {
                        int n = r.read(b, 0, b.length);
                        if (n < 0) { log("read error " + n); break; }
                        fos.write(b, 0, n);
                        bytes += n;
                        for (int i = 0; i + 1 < n; i += 2) {
                            int s = Math.abs((short) ((b[i] & 0xff) | (b[i + 1] << 8)));
                            if (s > peak) peak = s;
                        }
                    }
                    r.stop();
                } catch (Throwable t) {
                    log("record thread: " + root(t));
                }
                log("recorded bytes=" + bytes + " peak=" + peak + " (0 = silence)");
            });
            recThread.start();
        }

        if (track != null) {
            Thread.sleep(1500);
            track.play();
            log("playing state=" + track.getPlayState() + " routedTo=" + describe(track));
            long written = 0;
            try (FileInputStream fis = new FileInputStream(in)) {
                byte[] b = new byte[4096];
                int n;
                while ((n = fis.read(b)) > 0) {
                    int w = track.write(b, 0, n);
                    if (w < 0) { log("write error " + w); break; }
                    written += w;
                }
            }
            Thread.sleep(500);
            track.stop();
            track.release();
            log("injected bytes=" + written);
        }

        if (recThread != null) recThread.join();
        if (rec != null) rec.release();
    }

    static String describe(AudioTrack t) {
        try {
            android.media.AudioDeviceInfo d = t.getRoutedDevice();
            return d == null ? "null" : (d.getType() + ":" + d.getProductName());
        } catch (Throwable e) {
            return "?";
        }
    }

    static Context systemContext() throws Exception {
        Class<?> at = Class.forName("android.app.ActivityThread");
        Object thread = at.getMethod("systemMain").invoke(null);
        Method m = at.getMethod("getSystemContext");
        return (Context) m.invoke(thread);
    }

    static String root(Throwable t) {
        while (t.getCause() != null) t = t.getCause();
        return t.getClass().getSimpleName() + ": " + t.getMessage();
    }

    static void log(String s) {
        System.out.println("[probe] " + s);
    }
}
