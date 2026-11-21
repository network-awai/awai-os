import network.awai.platform.KeyList;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Plain JVM tests for KeyList (AWAI-3774). Run: bash android/tests/key-list.sh */
public final class KeyListTest {
    static int failures = 0, checks = 0;
    static final long NOW = 1_800_000_000L, DAY = 86_400L;

    static KeyPair pair(int bits) throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA"); g.initialize(bits); return g.generateKeyPair();
    }
    static byte[] sign(KeyPair k, byte[] data) throws Exception {
        Signature s = Signature.getInstance("SHA256withRSA"); s.initSign(k.getPrivate()); s.update(data); return s.sign();
    }
    static String b64(KeyPair k) { return Base64.getEncoder().encodeToString(k.getPublic().getEncoded()); }
    static byte[] ascii(String s) { return s.getBytes(StandardCharsets.US_ASCII); }
    static String list(long seq, long issued, long expires, String... keyLines) {
        StringBuilder s = new StringBuilder("itonami.store.keys.v1\nsequence " + seq + "\nissued " + issued + "\nexpires " + expires + "\n");
        for (String k : keyLines) s.append(k).append('\n');
        return s.toString();
    }
    static String cat(KeyPair k) { return "key catalog " + b64(k); }
    static String ptr(KeyPair k) { return "key pointer " + b64(k); }

    static void ok(String name, boolean condition) {
        checks++;
        if (condition) System.out.println("ok   " + name); else { failures++; System.out.println("FAIL " + name); }
    }
    /** The list must be refused with exactly this code. */
    static void refuse(String name, String code, byte[] raw, byte[] sig, KeyPair root, long now, long floor) {
        checks++;
        try {
            KeyList.verify(raw, sig, root.getPublic().getEncoded(), now, floor);
            failures++; System.out.println("FAIL " + name + ": accepted, want " + code);
        } catch (SecurityException e) {
            if (code.equals(e.getMessage())) System.out.println("ok   " + name + " -> " + code);
            else { failures++; System.out.println("FAIL " + name + ": got " + e.getMessage() + ", want " + code); }
        } catch (Exception e) { failures++; System.out.println("FAIL " + name + ": " + e); }
    }
    static void refuse(String name, String code, String body, KeyPair root) throws Exception {
        refuse(name, code, ascii(body), sign(root, ascii(body)), root, NOW, 0);
    }

    static void chooseRefuse(String name, String code, byte[] br, byte[] bs, byte[] sr, byte[] ss, byte[] root, long floor) {
        checks++;
        try { KeyList.choose(br, bs, sr, ss, root, NOW, floor); failures++; System.out.println("FAIL " + name + ": accepted, want " + code); }
        catch (SecurityException e) {
            if (code.equals(e.getMessage())) System.out.println("ok   " + name + " -> " + code);
            else { failures++; System.out.println("FAIL " + name + ": got " + e.getMessage() + ", want " + code); }
        } catch (Exception e) { failures++; System.out.println("FAIL " + name + ": " + e); }
    }
    public static void main(String[] args) throws Exception {
        KeyPair root = pair(2048), other = pair(2048), c1 = pair(2048), c2 = pair(2048), p1 = pair(2048), weak = pair(1024);
        long issued = NOW - DAY, expires = NOW + 90 * DAY;
        String good = list(3, issued, expires, cat(c1), ptr(p1));
        byte[] goodSig = sign(root, ascii(good));
        byte[] rootKey = root.getPublic().getEncoded();
        byte[] catalog = ascii("{\"schema\":\"itonami.store.bundled.v1\"}"), pointer = ascii("{\"schema\":\"itonami.store.latest.v1\"}");

        KeyList k = KeyList.verify(ascii(good), goodSig, rootKey, NOW, 3);
        ok("a signed list is accepted at its own sequence floor", k.sequence == 3 && k.issuedAt == issued && k.expiresAt == expires);
        ok("the catalog key authenticates a catalog", k.authentic(KeyList.CATALOG, catalog, sign(c1, catalog)));
        ok("the pointer key authenticates a pointer", k.authentic(KeyList.POINTER, pointer, sign(p1, pointer)));
        ok("the catalog key does not authenticate a pointer", !k.authentic(KeyList.POINTER, pointer, sign(c1, pointer)));
        ok("the pointer key does not authenticate a catalog", !k.authentic(KeyList.CATALOG, catalog, sign(p1, catalog)));
        ok("the root key does not authenticate a catalog or a pointer",
                !k.authentic(KeyList.CATALOG, catalog, sign(root, catalog)) && !k.authentic(KeyList.POINTER, pointer, sign(root, pointer)));
        ok("an unlisted key authenticates nothing", !k.authentic(KeyList.CATALOG, catalog, sign(other, catalog)));
        ok("an altered catalog is not authentic", !k.authentic(KeyList.CATALOG, ascii("{}"), sign(c1, catalog)));
        ok("an unknown role, a null and a malformed signature are not authentic",
                !k.authentic("apk", catalog, sign(c1, catalog)) && !k.authentic(KeyList.CATALOG, catalog, null)
                        && !k.authentic(KeyList.CATALOG, catalog, new byte[] {1, 2, 3}));
        ok("fingerprints are one SHA-256 per listed key",
                k.fingerprints(KeyList.CATALOG).size() == 1 && k.fingerprints(KeyList.CATALOG).get(0).matches("[0-9a-f]{64}")
                        && !k.fingerprints(KeyList.CATALOG).equals(k.fingerprints(KeyList.POINTER)) && k.fingerprints("apk").isEmpty());

        // Rotation: both keys during the overlap, then only the new one.
        String overlap = list(4, issued, expires, cat(c1), cat(c2), ptr(p1));
        KeyList both = KeyList.verify(ascii(overlap), sign(root, ascii(overlap)), rootKey, NOW, 3);
        ok("during an overlap both catalog keys are accepted",
                both.authentic(KeyList.CATALOG, catalog, sign(c1, catalog)) && both.authentic(KeyList.CATALOG, catalog, sign(c2, catalog)));
        String rotated = list(5, issued, expires, cat(c2), ptr(p1));
        KeyList after = KeyList.verify(ascii(rotated), sign(root, ascii(rotated)), rootKey, NOW, 4);
        ok("after rotation the withdrawn key authenticates nothing",
                !after.authentic(KeyList.CATALOG, catalog, sign(c1, catalog)) && after.authentic(KeyList.CATALOG, catalog, sign(c2, catalog)));
        refuse("the list from before the rotation is refused once the newer one was accepted", "keys-rollback", ascii(good), goodSig, root, NOW, 5);

        // Signature.
        refuse("a list signed by another key", "keys-signature", ascii(good), sign(other, ascii(good)), root, NOW, 0);
        refuse("a list signed by its own catalog key", "keys-signature", ascii(good), sign(c1, ascii(good)), root, NOW, 0);
        String altered = good.replace("sequence 3", "sequence 9");
        refuse("an altered list with the old signature", "keys-signature", ascii(altered), goodSig, root, NOW, 0);
        refuse("an empty signature", "keys-signature", ascii(good), new byte[0], root, NOW, 0);
        checks++;
        try { KeyList.verify(ascii(good), sign(weak, ascii(good)), weak.getPublic().getEncoded(), NOW, 0); failures++; System.out.println("FAIL a 1024-bit root"); }
        catch (SecurityException e) { if ("keys-signature".equals(e.getMessage())) System.out.println("ok   a 1024-bit root -> keys-signature"); else { failures++; System.out.println("FAIL a 1024-bit root: " + e.getMessage()); } }
        checks++;
        try { KeyList.verify(ascii(good), goodSig, new byte[] {1, 2, 3}, NOW, 0); failures++; System.out.println("FAIL a root that is not a key"); }
        catch (SecurityException e) { if ("keys-signature".equals(e.getMessage())) System.out.println("ok   a root that is not a key -> keys-signature"); else { failures++; System.out.println("FAIL a root that is not a key: " + e.getMessage()); } }

        // Time and sequence.
        refuse("an expired list", "keys-expired", ascii(good), goodSig, root, expires, 0);
        refuse("a list issued in the future", "keys-issued", ascii(good), goodSig, root, issued - 301, 0);
        ok("a list issued within the clock skew is accepted", KeyList.verify(ascii(good), goodSig, rootKey, issued - 300, 0).sequence == 3);
        refuse("a lifetime above the limit", "keys-expired", list(3, issued, issued + KeyList.MAX_LIFETIME_SECONDS + 1, cat(c1), ptr(p1)), root);
        ok("a lifetime at the limit is accepted", KeyList.verify(ascii(list(3, issued, issued + KeyList.MAX_LIFETIME_SECONDS, cat(c1), ptr(p1))),
                sign(root, ascii(list(3, issued, issued + KeyList.MAX_LIFETIME_SECONDS, cat(c1), ptr(p1)))), rootKey, NOW, 0).sequence == 3);
        refuse("expiry before issue", "keys-expired", list(3, NOW + 100, NOW + 50, cat(c1), ptr(p1)), root);
        refuse("sequence zero", "keys-number", list(0, issued, expires, cat(c1), ptr(p1)), root);
        refuse("a sequence below the floor", "keys-rollback", ascii(good), goodSig, root, NOW, 4);

        // Keys and roles.
        refuse("no pointer key", "keys-count", list(3, issued, expires, cat(c1)), root);
        refuse("no catalog key", "keys-count", list(3, issued, expires, ptr(p1)), root);
        refuse("no key at all", "keys-count", list(3, issued, expires), root);
        KeyPair[] many = {pair(2048), pair(2048), pair(2048), pair(2048)};
        refuse("five catalog keys", "keys-count", list(3, issued, expires, cat(c1), cat(many[0]), cat(many[1]), cat(many[2]), cat(many[3]), ptr(p1)), root);
        ok("four catalog keys are accepted", KeyList.verify(ascii(list(3, issued, expires, cat(c1), cat(many[0]), cat(many[1]), cat(many[2]), ptr(p1))),
                sign(root, ascii(list(3, issued, expires, cat(c1), cat(many[0]), cat(many[1]), cat(many[2]), ptr(p1)))), rootKey, NOW, 0).fingerprints(KeyList.CATALOG).size() == 4);
        refuse("an unknown role", "keys-role", list(3, issued, expires, cat(c1), ptr(p1), "key apk " + b64(c2)), root);
        refuse("a catalog key after a pointer key", "keys-role", list(3, issued, expires, ptr(p1), cat(c1)), root);
        refuse("the same key in both roles", "keys-duplicate", list(3, issued, expires, cat(c1), ptr(c1)), root);
        refuse("the same key twice in one role", "keys-duplicate", list(3, issued, expires, cat(c1), cat(c1), ptr(p1)), root);
        refuse("the root key listed as a role key", "keys-duplicate", list(3, issued, expires, cat(root), ptr(p1)), root);
        refuse("a 1024-bit role key", "keys-key", list(3, issued, expires, cat(weak), ptr(p1)), root);
        refuse("a key that is not base64", "keys-key", list(3, issued, expires, "key catalog not*base64", ptr(p1)), root);
        refuse("base64 that is not a key", "keys-key", list(3, issued, expires, "key catalog AAAA", ptr(p1)), root);
        refuse("the URL-safe base64 alphabet", "keys-key", list(3, issued, expires, "key catalog " + b64(c1).replace('+', '-').replace('/', '_'), ptr(p1)), root);
        ok("that control really changed the text", !b64(c1).equals(b64(c1).replace('+', '-').replace('/', '_')));
        refuse("base64 with stray padding", "keys-key", list(3, issued, expires, "key catalog " + b64(c1) + "====", ptr(p1)), root);
        KeyPair ec = KeyPairGenerator.getInstance("EC").generateKeyPair();
        refuse("an EC key", "keys-key", list(3, issued, expires, "key catalog " + b64(ec), ptr(p1)), root);

        // Shape of the signed bytes. Each is correctly signed by the root, so only the shape is wrong.
        refuse("another schema line", "keys-schema", good.replace("itonami.store.keys.v1", "itonami.store.keys.v2"), root);
        refuse("the catalog schema as the first line", "keys-schema", good.replace("itonami.store.keys.v1", "itonami.store.bundled.v1"), root);
        refuse("no final line feed", "keys-format", good.substring(0, good.length() - 1), root);
        refuse("a blank line at the end", "keys-format", good + "\n", root);
        refuse("CRLF line ends", "keys-format", good.replace("\n", "\r\n"), root);
        refuse("a trailing space", "keys-format", good.replace(cat(c1), cat(c1) + " "), root);
        refuse("a tab", "keys-format", good.replace("sequence 3", "sequence\t3"), root);
        refuse("header lines in another order", "keys-format", good.replace("sequence 3\nissued " + issued, "issued " + issued + "\nsequence 3"), root);
        refuse("an extra header line", "keys-format", good.replace("expires " + expires + "\n", "expires " + expires + "\nnote hello\n"), root);
        refuse("a leading zero", "keys-number", good.replace("sequence 3", "sequence 03"), root);
        refuse("a negative number", "keys-number", good.replace("sequence 3", "sequence -3"), root);
        refuse("a number with an exponent", "keys-number", good.replace("sequence 3", "sequence 3e1"), root);
        refuse("a sixteen-digit number", "keys-number", good.replace("sequence 3", "sequence 1000000000000000"), root);
        refuse("a non-ASCII byte", "keys-format", new String(ascii(good), StandardCharsets.ISO_8859_1).replace("sequence 3", "sequence 3é")
                .getBytes(StandardCharsets.ISO_8859_1), sign(root, new String(ascii(good), StandardCharsets.ISO_8859_1).replace("sequence 3", "sequence 3é")
                .getBytes(StandardCharsets.ISO_8859_1)), root, NOW, 0);
        refuse("only the schema line", "keys-format", "itonami.store.keys.v1\n", root);
        StringBuilder big = new StringBuilder(good); while (big.length() <= KeyList.MAX_BYTES) big.append("key catalog AAAA\n");
        refuse("more than the size limit", "keys-size", big.toString(), root);
        refuse("empty bytes", "keys-size", new byte[0], goodSig, root, NOW, 0);

        // choose(): the saved list and the bundled one; the valid one with the higher sequence wins (AWAI-3775).
        byte[] r = root.getPublic().getEncoded();
        String l2 = list(2, NOW - DAY, NOW + 90 * DAY, cat(c1), ptr(p1)), l3 = list(3, NOW - DAY, NOW + 90 * DAY, cat(c2), ptr(p1));
        byte[] s2 = sign(root, ascii(l2)), s3 = sign(root, ascii(l3));
        ok("choose: saved newer than bundled", KeyList.choose(ascii(l2), s2, ascii(l3), s3, r, NOW, 0).sequence == 3);
        ok("choose: bundled newer than saved", KeyList.choose(ascii(l3), s3, ascii(l2), s2, r, NOW, 0).sequence == 3);
        ok("choose: nothing saved", KeyList.choose(ascii(l2), s2, null, null, r, NOW, 0).sequence == 2);
        ok("choose: saved list with a bad signature is ignored", KeyList.choose(ascii(l2), s2, ascii(l3), s2, r, NOW, 0).sequence == 2);
        ok("choose: keeps the verified bytes", Arrays.equals(KeyList.choose(ascii(l2), s2, null, null, r, NOW, 0).raw(), ascii(l2)));
        ok("choose: new catalog key after rotation", KeyList.choose(ascii(l2), s2, ascii(l3), s3, r, NOW, 0).authentic(KeyList.CATALOG, ascii("x"), sign(c2, ascii("x")))
                && !KeyList.choose(ascii(l2), s2, ascii(l3), s3, r, NOW, 0).authentic(KeyList.CATALOG, ascii("x"), sign(c1, ascii("x"))));
        chooseRefuse("choose: bundled below the floor and nothing saved", "keys-rollback", ascii(l2), s2, null, null, r, 3);
        chooseRefuse("choose: neither verifies, bundled reason", "keys-signature", ascii(l2), s3, ascii(l3), s2, r, 0);
        chooseRefuse("choose: other root", "keys-signature", ascii(l2), s2, ascii(l3), s3, other.getPublic().getEncoded(), 0);
        chooseRefuse("choose: nothing at all", "keys-size", null, null, null, null, r, 0);
        // legacy(): the temporary single-key form used by Stores built without a list.
        KeyList legacy = KeyList.legacy(c1.getPublic().getEncoded());
        ok("legacy: one key for both roles, not rooted", !legacy.rooted() && legacy.sequence == 0 && legacy.raw() == null
                && legacy.authentic(KeyList.CATALOG, ascii("x"), sign(c1, ascii("x"))) && legacy.authentic(KeyList.POINTER, ascii("x"), sign(c1, ascii("x")))
                && !legacy.authentic(KeyList.CATALOG, ascii("x"), sign(c2, ascii("x"))));

        System.out.println(checks + " checks, " + failures + " failures");
        if (failures > 0) System.exit(1);
    }
}
