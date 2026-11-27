import network.awai.platform.Catalog;

/**
 * Soudan / Bengoshi Store catalog allowlist check (Kanji #218, AWAI-4094).
 * Static tables only; runs on a plain JVM against android.jar (no Android runtime).
 */
public final class SoudanBengoshiCatalogCheck {
    private static final int EXPECTED_BUDGET = 64 * 1024 * 1024;

    public static void main(String[] args) throws Exception {
        String[][] expected = {
            {"network.itonami.soudan",   "packages/soudan.apk",   "online-soudan.apk"},
            {"network.itonami.bengoshi", "packages/bengoshi.apk", "online-bengoshi.apk"},
        };
        int pass = 0, total = 0;

        for (String[] e : expected) {
            total += 3;
            if (e[1].equals(Catalog.assetFor(e[0]))) pass++;
            else System.out.println("FAIL asset " + e[0]);
            if (e[2].equals(Catalog.onlineFileFor(e[0]))) pass++;
            else System.out.println("FAIL online " + e[0]);
            int budget = Catalog.maxApkBytes(e[0]);
            if (budget == EXPECTED_BUDGET) pass++;
            else System.out.println("FAIL budget " + e[0] + "=" + budget);
        }

        // Dual-ABI (arm64-v8a + x86_64) Tauri v3 APK budget: 35 MiB and 64 MiB fit; 65 MiB is refused.
        for (String[] e : expected) {
            int budget = Catalog.maxApkBytes(e[0]);
            total += 3;
            if (35 * 1024 * 1024 <= budget) pass++;
            else System.out.println("FAIL 35MiB fits " + e[0]);
            if (64 * 1024 * 1024 <= budget) pass++;
            else System.out.println("FAIL 64MiB fits " + e[0]);
            if (!(65 * 1024 * 1024 <= budget)) pass++;
            else System.out.println("FAIL 65MiB refused " + e[0]);
        }

        // Negative controls: case variants, extra dot segments, and wrong namespace stay refused
        // across all three static tables with SecurityException("unknown-app").
        String[] badIds = {
            "network.itonami.Soudan",
            "network.itonami.Bengoshi",
            "network.itonami.soudan.preview",
            "network.itonami.bengoshi.beta",
            "network.awai.soudan",
            "network.awai.bengoshi",
        };
        for (String bad : badIds) {
            total += 3;
            if (refusedUnknown(() -> Catalog.assetFor(bad))) pass++;
            else System.out.println("FAIL assetFor admitted " + bad);
            if (refusedUnknown(() -> Catalog.onlineFileFor(bad))) pass++;
            else System.out.println("FAIL onlineFileFor admitted " + bad);
            if (refusedUnknown(() -> Catalog.maxApkBytes(bad))) pass++;
            else System.out.println("FAIL maxApkBytes admitted " + bad);
        }

        // External-inference apps must not be listed as offline-only local-apps.json entries.
        total += 2;
        if (!Catalog.LOCAL_APPS.contains("soudan")) pass++;
        else System.out.println("FAIL soudan in LOCAL_APPS");
        if (!Catalog.LOCAL_APPS.contains("bengoshi")) pass++;
        else System.out.println("FAIL bengoshi in LOCAL_APPS");

        // Package id, bundled asset path, and staged online filename stay one-to-one.
        total += 2;
        java.util.Set<String> assets = new java.util.HashSet<>();
        java.util.Set<String> online = new java.util.HashSet<>();
        boolean uniqueAssets = true, uniqueOnline = true;
        for (String[] e : expected) {
            if (!assets.add(e[1])) uniqueAssets = false;
            if (!online.add(e[2])) uniqueOnline = false;
        }
        if (uniqueAssets) pass++; else System.out.println("FAIL duplicate asset name");
        if (uniqueOnline) pass++; else System.out.println("FAIL duplicate online filename");

        System.out.println(pass + " pass / " + total + " total");
        if (pass != total) System.exit(1);
    }

    private static boolean refusedUnknown(Runnable call) {
        try {
            call.run();
            return false;
        } catch (SecurityException x) {
            return "unknown-app".equals(x.getMessage());
        }
    }
}
