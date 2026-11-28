import java.io.*;
import java.nio.file.*;
import java.security.*;
/**
 * Signs one file with SHA256withRSA and prints the signer certificate's SHA-256.
 * Arguments: keystore, data, public-key output, signature output, [alias], [password environment variable].
 * Without the optional arguments it uses the conventional Android debug identity, as before.
 * The password is read from the named environment variable and never from the command line.
 * --inspect keystore alias password-env prints the certificate and SPKI hashes without signing.
 */
public final class SignCatalog {
    public static void main(String[] args) throws Exception {
        boolean inspect=args[0].equals("--inspect");
        if(inspect&&args.length!=4)throw new IllegalArgumentException("--inspect requires keystore, alias and password environment variable");
        String alias=inspect?args[2]:args.length>4?args[4]:"androiddebugkey";
        String secret=inspect?System.getenv(args[3]):args.length>5?System.getenv(args[5]):"android";
        if(secret==null||secret.isEmpty())throw new IllegalStateException("password environment variable is not set");
        char[] pass=secret.toCharArray();
        // Detects JKS and PKCS12 from the file itself.
        KeyStore store=KeyStore.getInstance(new File(args[inspect?1:0]),pass);
        java.security.cert.Certificate cert=store.getCertificate(alias);
        if(inspect){
            if(cert==null)throw new IllegalStateException("no certificate under the given alias");
            System.out.println(fingerprint(cert.getEncoded()));
            System.out.println(fingerprint(cert.getPublicKey().getEncoded()));
            return;
        }
        PrivateKey key=(PrivateKey)store.getKey(alias,pass);
        if(key==null||cert==null)throw new IllegalStateException("no private key under the given alias");
        Files.write(Paths.get(args[2]),cert.getPublicKey().getEncoded());
        Signature signature=Signature.getInstance("SHA256withRSA");signature.initSign(key);signature.update(Files.readAllBytes(Paths.get(args[1])));
        Files.write(Paths.get(args[3]),signature.sign());
        System.out.println(fingerprint(cert.getEncoded()));
    }
    private static String fingerprint(byte[] bytes)throws NoSuchAlgorithmException{
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder text=new StringBuilder();
        for(byte b:hash)text.append(String.format("%02x",b&255));
        return text.toString();
    }
}
