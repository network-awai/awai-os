package network.awai.platform;

import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Commit-pinned online distribution allowlist ({@code online-pins.json}, AWAI-3729).
 *
 * <p>Pure Java (no Android framework or {@code org.json} dependency) so the same parser and bounds
 * enforced by {@link HostActivity} run directly in plain JVM regression tests. Keep {@link #MAX_APPS}
 * aligned with {@link LatestPointer#MAX_APPS} and {@code android/client/online.js} ({@code MAX_PINNED_APPS}).
 */
public final class OnlinePins {
    public static final int MAX_APPS = 64;
    /** Byte ceiling for {@code online-pins.json}: fits {@link #MAX_APPS} pinned APKs plus the catalog pin. */
    public static final int MAX_BYTES = 32768;
    public static final int MAX_CATALOG_BYTES = 131072;
    public static final int MAX_APK_BYTES = 64 * 1024 * 1024;
    public static final String DISTRIBUTION_PREFIX = "https://raw.githubusercontent.com/network-awai/awai-os/";

    public interface AppValidator {
        void checkAdmitted(String appId);
    }

    public static final class Pin {
        public final String url;
        public final String sha256;
        public final long maxBytes;

        Pin(String url, String sha256, long maxBytes) {
            this.url = url;
            this.sha256 = sha256;
            this.maxBytes = maxBytes;
        }
    }

    public static final class LoadResult {
        public final Set<String> allowedUrls;
        public final String error;

        LoadResult(Set<String> allowedUrls, String error) {
            this.allowedUrls = allowedUrls;
            this.error = error;
        }
    }

    public final String revision;
    public final Pin catalog;
    public final Map<String, Pin> apks;
    public final Set<String> allowedUrls;

    private OnlinePins(String revision, Pin catalog, Map<String, Pin> apks, Set<String> allowedUrls) {
        this.revision = revision;
        this.catalog = catalog;
        this.apks = apks;
        this.allowedUrls = allowedUrls;
    }

    /**
     * Parses {@code online-pins.json} text. Returns {@code null} when the asset is the literal
     * JSON {@code null} written by offline builds; throws {@link SecurityException} on any
     * malformed, invalid, unknown-app, or out-of-bounds pin document.
     */
    public static OnlinePins parseOrNull(String json, AppValidator validator) {
        if (json == null) throw new SecurityException("pins-empty");
        String trimmed = json.trim();
        if (trimmed.isEmpty()) throw new SecurityException("pins-empty");
        if ("null".equals(trimmed)) return null;
        return parse(trimmed, validator);
    }

    /** Parses and validates a non-null {@code online-pins.json} document. */
    public static OnlinePins parse(String json, AppValidator validator) {
        if (json == null || json.trim().isEmpty()) throw new SecurityException("pins-empty");
        Object rootObj = new JsonParser(json).parse();
        Map<String, Object> root = asObject(rootObj, "pins-shape");
        String rev = asString(root.get("revision"), "pins-revision");
        if (!rev.matches("[0-9a-f]{40}")) throw new SecurityException("pins-revision");

        Pin catalogPin = parsePin(asObject(root.get("catalog"), "pins-catalog"), rev, MAX_CATALOG_BYTES);

        Map<String, Object> apksObj = asObject(root.get("apks"), "pins-apks");
        if (apksObj.size() < 1 || apksObj.size() > MAX_APPS) {
            throw new SecurityException("pins-apps-count");
        }

        Map<String, Pin> apkMap = new LinkedHashMap<>();
        Set<String> urls = new LinkedHashSet<>();
        urls.add(catalogPin.url);
        for (Map.Entry<String, Object> entry : apksObj.entrySet()) {
            String id = entry.getKey();
            if (validator != null) validator.checkAdmitted(id);
            Pin pin = parsePin(asObject(entry.getValue(), "pins-apk"), rev, MAX_APK_BYTES);
            apkMap.put(id, pin);
            urls.add(pin.url);
        }
        return new OnlinePins(rev, catalogPin, Collections.unmodifiableMap(apkMap), Collections.unmodifiableSet(urls));
    }

    /**
     * Fail-closed loader for {@link HostActivity#onCreate}: returns the allowed URL set on success
     * (empty with {@code error == null} for offline {@code "null"} builds), or an empty set plus a
     * secret-free diagnostic summary on any validation/parse error.
     */
    public static LoadResult loadAllowlist(String json, AppValidator validator) {
        try {
            OnlinePins pins = parseOrNull(json, validator);
            if (pins == null) return new LoadResult(Collections.<String>emptySet(), null);
            return new LoadResult(pins.allowedUrls, null);
        } catch (Exception invalid) {
            return new LoadResult(Collections.<String>emptySet(), errorSummary(invalid));
        }
    }

    /** Secret-free single-line summary suitable for {@code android.util.Log.e}. */
    public static String errorSummary(Throwable error) {
        if (error == null) return "unknown";
        String type = error.getClass().getSimpleName();
        String msg = error.getMessage();
        if ((error instanceof SecurityException || error instanceof IOException)
                && msg != null && msg.matches("[a-z0-9-]{1,48}")) {
            return type + ": " + msg;
        }
        return type;
    }

    private static Pin parsePin(Map<String, Object> obj, String rev, long ceiling) {
        String url = asString(obj.get("url"), "pins-url");
        if (!validPinnedUrl(url, rev)) throw new SecurityException("pins-url");
        String sha = asString(obj.get("sha256"), "pins-digest");
        if (!sha.matches("[0-9a-f]{64}")) throw new SecurityException("pins-digest");
        long maxBytes = asExactLong(obj.get("maxBytes"), "pins-budget");
        if (maxBytes < 1 || maxBytes > ceiling) throw new SecurityException("pins-budget");
        return new Pin(url, sha, maxBytes);
    }

    private static boolean validPinnedUrl(String url, String rev) {
        String prefix = DISTRIBUTION_PREFIX + rev + "/store/distribution/";
        if (!url.startsWith(prefix) || url.length() <= prefix.length() || url.endsWith("/")) return false;
        if (url.contains("/../") || url.contains("/./") || url.endsWith("/..") || url.endsWith("/.") || url.contains("%") || url.contains("\\")) return false;
        try {
            URI u = new URI(url);
            return "https".equals(u.getScheme())
                    && "raw.githubusercontent.com".equals(u.getHost())
                    && u.getPort() == -1
                    && u.getRawUserInfo() == null
                    && u.getRawQuery() == null
                    && u.getRawFragment() == null;
        } catch (Exception badUri) {
            return false;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asObject(Object value, String code) {
        if (!(value instanceof Map)) throw new SecurityException(code);
        return (Map<String, Object>) value;
    }

    private static String asString(Object value, String code) {
        if (!(value instanceof String)) throw new SecurityException(code);
        return (String) value;
    }

    private static long asExactLong(Object value, String code) {
        if (!(value instanceof Long)) throw new SecurityException(code);
        return ((Long) value).longValue();
    }

    /** Minimal strict RFC 8259 JSON parser (rejects duplicate object keys, trailing garbage, and deep nesting). */
    private static final class JsonParser {
        private static final int MAX_DEPTH = 16;
        private final String s;
        private int pos;

        JsonParser(String s) {
            this.s = s;
        }

        Object parse() {
            skipWs();
            Object v = parseValue(0);
            skipWs();
            if (pos != s.length()) throw new SecurityException("pins-json");
            return v;
        }

        private Object parseValue(int depth) {
            if (depth > MAX_DEPTH) throw new SecurityException("pins-json");
            skipWs();
            if (pos >= s.length()) throw new SecurityException("pins-json");
            char c = s.charAt(pos);
            if (c == '{') return parseObject(depth + 1);
            if (c == '[') return parseArray(depth + 1);
            if (c == '"') return parseString();
            if (c == 't') { expectLiteral("true"); return Boolean.TRUE; }
            if (c == 'f') { expectLiteral("false"); return Boolean.FALSE; }
            if (c == 'n') { expectLiteral("null"); return null; }
            if (c == '-' || (c >= '0' && c <= '9')) return parseNumber();
            throw new SecurityException("pins-json");
        }

        private Map<String, Object> parseObject(int depth) {
            pos++; // '{'
            skipWs();
            Map<String, Object> map = new LinkedHashMap<>();
            if (pos < s.length() && s.charAt(pos) == '}') {
                pos++;
                return map;
            }
            while (true) {
                skipWs();
                if (pos >= s.length() || s.charAt(pos) != '"') throw new SecurityException("pins-json");
                String key = parseString();
                if (map.containsKey(key)) throw new SecurityException("pins-duplicate-key");
                skipWs();
                if (pos >= s.length() || s.charAt(pos) != ':') throw new SecurityException("pins-json");
                pos++;
                Object val = parseValue(depth);
                map.put(key, val);
                skipWs();
                if (pos >= s.length()) throw new SecurityException("pins-json");
                char sep = s.charAt(pos++);
                if (sep == '}') return map;
                if (sep != ',') throw new SecurityException("pins-json");
            }
        }

        private List<Object> parseArray(int depth) {
            pos++; // '['
            skipWs();
            List<Object> list = new ArrayList<>();
            if (pos < s.length() && s.charAt(pos) == ']') {
                pos++;
                return list;
            }
            while (true) {
                list.add(parseValue(depth));
                skipWs();
                if (pos >= s.length()) throw new SecurityException("pins-json");
                char sep = s.charAt(pos++);
                if (sep == ']') return list;
                if (sep != ',') throw new SecurityException("pins-json");
            }
        }

        private String parseString() {
            pos++; // '"'
            StringBuilder out = new StringBuilder();
            while (pos < s.length()) {
                char c = s.charAt(pos++);
                if (c == '"') return out.toString();
                if (c < 0x20) throw new SecurityException("pins-json");
                if (c == '\\') {
                    if (pos >= s.length()) throw new SecurityException("pins-json");
                    char esc = s.charAt(pos++);
                    switch (esc) {
                        case '"': out.append('"'); break;
                        case '\\': out.append('\\'); break;
                        case '/': out.append('/'); break;
                        case 'b': out.append('\b'); break;
                        case 'f': out.append('\f'); break;
                        case 'n': out.append('\n'); break;
                        case 'r': out.append('\r'); break;
                        case 't': out.append('\t'); break;
                        case 'u':
                            if (pos + 4 > s.length()) throw new SecurityException("pins-json");
                            String hex = s.substring(pos, pos + 4);
                            if (!hex.matches("[0-9a-fA-F]{4}")) throw new SecurityException("pins-json");
                            out.append((char) Integer.parseInt(hex, 16));
                            pos += 4;
                            break;
                        default:
                            throw new SecurityException("pins-json");
                    }
                } else {
                    out.append(c);
                }
            }
            throw new SecurityException("pins-json");
        }

        private Number parseNumber() {
            int start = pos;
            if (s.charAt(pos) == '-') pos++;
            if (pos >= s.length()) throw new SecurityException("pins-json");
            char first = s.charAt(pos);
            if (first == '0') {
                pos++;
            } else if (first >= '1' && first <= '9') {
                while (pos < s.length() && s.charAt(pos) >= '0' && s.charAt(pos) <= '9') pos++;
            } else {
                throw new SecurityException("pins-json");
            }
            boolean decimal = false;
            if (pos < s.length() && s.charAt(pos) == '.') {
                decimal = true;
                pos++;
                int fracStart = pos;
                while (pos < s.length() && s.charAt(pos) >= '0' && s.charAt(pos) <= '9') pos++;
                if (pos == fracStart) throw new SecurityException("pins-json");
            }
            if (pos < s.length() && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                decimal = true;
                pos++;
                if (pos < s.length() && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) pos++;
                int expStart = pos;
                while (pos < s.length() && s.charAt(pos) >= '0' && s.charAt(pos) <= '9') pos++;
                if (pos == expStart) throw new SecurityException("pins-json");
            }
            String num = s.substring(start, pos);
            try {
                if (decimal) return Double.valueOf(num);
                return Long.valueOf(num);
            } catch (NumberFormatException bad) {
                throw new SecurityException("pins-json");
            }
        }

        private void expectLiteral(String literal) {
            if (!s.startsWith(literal, pos)) throw new SecurityException("pins-json");
            pos += literal.length();
        }

        private void skipWs() {
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\r' || c == '\n') pos++;
                else break;
            }
        }
    }
}
