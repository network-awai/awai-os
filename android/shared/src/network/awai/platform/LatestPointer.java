package network.awai.platform;

import org.json.JSONObject;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The signed pointer to the newest Store catalog (AWAI-3653, step 3).
 *
 * <p>The pointer lives at one fixed, mutable location ({@link #URL}). Nothing in it is trusted until
 * a key listed for the pointer role in the Store's key list signed it (AWAI-3775), its sequence is not below the highest one
 * this host has accepted, it has not expired, and every pin is an exact, commit-pinned URL under
 * this repository's {@code store/distribution/} with a digest and a byte ceiling. The pins have the
 * same shape as {@code android/online-pins.dev.json}. Verification grants nothing: fetching still
 * needs the person's standing update approval or a per-operation approval.
 */
public final class LatestPointer {
    public static final String SCHEMA = "itonami.store.latest.v1";
    public static final String URL =
            "https://raw.githubusercontent.com/network-awai/awai-os/main/store/latest/pointer-envelope.json";
    public static final int MAX_ENVELOPE_BYTES = 16384;
    public static final int MAX_RAW_CHARS = 12288;
    public static final long MAX_LIFETIME_SECONDS = 31L * 24 * 60 * 60;
    public static final long CLOCK_SKEW_SECONDS = 300;
    public static final int MAX_CATALOG_BYTES = 131072;
    public static final int MAX_APPS = 64;

    public static final class Pin {
        public final String url;
        public final String sha256;
        public final long maxBytes;
        Pin(String url, String sha256, long maxBytes) { this.url = url; this.sha256 = sha256; this.maxBytes = maxBytes; }
    }

    public final long sequence;
    public final long issuedAt;
    public final long expiresAt;
    public final String revision;
    public final Pin catalog;
    public final Map<String, Pin> apks;

    private LatestPointer(long sequence, long issuedAt, long expiresAt, String revision, Pin catalog, Map<String, Pin> apks) {
        this.sequence = sequence; this.issuedAt = issuedAt; this.expiresAt = expiresAt;
        this.revision = revision; this.catalog = catalog; this.apks = apks;
    }

    /** Verifies the envelope bytes as fetched from {@link #URL}. */
    public static LatestPointer verifyEnvelope(byte[] envelope, KeyList keys, long now, long sequenceFloor) throws Exception {
        if (envelope == null || envelope.length > MAX_ENVELOPE_BYTES) throw new SecurityException("pointer-size");
        JSONObject e = new JSONObject(new String(envelope, StandardCharsets.UTF_8));
        if (e.length() != 2) throw new SecurityException("pointer-shape");
        String raw = e.getString("raw"), signature = e.getString("signature");
        if (raw.length() > MAX_RAW_CHARS || signature.length() > 8192) throw new SecurityException("pointer-size");
        return verify(raw.getBytes(StandardCharsets.UTF_8), java.util.Base64.getMimeDecoder().decode(signature), keys, now, sequenceFloor);
    }

    public static LatestPointer verify(byte[] raw, byte[] signature, KeyList keys, long now, long sequenceFloor) throws Exception {
        if (raw == null || raw.length > MAX_RAW_CHARS * 4) throw new SecurityException("pointer-size");
        if (!keys.authentic(KeyList.POINTER, raw, signature)) throw new SecurityException("pointer-signature");
        JSONObject v = new JSONObject(new String(raw, StandardCharsets.UTF_8));
        if (!SCHEMA.equals(v.getString("schema"))) throw new SecurityException("pointer-schema");
        long sequence = exactLong(v, "sequence"), issuedAt = exactLong(v, "issuedAt"), expiresAt = exactLong(v, "expiresAt");
        if (sequence < 1 || sequence < sequenceFloor) throw new SecurityException("pointer-rollback");
        if (issuedAt < 1 || issuedAt > now + CLOCK_SKEW_SECONDS) throw new SecurityException("pointer-issued");
        if (expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_SECONDS)
            throw new SecurityException("pointer-expired");
        JSONObject pins = v.getJSONObject("pins");
        String revision = pins.getString("revision");
        if (!revision.matches("[0-9a-f]{40}")) throw new SecurityException("pointer-revision");
        Pin catalog = pin(pins.getJSONObject("catalog"), revision, MAX_CATALOG_BYTES);
        JSONObject apkPins = pins.getJSONObject("apks");
        if (apkPins.length() < 1 || apkPins.length() > MAX_APPS) throw new SecurityException("pointer-apps");
        Map<String, Pin> apks = new LinkedHashMap<>();
        for (Iterator<String> ids = apkPins.keys(); ids.hasNext(); ) {
            String id = ids.next();
            int budget = Catalog.maxApkBytes(id); // unknown ids refuse
            apks.put(id, pin(apkPins.getJSONObject(id), revision, budget));
        }
        return new LatestPointer(sequence, issuedAt, expiresAt, revision, catalog, Collections.unmodifiableMap(apks));
    }

    /** The fetched catalog envelope must be exactly the pinned bytes. */
    public void checkCatalog(byte[] bytes) throws Exception { check(catalog, bytes, "pointer-catalog"); }

    /** A fetched APK must be exactly the pinned bytes for that app. */
    public void checkApk(String id, byte[] bytes) throws Exception {
        Pin p = apks.get(id);
        if (p == null) throw new SecurityException("pointer-unlisted-app");
        check(p, bytes, "pointer-apk");
    }

    private static void check(Pin p, byte[] bytes, String code) throws Exception {
        if (bytes == null || bytes.length < 1 || bytes.length > p.maxBytes || !Integrity.sha256(bytes).equals(p.sha256))
            throw new SecurityException(code);
    }

    private static Pin pin(JSONObject p, String revision, long ceiling) throws Exception {
        String url = p.getString("url"), sha = p.getString("sha256");
        long maxBytes = exactLong(p, "maxBytes");
        URI u = new URI(url);
        if (!"https".equals(u.getScheme()) || !"raw.githubusercontent.com".equals(u.getHost()) || u.getPort() != -1
                || u.getRawUserInfo() != null || u.getRawQuery() != null || u.getRawFragment() != null
                || !url.startsWith("https://raw.githubusercontent.com/network-awai/awai-os/" + revision + "/store/distribution/")
                || url.contains("/../") || url.contains("/./") || url.contains("%") || url.contains("\\"))
            throw new SecurityException("pointer-url");
        if (!sha.matches("[0-9a-f]{64}")) throw new SecurityException("pointer-digest");
        if (maxBytes < 1 || maxBytes > ceiling) throw new SecurityException("pointer-budget");
        return new Pin(url, sha, maxBytes);
    }

    private static long exactLong(JSONObject o, String key) throws Exception {
        Object x = o.get(key);
        if (!(x instanceof Integer) && !(x instanceof Long)) throw new SecurityException("pointer-number");
        return ((Number) x).longValue();
    }

    private LatestPointer() { throw new AssertionError(); }
}
