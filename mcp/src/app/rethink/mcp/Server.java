package app.rethink.mcp;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.util.Xml;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileWriter;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Rethink Phone MCP server.
 *
 * Runs on the phone itself (as root, via app_process) and speaks the Model Context Protocol over
 * Streamable HTTP (JSON responses, no streaming). Every tool is a thin wrapper around a standard
 * Android command (input, am, uiautomator, screencap, content), so anything it does can be checked
 * by hand with adb. Every call is printed and appended to an audit log on the phone.
 *
 * Usage: app_process -Djava.class.path=mcp.dex /system/bin app.rethink.mcp.Server [port] [bind]
 */
public final class Server {
    static final String NAME = "rethink-phone", VERSION = "0.1.0";
    static final String DIR = "/data/local/tmp/rethink";
    static final String AUDIT = DIR + "/mcp-audit.jsonl";
    static final SimpleDateFormat TS = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US);

    /** Elements from the most recent get_screen, so tap_element can refer to them by number. */
    static final List<int[]> lastElements = new ArrayList<>();

    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 7071;
        String bind = args.length > 1 ? args[1] : "127.0.0.1";
        new File(DIR).mkdirs();
        ServerSocket ss = new ServerSocket(port, 16, InetAddress.getByName(bind));
        log("ready on http://" + bind + ":" + port + "/mcp  (audit log: " + AUDIT + ")");
        while (true) {
            Socket s = ss.accept();
            new Thread(() -> handle(s)).start();
        }
    }

    // ---------------------------------------------------------------- HTTP

    static void handle(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(30000);
            InputStream in = sock.getInputStream();
            String requestLine = readLine(in);
            if (requestLine == null) return;
            Map<String, String> headers = new HashMap<>();
            for (String l; (l = readLine(in)) != null && !l.isEmpty(); ) {
                int c = l.indexOf(':');
                if (c > 0) headers.put(l.substring(0, c).trim().toLowerCase(Locale.US), l.substring(c + 1).trim());
            }
            String[] parts = requestLine.split(" ");
            String method = parts[0], path = parts.length > 1 ? parts[1] : "/";
            OutputStream out = sock.getOutputStream();
            if (!path.startsWith("/mcp")) { respond(out, 404, "text/plain", "not found"); return; }
            if (!method.equals("POST")) { respond(out, 405, "text/plain", "POST only (no SSE stream)"); return; }
            int len = Integer.parseInt(headers.getOrDefault("content-length", "0"));
            byte[] body = new byte[len];
            for (int off = 0; off < len; ) { int r = in.read(body, off, len - off); if (r < 0) break; off += r; }
            Object reply = dispatch(new String(body, StandardCharsets.UTF_8));
            if (reply == null) respond(out, 202, "application/json", "");
            else respond(out, 200, "application/json", reply.toString());
        } catch (Exception e) {
            log("http error: " + e);
        }
    }

    static String readLine(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int c; (c = in.read()) != -1; ) {
            if (c == '\n') return sb.toString().replace("\r", "");
            sb.append((char) c);
        }
        return sb.length() > 0 ? sb.toString() : null;
    }

    static void respond(OutputStream out, int code, String type, String body) throws Exception {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String status = code == 200 ? "OK" : code == 202 ? "Accepted" : code == 404 ? "Not Found" : code == 405 ? "Method Not Allowed" : "Error";
        String head = "HTTP/1.1 " + code + " " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + b.length + "\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    // ---------------------------------------------------------------- JSON-RPC / MCP

    static Object dispatch(String body) throws JSONException {
        String t = body.trim();
        if (t.startsWith("[")) {
            JSONArray batch = new JSONArray(t), replies = new JSONArray();
            for (int i = 0; i < batch.length(); i++) {
                JSONObject r = rpc(batch.getJSONObject(i));
                if (r != null) replies.put(r);
            }
            return replies.length() > 0 ? replies : null;
        }
        return rpc(new JSONObject(t));
    }

    static JSONObject rpc(JSONObject req) throws JSONException {
        String method = req.optString("method");
        boolean isNotification = !req.has("id");
        JSONObject params = req.optJSONObject("params");
        if (params == null) params = new JSONObject();
        JSONObject res = new JSONObject();
        try {
            switch (method) {
                case "initialize": {
                    String pv = params.optString("protocolVersion", "2025-06-18");
                    res.put("protocolVersion", pv);
                    res.put("capabilities", new JSONObject().put("tools", new JSONObject().put("listChanged", false)));
                    res.put("serverInfo", new JSONObject().put("name", NAME).put("version", VERSION));
                    res.put("instructions", INSTRUCTIONS);
                    log("client connected: " + params.optJSONObject("clientInfo"));
                    break;
                }
                case "ping": break;
                case "tools/list": res.put("tools", Tools.list()); break;
                case "tools/call": res = Tools.call(params.getString("name"), params.optJSONObject("arguments")); break;
                default:
                    if (isNotification) return null;
                    return error(req.opt("id"), -32601, "method not found: " + method);
            }
        } catch (Exception e) {
            return error(req.opt("id"), -32603, e.toString());
        }
        if (isNotification) return null;
        return new JSONObject().put("jsonrpc", "2.0").put("id", req.opt("id")).put("result", res);
    }

    static JSONObject error(Object id, int code, String msg) throws JSONException {
        return new JSONObject().put("jsonrpc", "2.0").put("id", id == null ? JSONObject.NULL : id)
                .put("error", new JSONObject().put("code", code).put("message", msg));
    }

    static final String INSTRUCTIONS =
            "You are controlling a real Android phone (Rethink Phone). Call get_screen to see what is on it before acting, " +
            "and again after acting to confirm the result. Prefer tap_element over raw coordinates. " +
            "Never place a call or send a message the user did not ask for.";

    // ---------------------------------------------------------------- shell + logging

    static final class Result { int code; String out; }

    /** Runs a command without a shell (no quoting surprises); returns exit code and combined output. */
    static Result run(long timeoutMs, String... cmd) throws Exception {
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        Thread reader = new Thread(() -> {
            try (InputStream is = p.getInputStream()) {
                byte[] b = new byte[8192];
                for (int n; (n = is.read(b)) > 0; ) buf.write(b, 0, n);
            } catch (Exception ignored) { }
        });
        reader.start();
        Result r = new Result();
        if (!p.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) { p.destroyForcibly(); r.code = -1; }
        else r.code = p.exitValue();
        reader.join(1000);
        r.out = buf.toString("UTF-8").trim();
        return r;
    }

    static String sh(String... cmd) throws Exception {
        Result r = run(15000, cmd);
        if (r.code != 0) throw new RuntimeException(String.join(" ", cmd) + " failed (" + r.code + "): " + r.out);
        return r.out;
    }

    static synchronized void log(String line) {
        System.out.println("[mcp " + new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date()) + "] " + line);
        System.out.flush();
    }

    static synchronized void audit(String tool, JSONObject args, boolean ok, String summary, long ms) {
        try (FileWriter w = new FileWriter(AUDIT, true)) {
            JSONObject e = new JSONObject().put("ts", TS.format(new Date())).put("tool", tool)
                    .put("args", args).put("ok", ok).put("ms", ms).put("result", summary);
            w.write(e.toString() + "\n");
        } catch (Exception ignored) { }
    }

    // ---------------------------------------------------------------- screen helpers

    static final class Node {
        String text, desc, id; boolean click, edit, checkable, checked; int x1, y1, x2, y2; String label;
        boolean inside(Node o) { return x1 >= o.x1 && y1 >= o.y1 && x2 <= o.x2 && y2 <= o.y2; }
    }

    /**
     * Dumps the accessibility tree with uiautomator and returns a numbered, compact list of what a person
     * would see and could press. Unlabelled buttons take the text inside them (a settings row becomes
     * "Display / Dark theme, font size, brightness"), and that text is not listed twice.
     */
    static String describeScreen() throws Exception {
        String path = DIR + "/ui.xml";
        Result r = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            r = run(10000, "uiautomator", "dump", path);
            if (r.code == 0 && r.out.contains("dumped")) break;
            Thread.sleep(400);
        }
        if (r == null || !r.out.contains("dumped")) throw new RuntimeException("uiautomator dump failed: " + (r == null ? "" : r.out));
        XmlPullParser xp = Xml.newPullParser();
        List<Node> nodes = new ArrayList<>();
        String pkg = null;
        Pattern bp = Pattern.compile("\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\]");
        try (FileInputStream fis = new FileInputStream(path)) {
            xp.setInput(fis, "UTF-8");
            for (int ev = xp.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = xp.next()) {
                if (ev != XmlPullParser.START_TAG || !"node".equals(xp.getName())) continue;
                if (pkg == null) pkg = xp.getAttributeValue(null, "package");
                Node n = new Node();
                n.text = attr(xp, "text"); n.desc = attr(xp, "content-desc"); n.id = attr(xp, "resource-id");
                n.click = "true".equals(xp.getAttributeValue(null, "clickable"));
                n.edit = attr(xp, "class").endsWith("EditText");
                n.checkable = "true".equals(xp.getAttributeValue(null, "checkable"));
                n.checked = "true".equals(xp.getAttributeValue(null, "checked"));
                Matcher m = bp.matcher(attr(xp, "bounds"));
                if (!m.find()) continue;
                n.x1 = Integer.parseInt(m.group(1)); n.y1 = Integer.parseInt(m.group(2));
                n.x2 = Integer.parseInt(m.group(3)); n.y2 = Integer.parseInt(m.group(4));
                if (n.x2 <= n.x1 || n.y2 <= n.y1) continue;
                if (n.text.isEmpty() && n.desc.isEmpty() && !n.click && !n.edit && !n.checkable) continue;
                nodes.add(n);
            }
        }
        List<Node> absorbed = new ArrayList<>();
        for (Node n : nodes) {
            String own = !n.text.isEmpty() ? n.text : n.desc;
            if (!own.isEmpty() || !(n.click || n.checkable)) { n.label = own; continue; }
            StringBuilder lb = new StringBuilder();
            for (Node c : nodes) {
                if (c == n || !c.inside(n) || c.click || c.edit) continue;
                String t = !c.text.isEmpty() ? c.text : c.desc;
                if (t.isEmpty()) continue;
                if (lb.length() > 0) lb.append(" / ");
                lb.append(t); absorbed.add(c);
                if (c.checkable) { n.checkable = true; n.checked |= c.checked; }
            }
            n.label = lb.length() > 0 ? lb.toString() : n.id.replaceFirst(".*:id/", "#");
        }
        StringBuilder sb = new StringBuilder();
        synchronized (lastElements) {
            lastElements.clear();
            for (Node n : nodes) {
                if (absorbed.contains(n) && !n.click) continue;
                int cx = (n.x1 + n.x2) / 2, cy = (n.y1 + n.y2) / 2;
                lastElements.add(new int[]{cx, cy});
                sb.append('[').append(lastElements.size() - 1).append("] ");
                if (!n.label.isEmpty()) sb.append('"').append(n.label).append('"');
                if (!n.text.isEmpty() && !n.desc.isEmpty()) sb.append(" (").append(n.desc).append(")");
                if (n.edit) sb.append(" <input>");
                else if (n.click) sb.append(" <button>");
                if (n.checkable) sb.append(n.checked ? " <on>" : " <off>");
                sb.append(" @").append(cx).append(',').append(cy).append('\n');
            }
        }
        return "app: " + pkg + "\n" + sb;
    }

    static String attr(XmlPullParser xp, String name) {
        String v = xp.getAttributeValue(null, name);
        return v == null ? "" : v.replace('\n', ' ').trim();
    }

    /** Screenshot as a downscaled JPEG, base64-encoded. */
    static String screenshotJpeg(int width) throws Exception {
        String path = DIR + "/screen.png";
        sh("screencap", "-p", path);
        Bitmap full = BitmapFactory.decodeFile(path);
        if (full == null) throw new RuntimeException("could not decode screenshot");
        int h = Math.round(full.getHeight() * (width / (float) full.getWidth()));
        Bitmap small = Bitmap.createScaledBitmap(full, width, h, true);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        small.compress(Bitmap.CompressFormat.JPEG, 72, bo);
        full.recycle(); small.recycle();
        return Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
    }
}
