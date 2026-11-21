package network.awai.platform;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The signed list of the keys that may sign the Store's catalog and its latest pointer (AWAI-3774).
 *
 * <p>A host pins one root public key. The root signs this list; the catalog and the pointer are then
 * accepted only when a key listed here for that role signed them. Replacing or withdrawing a role
 * key is a new list with a higher sequence: the host keeps the highest sequence it has accepted and
 * refuses anything below it. APK signers are not in this list; Android checks those itself.
 *
 * <p>The signed bytes are plain ASCII lines, each ended by one LF, in exactly this order:
 * <pre>
 * itonami.store.keys.v1
 * sequence N
 * issued UNIX_SECONDS
 * expires UNIX_SECONDS
 * key catalog BASE64_SPKI      (1 to {@link #MAX_KEYS_PER_ROLE} lines)
 * key pointer BASE64_SPKI      (1 to {@link #MAX_KEYS_PER_ROLE} lines)
 * </pre>
 * Keys are RSA public keys of at least {@link #MIN_KEY_BITS} bits as X.509 SubjectPublicKeyInfo DER,
 * in standard base64 without line breaks. Verification grants nothing by itself: fetching and
 * installing still need the person's approval.
 *
 * <p>No Android API is used here, so the class is tested on a plain JVM
 * ({@code bash android/tests/key-list.sh}). Nothing calls it yet.
 */
public final class KeyList {
    public static final String SCHEMA = "itonami.store.keys.v1";
    public static final String CATALOG = "catalog", POINTER = "pointer";
    public static final int MAX_BYTES = 16384;
    public static final int MAX_KEYS_PER_ROLE = 4;
    public static final int MIN_KEY_BITS = 2048;
    public static final long MAX_LIFETIME_SECONDS = 190L * 24 * 60 * 60;
    public static final long CLOCK_SKEW_SECONDS = 300;

    public final long sequence, issuedAt, expiresAt;
    private final Map<String, List<byte[]>> keys;

    private KeyList(long sequence, long issuedAt, long expiresAt, Map<String, List<byte[]>> keys) {
        this.sequence = sequence; this.issuedAt = issuedAt; this.expiresAt = expiresAt; this.keys = keys;
    }

    /**
     * Verifies the list. Every refusal is a {@link SecurityException} whose message is one of:
     * keys-size, keys-signature, keys-format, keys-schema, keys-number, keys-rollback, keys-issued,
     * keys-expired, keys-role, keys-count, keys-key, keys-duplicate.
     */
    public static KeyList verify(byte[] raw, byte[] signature, byte[] rootSpki, long now, long sequenceFloor) throws Exception {
        if (raw == null || raw.length < 1 || raw.length > MAX_BYTES || signature == null || rootSpki == null)
            throw new SecurityException("keys-size");
        boolean signed;
        RSAPublicKey root = rsa(rootSpki);
        try { signed = root != null && root.getModulus().bitLength() >= MIN_KEY_BITS && Integrity.authentic(raw, signature, rootSpki); }
        catch (SecurityException e) { throw new SecurityException("keys-signature"); }
        catch (java.security.GeneralSecurityException e) { signed = false; }
        if (!signed) throw new SecurityException("keys-signature");
        for (byte b : raw) if (b != '\n' && (b < 0x20 || b > 0x7e)) throw new SecurityException("keys-format");
        if (raw[raw.length - 1] != '\n') throw new SecurityException("keys-format");
        String[] lines = new String(raw, 0, raw.length - 1, StandardCharsets.US_ASCII).split("\n", -1);
        if (lines.length < 4) throw new SecurityException("keys-format");
        if (!SCHEMA.equals(lines[0])) throw new SecurityException("keys-schema");
        long sequence = number(lines[1], "sequence "), issuedAt = number(lines[2], "issued "), expiresAt = number(lines[3], "expires ");
        if (sequence < 1 || sequence < sequenceFloor) throw new SecurityException("keys-rollback");
        if (issuedAt < 1 || issuedAt > now + CLOCK_SKEW_SECONDS) throw new SecurityException("keys-issued");
        if (expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_SECONDS)
            throw new SecurityException("keys-expired");
        Map<String, List<byte[]>> keys = new LinkedHashMap<>();
        keys.put(CATALOG, new ArrayList<byte[]>()); keys.put(POINTER, new ArrayList<byte[]>());
        Set<String> seen = new HashSet<>();
        String previous = CATALOG;
        for (int i = 4; i < lines.length; i++) {
            String[] part = lines[i].split(" ", -1);
            if (part.length != 3 || !"key".equals(part[0])) throw new SecurityException("keys-format");
            String role = part[1];
            // Catalog keys first, then pointer keys: one spelling per list.
            if (!keys.containsKey(role) || (CATALOG.equals(role) && POINTER.equals(previous))) throw new SecurityException("keys-role");
            previous = role;
            byte[] spki;
            try { spki = Base64.getDecoder().decode(part[2]); } catch (IllegalArgumentException e) { throw new SecurityException("keys-key"); }
            if (!Base64.getEncoder().encodeToString(spki).equals(part[2])) throw new SecurityException("keys-key");
            RSAPublicKey key = rsa(spki);
            if (key == null || key.getModulus().bitLength() < MIN_KEY_BITS) throw new SecurityException("keys-key");
            // One key, one role: a key listed twice, in the same role or in both, is refused.
            if (!seen.add(Integrity.sha256(spki))) throw new SecurityException("keys-duplicate");
            if (java.util.Arrays.equals(spki, rootSpki)) throw new SecurityException("keys-duplicate");
            keys.get(role).add(spki);
        }
        for (List<byte[]> role : keys.values())
            if (role.isEmpty() || role.size() > MAX_KEYS_PER_ROLE) throw new SecurityException("keys-count");
        for (Map.Entry<String, List<byte[]>> e : keys.entrySet()) e.setValue(Collections.unmodifiableList(e.getValue()));
        return new KeyList(sequence, issuedAt, expiresAt, Collections.unmodifiableMap(keys));
    }

    /** True when a key listed for this role signed the data. Unknown roles are never authentic. */
    public boolean authentic(String role, byte[] data, byte[] signature) {
        List<byte[]> listed = keys.get(role);
        if (listed == null || data == null || signature == null) return false;
        for (byte[] spki : listed) {
            try { if (Integrity.authentic(data, signature, spki)) return true; }
            catch (java.security.GeneralSecurityException ignored) { /* a malformed signature is simply not authentic */ }
        }
        return false;
    }

    /** SHA-256 of each listed key's SubjectPublicKeyInfo, for display and logs. */
    public List<String> fingerprints(String role) throws Exception {
        List<String> out = new ArrayList<>();
        List<byte[]> listed = keys.get(role);
        if (listed != null) for (byte[] spki : listed) out.add(Integrity.sha256(spki));
        return out;
    }

    private static RSAPublicKey rsa(byte[] spki) {
        try {
            PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(spki));
            return key instanceof RSAPublicKey ? (RSAPublicKey) key : null;
        } catch (java.security.GeneralSecurityException e) { return null; }
    }

    private static long number(String line, String prefix) {
        if (!line.startsWith(prefix)) throw new SecurityException("keys-format");
        String digits = line.substring(prefix.length());
        // Plain decimal, no sign, no leading zero, at most 15 digits.
        if (!digits.matches("[1-9][0-9]{0,14}")) throw new SecurityException("keys-number");
        return Long.parseLong(digits);
    }
}
