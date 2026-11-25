import network.awai.platform.Catalog;

/** Creator-dapp allowlist check (itonami Store item 134). Static tables only; no Android runtime. */
public final class CreatorCatalogCheck {
    public static void main(String[] args) throws Exception {
        // The writing app ships as network.itonami.isco2641 (its package id and descriptor schema),
        // so the catalog carries that id and the file name that matches it.
        String[][] expected = {
            {"network.itonami.mangaka",    "packages/mangaka.apk",    "online-mangaka.apk"},
            {"network.itonami.dougaka",    "packages/dougaka.apk",    "online-dougaka.apk"},
            {"network.itonami.animeka",    "packages/animeka.apk",    "online-animeka.apk"},
            {"network.itonami.ongakuka",   "packages/ongakuka.apk",   "online-ongakuka.apk"},
            {"network.itonami.gameka",     "packages/gameka.apk",     "online-gameka.apk"},
            {"network.itonami.isco2641",   "packages/isco2641.apk",   "online-isco2641.apk"},
            {"network.awai.gaka",          "packages/gaka.apk",       "online-gaka.apk"},
        };
        int pass = 0, total = 0;
        for (String[] e : expected) {
            total += 3;
            if (e[1].equals(Catalog.assetFor(e[0]))) pass++; else System.out.println("FAIL asset " + e[0]);
            if (e[2].equals(Catalog.onlineFileFor(e[0]))) pass++; else System.out.println("FAIL online " + e[0]);
            int budget = Catalog.maxApkBytes(e[0]);
            if (budget == 40 * 1024 * 1024) pass++; else System.out.println("FAIL budget " + e[0] + "=" + budget);
        }
        // The 19.6 MiB reference APK must fit, and a 41 MiB APK must not.
        total += 2;
        if (19614026 <= Catalog.maxApkBytes("network.itonami.mangaka")) pass++; else System.out.println("FAIL measured APK fits");
        if (!(41 * 1024 * 1024 <= Catalog.maxApkBytes("network.itonami.mangaka"))) pass++; else System.out.println("FAIL 41MiB refused");
        // Case and prefix variants stay refused: the tables are exact.
        total += 3;
        for (String bad : new String[]{"network.itonami.Mangaka", "network.itonami.mangaka.preview", "network.awai.gakai"}) {
            boolean refused;
            try { Catalog.assetFor(bad); refused = false; } catch (SecurityException x) { refused = true; }
            if (refused) pass++; else System.out.println("FAIL admitted " + bad);
        }
        // No explicit shosetsuka entry: the id keeps only the generic AWAI-3771 admission (64 MiB),
        // so the tightened 40 MiB budget cannot silently apply to an app that is not shipped.
        total += 1;
        if (Catalog.maxApkBytes("network.itonami.shosetsuka") == Catalog.MAX_CATALOG_APP_BYTES) pass++;
        else System.out.println("FAIL shosetsuka entry crept back into the creator budget");
        // File name and package id stay one-to-one: no two ids may share an asset name.
        total += 1;
        java.util.Set<String> assets = new java.util.HashSet<>();
        boolean unique = true;
        for (String[] e : expected) if (!assets.add(e[1])) unique = false;
        if (unique) pass++; else System.out.println("FAIL two ids share one asset name");
        System.out.println(pass + " pass / " + total + " total");
        if (pass != total) System.exit(1);
    }
}
