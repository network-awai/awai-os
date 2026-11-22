import network.awai.platform.KeyList;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Runs android/tests/key-list-vectors.tsv through KeyList.java; key-list.test.mjs runs the same file through key-list.js. */
public final class KeyListVectorsTest {
    static byte[] b(String s) { return "-".equals(s) ? new byte[0] : Base64.getDecoder().decode(s); }
    public static void main(String[] args) throws Exception {
        int checks = 0, failures = 0;
        for (String line : Files.readAllLines(Paths.get(args[0]), StandardCharsets.US_ASCII)) {
            if (line.isEmpty()) continue;
            String[] f = line.split("\t", -1);
            long now = Long.parseLong(f[2]), floor = Long.parseLong(f[3]);
            String got;
            try {
                KeyList k = KeyList.verify(b(f[5]), b(f[6]), b(f[4]), now, floor);
                got = "list".equals(f[0]) ? "ok:" + k.sequence : String.valueOf(k.authentic(f[8], b(f[9]), b(f[10])));
            } catch (SecurityException e) { got = e.getMessage(); }
            checks++;
            if (got.equals(f[7])) System.out.println("ok   " + f[0] + " " + f[1] + " -> " + got);
            else { failures++; System.out.println("FAIL " + f[0] + " " + f[1] + ": got " + got + ", want " + f[7]); }
        }
        System.out.println(checks + " vectors, " + failures + " failures");
        if (failures > 0 || checks == 0) System.exit(1);
    }
}
