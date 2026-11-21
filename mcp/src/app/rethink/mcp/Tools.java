package app.rethink.mcp;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/** The tools the phone exposes. Each one maps to a standard Android command, noted beside it. */
final class Tools {

    static JSONArray list() throws Exception {
        JSONArray t = new JSONArray();
        t.put(tool("device_status", "Battery, network, screen state, foreground app and time on the phone.", props(), true, false));
        t.put(tool("get_screen", "Describe what is on the phone screen right now: the foreground app and a numbered list of visible elements " +
                "(text, buttons, inputs, toggles) with their centre coordinates. Set screenshot=true to also get an image.",
                props("screenshot", bool("Also return a screenshot (JPEG, 540 px wide). Default false.")), true, false));
        t.put(tool("tap_element", "Tap an element by its number from the latest get_screen.",
                props("index", num("Element number from get_screen.")), false, false, "index"));
        t.put(tool("tap", "Tap the screen at pixel coordinates (screen is 1080 x 2400).",
                props("x", num("X in pixels."), "y", num("Y in pixels.")), false, false, "x", "y"));
        t.put(tool("swipe", "Swipe/scroll the screen. direction is up, down, left or right (the direction the content moves your finger).",
                props("direction", str("up | down | left | right")), false, false, "direction"));
        t.put(tool("type_text", "Type text into the focused input field (ASCII only for now).",
                props("text", str("Text to type.")), false, false, "text"));
        t.put(tool("press_key", "Press a system key: back, home, recents, enter, delete, wake.",
                props("key", str("back | home | recents | enter | delete | wake")), false, false, "key"));
        t.put(tool("list_apps", "List launchable apps (package names).", props(), true, false));
        t.put(tool("open_app", "Open an app by package name, e.g. com.android.dialer, com.android.messaging, com.android.settings.",
                props("package", str("Android package name.")), false, false, "package"));
        t.put(tool("find_contact", "Search the phone's contacts by name. Returns names and phone numbers.",
                props("query", str("Part of the contact's name.")), true, false, "query"));
        t.put(tool("place_call", "Place a real phone call from this phone to a number. Only do this when the user asked for it.",
                props("number", str("Phone number, digits with optional leading +.")), false, true, "number"));
        t.put(tool("end_call", "Hang up the current call.", props(), false, true));
        t.put(tool("compose_sms", "Open the Messages app with a new SMS to a number, pre-filled with text. This does NOT send it: " +
                "tap the send button afterwards (use get_screen to find it) once the user wants it sent.",
                props("number", str("Phone number."), "text", str("Message text.")), false, false, "number", "text"));
        return t;
    }

    static JSONObject call(String name, JSONObject a) throws Exception {
        if (a == null) a = new JSONObject();
        long t0 = System.currentTimeMillis();
        Server.log("→ " + name + " " + a);
        JSONArray content = new JSONArray();
        boolean ok = true;
        String summary;
        try {
            summary = exec(name, a, content);
        } catch (Exception e) {
            ok = false;
            summary = "error: " + e.getMessage();
            content.put(text(summary));
        }
        long ms = System.currentTimeMillis() - t0;
        String brief = summary.length() > 160 ? summary.substring(0, 160).replace('\n', ' ') + "…" : summary.replace('\n', ' ');
        Server.log((ok ? "✓ " : "✗ ") + name + " (" + ms + " ms) " + brief);
        Server.audit(name, a, ok, brief, ms);
        JSONObject res = new JSONObject().put("content", content);
        if (!ok) res.put("isError", true);
        return res;
    }

