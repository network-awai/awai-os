package network.awai.platform;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;
import org.json.JSONObject;

/** Independent scope checks over real, synthetic RSA-signed pointer envelopes. */
public final class ClosedStoreFeedChecks {
    private static final String REVISION = "0123456789abcdef0123456789abcdef01234567";
    private static final String YOTEI = "network.itonami.yotei";
    private static final byte[] CATALOG = {1, 2, 3};
    private static final byte[] APK = {4, 5, 6};

    private ClosedStoreFeedChecks() { }

    public static int run() throws Exception {
        LatestPointer.Feed qa = LatestPointer.Feed.CLOSED_QA;
        LatestPointer.Feed product = LatestPointer.Feed.PUBLIC;
        if (LatestPointer.Feed.forPackage("network.awai.store") != product
                || LatestPointer.Feed.forPackage("network.awai.store.p2p.preview") != product
                || LatestPointer.Feed.forPackage("network.awai.store.qa") != qa
                || !LatestPointer.URL.equals(product.pointerUrl())
                || !StoreTrust.URL.equals(product.keysUrl())) throw new AssertionError("feed selection");

        long now = System.currentTimeMillis() / 1000;
        KeyPairGenerator rsa = KeyPairGenerator.getInstance("RSA");
        rsa.initialize(2048);
        KeyPair qaRoot = rsa.generateKeyPair(), qaPointer = rsa.generateKeyPair(), qaCatalog = rsa.generateKeyPair();
        KeyPair publicRoot = rsa.generateKeyPair(), publicPointer = rsa.generateKeyPair(), publicCatalog = rsa.generateKeyPair();
        KeyList qaKeys = keyList(qaRoot, qaPointer, qaCatalog, now);
        KeyList publicKeys = keyList(publicRoot, publicPointer, publicCatalog, now);

        byte[] approvedQA = envelope(qa.distribution(REVISION), qaPointer, now);
        byte[] approvedPublic = envelope(product.distribution(REVISION), publicPointer, now);
        LatestPointer verified = LatestPointer.verifyEnvelope(approvedQA, qaKeys, now, 1, qa);
        verified.checkCatalog(CATALOG);
        verified.checkApk(YOTEI, APK);
        LatestPointer.verifyEnvelope(approvedPublic, publicKeys, now, 1);
        rejects("pointer-signature", () -> LatestPointer.verifyEnvelope(approvedQA, publicKeys, now, 1));
        rejects("pointer-signature", () -> LatestPointer.verifyEnvelope(approvedPublic, qaKeys, now, 1, qa));
        // A correctly signed pointer still cannot switch the configured origin.
        rejects("pointer-url", () -> LatestPointer.verifyEnvelope(approvedQA, qaKeys, now, 1));
        rejects("pointer-url", () -> LatestPointer.verifyEnvelope(approvedPublic, publicKeys, now, 1, qa));
        rejects("pointer-url", () -> LatestPointer.verifyEnvelope(
                envelope(qa.distribution(REVISION).replace(".invalid/", ".invalid:443/"), qaPointer, now),
                qaKeys, now, 1, qa));
        rejects("pointer-url", () -> LatestPointer.verifyEnvelope(
                envelope(qa.distribution(REVISION) + "../", qaPointer, now), qaKeys, now, 1, qa));
        rejects("pointer-rollback", () -> LatestPointer.verifyEnvelope(approvedQA, qaKeys, now, 2, qa));
        rejects("pointer-expired", () -> LatestPointer.verifyEnvelope(approvedQA, qaKeys, now + 600, 1, qa));
        rejects("pointer-apk", () -> verified.checkApk(YOTEI, new byte[] {4, 5, 7}));
        return 14;
    }

    private static KeyList keyList(KeyPair root, KeyPair pointer, KeyPair catalog, long now) throws Exception {
        Base64.Encoder base64 = Base64.getEncoder();
        byte[] raw = ("itonami.store.keys.v1\nsequence 1\nissued " + (now - 10) + "\nexpires " + (now + 600)
                + "\nkey catalog " + base64.encodeToString(catalog.getPublic().getEncoded())
                + "\nkey pointer " + base64.encodeToString(pointer.getPublic().getEncoded()) + "\n")
                .getBytes(StandardCharsets.US_ASCII);
        return KeyList.verify(raw, sign(root, raw), root.getPublic().getEncoded(), now, 0);
    }

    private static byte[] envelope(String base, KeyPair signer, long now) throws Exception {
        JSONObject pins = new JSONObject().put("revision", REVISION)
                .put("catalog", pin(base + "catalog.json", CATALOG))
                .put("apks", new JSONObject().put(YOTEI, pin(base + "yotei.apk", APK)));
        String raw = new JSONObject().put("schema", LatestPointer.SCHEMA).put("sequence", 1)
                .put("issuedAt", now - 10).put("expiresAt", now + 600).put("pins", pins).toString();
        return new JSONObject().put("raw", raw).put("signature", Base64.getEncoder().encodeToString(
                sign(signer, raw.getBytes(StandardCharsets.UTF_8)))).toString().getBytes(StandardCharsets.UTF_8);
    }

    private static JSONObject pin(String url, byte[] payload) throws Exception {
        return new JSONObject().put("url", url).put("sha256", Integrity.sha256(payload)).put("maxBytes", payload.length);
    }

    private static byte[] sign(KeyPair pair, byte[] bytes) throws Exception {
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(pair.getPrivate());
        signer.update(bytes);
        return signer.sign();
    }

    private interface Attempt { void run() throws Exception; }

    private static void rejects(String code, Attempt attempt) throws Exception {
        try {
            attempt.run();
            throw new AssertionError("Expected " + code);
        } catch (SecurityException failure) {
            if (!code.equals(failure.getMessage())) throw failure;
        }
    }
}
