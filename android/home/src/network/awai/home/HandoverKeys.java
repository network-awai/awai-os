package network.awai.home;

import android.app.KeyguardManager;
import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;

/**
 * Android Keystore custody for the new-device key used by account handover
 * (AWAI-4071, AWAI-3004).
 *
 * <p>The private key is non-exportable P-256 inside AndroidKeyStore, mirroring
 * the pattern in {@code android/sanka/.../MainActivity.java}. This class never
 * exports the private key. Whether the key is hardware-backed is reported
 * truthfully by {@link #hardwareBacked(Context)}: the caller must check it
 * before promising hardware custody (AWAI-3004: verify the actual PC's
 * hardware-backed custody and encryption capabilities before promising them).
 * A software-backed key is still usable, but must be described as such.
 */
public final class HandoverKeys {
    static final String ALIAS = "awai.handover.device";

    private HandoverKeys() {}

    /** True only when the device has a screen lock and is currently unlocked. */
    public static boolean deviceAvailable(Context c) {
        KeyguardManager keyguard = c.getSystemService(KeyguardManager.class);
        return keyguard != null && keyguard.isDeviceSecure() && !keyguard.isDeviceLocked();
    }

    private static KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return ks;
    }

    /** Generate (if absent) and return the non-exportable P-256 pair. */
    public static KeyPair ensureKey() throws Exception {
        KeyStore ks = keyStore();
        if (!ks.containsAlias(ALIAS)) {
            KeyPairGenerator g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            g.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .build());
            g.generateKeyPair();
            // Re-read: AndroidKeyStore may hand back a different instance.
            ks = keyStore();
        }
        PrivateKey priv = (PrivateKey) ks.getKey(ALIAS, null);
        PublicKey pub = ks.getCertificate(ALIAS).getPublicKey();
        return new KeyPair(priv, pub);
    }

    /** Base64 NO_WRAP SubjectPublicKeyInfo of the handover device key. */
    public static String spki() throws Exception {
        return Base64.encodeToString(ensureKey().pub.getEncoded(), Base64.NO_WRAP);
    }

    /** Sign exactly these bytes with the non-exportable device key. */
    public static byte[] sign(byte[] message) throws Exception {
        KeyStore ks = keyStore();
        Signature s = Signature.getInstance("SHA256withECDSA");
        s.initSign((PrivateKey) ks.getKey(ALIAS, null));
        s.update(message);
        return s.sign();
    }

    /** True when this device reports a hardware-backed Keystore key. */
    public static boolean hardwareBacked(Context c) {
        try {
            ensureKey();
            KeyStore ks = keyStore();
            PrivateKey priv = (PrivateKey) ks.getKey(ALIAS, null);
            if (priv == null) return false;
            // KeyInfo.isInsideSecureHardware is the authoritative signal on
            // API 23+. If the device cannot answer, report false — never
            // claim hardware custody we did not observe.
            KeyInfo info = KeyFactory.getInstance(priv.getAlgorithm(), "AndroidKeyStore")
                    .getKeySpec(priv, KeyInfo.class);
            return info.isInsideSecureHardware();
        } catch (Exception e) {
            return false;
        }
    }

    /** Minimal pair holder (avoids java.security.KeyPair name clash). */
    public static final class KeyPair {
        public final PrivateKey priv;
        public final PublicKey pub;
        KeyPair(PrivateKey priv, PublicKey pub) {
            this.priv = priv;
            this.pub = pub;
        }
    }

    public static String utf8(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
