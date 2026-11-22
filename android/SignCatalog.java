import java.io.*;
import java.nio.file.*;
import java.security.*;
/**
 * Signs one file with SHA256withRSA and prints the signer certificate's SHA-256.
 * Arguments: keystore, data, public-key output, signature output, [alias], [password environment variable].
 * Without the optional arguments it uses the conventional Android debug identity, as before.
 * The password is read from the named environment variable and never from the command line.
 */
public final class SignCatalog {
    public static void main(String[] args) throws Exception {
        String alias=args.length>4?args[4]:"androiddebugkey";
        String secret=args.length>5?System.getenv(args[5]):"android";
        if(secret==null||secret.isEmpty())throw new IllegalStateException("password environment variable is not set");
        char[] pass=secret.toCharArray();
        // Detects JKS and PKCS12 from the file itself.
        KeyStore store=KeyStore.getInstance(new File(args[0]),pass);
        PrivateKey key=(PrivateKey)store.getKey(alias,pass);
        java.security.cert.Certificate cert=store.getCertificate(alias);
        if(key==null||cert==null)throw new IllegalStateException("no private key under the given alias");
        Files.write(Paths.get(args[2]),cert.getPublicKey().getEncoded());
        Signature signature=Signature.getInstance("SHA256withRSA");signature.initSign(key);signature.update(Files.readAllBytes(Paths.get(args[1])));
        Files.write(Paths.get(args[3]),signature.sign());
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
        StringBuilder s=new StringBuilder();for(byte b:hash)s.append(String.format("%02x",b&255));
        System.out.println(s);
    }
}
