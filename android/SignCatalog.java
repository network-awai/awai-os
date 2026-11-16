import java.io.*;
import java.nio.file.*;
import java.security.*;
/** Local development signer only. Uses the conventional Android debug identity, never production keys. */
public final class SignCatalog {
    public static void main(String[] args) throws Exception {
        KeyStore store=KeyStore.getInstance("JKS");
        char[] pass="android".toCharArray();
        try(InputStream in=Files.newInputStream(Paths.get(args[0]))){store.load(in,pass);}
        PrivateKey key=(PrivateKey)store.getKey("androiddebugkey",pass);
        java.security.cert.Certificate cert=store.getCertificate("androiddebugkey");
        Files.write(Paths.get(args[2]),cert.getPublicKey().getEncoded());
        Signature signature=Signature.getInstance("SHA256withRSA");signature.initSign(key);signature.update(Files.readAllBytes(Paths.get(args[1])));
        Files.write(Paths.get(args[3]),signature.sign());
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
        StringBuilder s=new StringBuilder();for(byte b:hash)s.append(String.format("%02x",b&255));
        System.out.println(s);
    }
}
