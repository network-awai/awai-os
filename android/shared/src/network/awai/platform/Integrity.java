package network.awai.platform;

import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.io.*;

/** Bytes and signatures, not consent or installation authority. */
public final class Integrity {
    public static byte[] read(InputStream input, int limit) throws IOException {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[65536]; int n;
            while ((n = in.read(buffer)) != -1) {
                if (out.size() + n > limit) throw new IOException("size-limit");
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }
    public static String sha256(byte[] data) throws GeneralSecurityException {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder out = new StringBuilder();
        for (byte b : digest) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    public static boolean authentic(byte[] data, byte[] signature, byte[] pinnedSpki) throws GeneralSecurityException {
        PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(pinnedSpki));
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(key); verifier.update(data); return verifier.verify(signature);
    }
    private Integrity() { }
}
