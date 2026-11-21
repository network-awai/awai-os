package network.awai.platform;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;
import org.json.JSONObject;
import java.io.FileNotFoundException;
import java.nio.charset.StandardCharsets;

/**
 * Which keys this Store trusts for its catalog and its latest pointer (AWAI-3775).
 *
 * <p>The package bundles the root public key ({@code store-root.der}) and a root-signed key list
 * ({@code keys.txt}, {@code keys.sig}). A newer list fetched from {@link #URL} is kept in private
 * storage after it verifies against the same root. The host remembers the highest list sequence it has
 * accepted and refuses any list below it, bundled or fetched. Verification grants nothing: fetching the
 * list needs the same standing update approval as the pointer.
 *
 * <p>A package built without a root (before AWAI-3775 step 3) still pins one key in
 * {@code catalog-key.der}; {@link KeyList#legacy} covers it until every build bundles a list.
 */
public final class StoreTrust {
    public static final String URL =
            "https://raw.githubusercontent.com/network-awai/awai-os/main/store/latest/keys-envelope.json";
    public static final int MAX_ENVELOPE_BYTES = 32768;
    static final String PREFS = "store-keys";

    /** The list to use now. Records its sequence as the floor when it is higher than the saved one. */
    public static KeyList load(Context c) throws Exception {
        AssetManager assets = c.getAssets();
        byte[] root;
        try { root = Integrity.read(assets.open("store-root.der"), 4096); }
        catch (FileNotFoundException legacyBuild) {
            return KeyList.legacy(Integrity.read(assets.open("catalog-key.der"), 4096));
        }
        byte[] raw = Integrity.read(assets.open("keys.txt"), KeyList.MAX_BYTES);
        byte[] sig = Integrity.read(assets.open("keys.sig"), 4096);
        SharedPreferences p = c.getSharedPreferences(PREFS, 0);
        long floor = p.getLong("highest", 0);
        byte[] savedRaw = decode(p.getString("raw", null)), savedSig = decode(p.getString("signature", null));
        KeyList k = KeyList.choose(raw, sig, savedRaw, savedSig, root, System.currentTimeMillis() / 1000, floor);
        if (k.sequence > floor) p.edit().putLong("highest", k.sequence).commit();
        return k;
    }

    /**
     * Verifies a fetched list envelope ({@code {"raw": "...", "signature": "base64"}}) against the bundled root
     * and the saved floor, and keeps it when its sequence is above the one in use. Returns the list in use.
     */
    public static KeyList admit(Context c, byte[] envelope) throws Exception {
        if (envelope == null || envelope.length > MAX_ENVELOPE_BYTES) throw new SecurityException("keys-size");
        KeyList current = load(c);
        if (!current.rooted()) throw new SecurityException("keys-legacy-build");
        JSONObject e = new JSONObject(new String(envelope, StandardCharsets.UTF_8));
        if (e.length() != 2) throw new SecurityException("keys-shape");
        byte[] raw = e.getString("raw").getBytes(StandardCharsets.US_ASCII);
        byte[] sig = java.util.Base64.getMimeDecoder().decode(e.getString("signature"));
        byte[] root = Integrity.read(c.getAssets().open("store-root.der"), 4096);
        SharedPreferences p = c.getSharedPreferences(PREFS, 0);
        KeyList fetched = KeyList.verify(raw, sig, root, System.currentTimeMillis() / 1000, p.getLong("highest", 0));
        if (fetched.sequence <= current.sequence) return current;
        if (!p.edit().putString("raw", encode(fetched.raw())).putString("signature", encode(fetched.signature()))
                .putLong("highest", fetched.sequence).commit()) throw new SecurityException("keys-store");
        return fetched;
    }

    private static byte[] decode(String s) { return s == null ? null : java.util.Base64.getDecoder().decode(s); }
    private static String encode(byte[] b) { return java.util.Base64.getEncoder().encodeToString(b); }

    private StoreTrust() { }
}