    static String exec(String name, JSONObject a, JSONArray content) throws Exception {
        String out;
        switch (name) {
            case "device_status": {
                String batt = Server.sh("dumpsys", "battery");
                String level = grab(batt, "level: (\\d+)"), status = grab(batt, "status: (\\d+)");
                String power = Server.sh("dumpsys", "power");
                String screen = grab(power, "mWakefulness=(\\w+)");
                String op = Server.sh("getprop", "gsm.operator.alpha");
                String model = Server.sh("getprop", "ro.product.model");
                String top = foreground();
                String time = Server.sh("date", "+%A %d %B %Y, %H:%M");
                out = "model: " + model + "\nbattery: " + level + "%" + ("2".equals(status) ? " (charging)" : "") +
                        "\nnetwork: " + op + "\nscreen: " + screen + "\nforeground app: " + top + "\ntime: " + time;
                break;
            }
            case "get_screen": {
                out = Server.describeScreen();
                content.put(text(out));
                if (a.optBoolean("screenshot", false))
                    content.put(new JSONObject().put("type", "image").put("mimeType", "image/jpeg").put("data", Server.screenshotJpeg(540)));
                return out;
            }
            case "tap_element": {
                int i = a.getInt("index");
                int[] xy;
                synchronized (Server.lastElements) {
                    if (i < 0 || i >= Server.lastElements.size()) throw new IllegalArgumentException("no element " + i + "; call get_screen first");
                    xy = Server.lastElements.get(i);
                }
                Server.sh("input", "tap", "" + xy[0], "" + xy[1]);
                out = "tapped element " + i + " at " + xy[0] + "," + xy[1];
                break;
            }
            case "tap": {
                int x = a.getInt("x"), y = a.getInt("y");
                Server.sh("input", "tap", "" + x, "" + y);
                out = "tapped " + x + "," + y;
                break;
            }
            case "swipe": {
                String d = a.getString("direction").toLowerCase(Locale.US);
                int[] s;
                switch (d) {
                    case "up": s = new int[]{540, 1800, 540, 700}; break;
                    case "down": s = new int[]{540, 700, 540, 1800}; break;
                    case "left": s = new int[]{900, 1200, 180, 1200}; break;
                    case "right": s = new int[]{180, 1200, 900, 1200}; break;
                    default: throw new IllegalArgumentException("direction must be up, down, left or right");
                }
                Server.sh("input", "swipe", "" + s[0], "" + s[1], "" + s[2], "" + s[3], "300");
                out = "swiped " + d;
                break;
            }
            case "type_text": {
                String t = a.getString("text");
                for (char c : t.toCharArray()) if (c < 0x20 || c > 0x7e) throw new IllegalArgumentException("only plain ASCII text is supported for now");
                Server.sh("input", "text", t.replace("%", "\\%").replace(" ", "%s"));
                out = "typed " + t.length() + " characters";
                break;
            }
            case "press_key": {
                String k = a.getString("key").toLowerCase(Locale.US);
                String code;
                switch (k) {
                    case "back": code = "KEYCODE_BACK"; break;
                    case "home": code = "KEYCODE_HOME"; break;
                    case "recents": code = "KEYCODE_APP_SWITCH"; break;
                    case "enter": code = "KEYCODE_ENTER"; break;
                    case "delete": code = "KEYCODE_DEL"; break;
                    case "wake": code = "KEYCODE_WAKEUP"; break;
                    default: throw new IllegalArgumentException("unknown key " + k);
                }
                Server.sh("input", "keyevent", code);
                out = "pressed " + k;
                break;
            }
            case "list_apps": {
                String r = Server.sh("cmd", "package", "query-activities", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER");
                StringBuilder sb = new StringBuilder();
                for (String l : r.split("\n")) {
                    l = l.trim();
                    if (l.contains("/")) sb.append(l.substring(0, l.indexOf('/'))).append('\n');
                }
                out = sb.toString().trim();
                break;
            }
            case "open_app": {
                String p = a.getString("package");
                if (!p.matches("[A-Za-z0-9_.]+")) throw new IllegalArgumentException("bad package name");
                Server.sh("monkey", "-p", p, "-c", "android.intent.category.LAUNCHER", "1");
                out = "opened " + p;
                break;
            }
            case "find_contact": {
                String q = a.getString("query").toLowerCase(Locale.US).trim();
                String r = Server.sh("content", "query", "--uri", "content://com.android.contacts/data/phones", "--projection", "display_name:data1");
                StringBuilder sb = new StringBuilder();
                for (String l : r.split("\n")) {
                    String n = grab(l, "display_name=(.*?), data1="), num = grab(l, "data1=(.*)$");
                    if (n != null && n.toLowerCase(Locale.US).contains(q)) sb.append(n).append(": ").append(num).append('\n');
                }
                out = sb.length() == 0 ? "no contact matching \"" + q + "\"" : sb.toString().trim();
                break;
            }
            case "place_call": {
                String n = cleanNumber(a.getString("number"));
                Server.sh("am", "start", "-a", "android.intent.action.CALL", "-d", "tel:" + n);
                out = "calling " + n;
                break;
            }
            case "end_call": {
                Server.sh("input", "keyevent", "KEYCODE_ENDCALL");
                out = "hung up";
                break;
            }
            case "compose_sms": {
                String n = cleanNumber(a.getString("number"));
                Server.sh("am", "start", "-a", "android.intent.action.SENDTO", "-d", "smsto:" + n, "--es", "sms_body", a.getString("text"));
                out = "opened a new SMS to " + n + " with the text filled in; not sent yet";
                break;
            }
            default:
                throw new IllegalArgumentException("unknown tool " + name);
        }
        content.put(text(out));
        return out;
    }

    static String foreground() {
        try {
            String r = Server.sh("dumpsys", "activity", "activities");
            String m = grab(r, "topResumedActivity=ActivityRecord\\{\\S+ \\S+ ([^ /]+)/");
            return m == null ? "unknown" : m;
        } catch (Exception e) { return "unknown"; }
    }

    static String cleanNumber(String n) {
        String c = n.replaceAll("[\\s()-]", "");
        if (!c.matches("\\+?[0-9]{3,15}")) throw new IllegalArgumentException("not a phone number: " + n);
        return c;
    }

    static String grab(String s, String re) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile(re, java.util.regex.Pattern.MULTILINE).matcher(s);
        return m.find() ? m.group(1) : null;
    }

    // ---- schema helpers

    static JSONObject text(String s) throws Exception { return new JSONObject().put("type", "text").put("text", s); }
    static JSONObject str(String d) throws Exception { return new JSONObject().put("type", "string").put("description", d); }
    static JSONObject num(String d) throws Exception { return new JSONObject().put("type", "integer").put("description", d); }
    static JSONObject bool(String d) throws Exception { return new JSONObject().put("type", "boolean").put("description", d); }

    static JSONObject props(Object... kv) throws Exception {
        JSONObject p = new JSONObject();
        for (int i = 0; i < kv.length; i += 2) p.put((String) kv[i], kv[i + 1]);
        return p;
    }

    static JSONObject tool(String name, String desc, JSONObject properties, boolean readOnly, boolean destructive, String... required) throws Exception {
        JSONObject schema = new JSONObject().put("type", "object").put("properties", properties);
        if (required.length > 0) { JSONArray r = new JSONArray(); for (String s : required) r.put(s); schema.put("required", r); }
        return new JSONObject().put("name", name).put("description", desc).put("inputSchema", schema)
                .put("annotations", new JSONObject().put("readOnlyHint", readOnly).put("destructiveHint", destructive).put("openWorldHint", !readOnly));
    }
}
