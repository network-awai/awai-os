import network.awai.platform.Catalog;
import network.awai.platform.LatestPointer;
import network.awai.platform.OnlinePins;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Verifies OnlinePins against Catalog.assetFor/onlineFileFor and LatestPointer.MAX_APPS (AWAI-3729).
 * Compiled against android.jar (stubs only; no Android runtime methods are invoked).
 */
public final class CatalogOnlinePinsCheck {
    static int checks = 0, failures = 0;

    static void ok(String name, boolean cond) {
        checks++;
        if (cond) System.out.println("ok   " + name);
        else { failures++; System.out.println("FAIL " + name); }
    }

    public static void main(String[] args) throws Exception {
        Path root = args.length > 0 ? Paths.get(args[0]) : Paths.get(".");
        ok("LatestPointer.MAX_APPS == OnlinePins.MAX_APPS", LatestPointer.MAX_APPS == OnlinePins.MAX_APPS);

        String devJson = new String(Files.readAllBytes(root.resolve("android/online-pins.dev.json")), StandardCharsets.UTF_8);
        OnlinePins.LoadResult loaded = OnlinePins.loadAllowlist(devJson, id -> {
            Catalog.assetFor(id);
            Catalog.onlineFileFor(id);
        });
        ok("online-pins.dev.json passes real Catalog.assetFor + onlineFileFor",
                loaded.error == null && loaded.allowedUrls.size() >= 18);

        // Offline-only preview apps must be refused in online pins.
        String rev = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        String base = OnlinePins.DISTRIBUTION_PREFIX + rev + "/store/distribution/dev/";
        String previewJson = "{\"revision\":\"" + rev + "\",\"catalog\":{\"url\":\"" + base
                + "catalog-envelope.json\",\"sha256\":\"" + sha + "\",\"maxBytes\":1024},\"apks\":{"
                + "\"network.itonami.client.preview\":{\"url\":\"" + base + "itonami-preview.apk\",\"sha256\":\""
                + sha + "\",\"maxBytes\":1024}}}";
        OnlinePins.LoadResult preview = OnlinePins.loadAllowlist(previewJson, id -> {
            Catalog.assetFor(id);
            Catalog.onlineFileFor(id);
        });
        ok("offline-only preview app refused by Catalog.onlineFileFor",
                preview.allowedUrls.isEmpty() && "SecurityException: unknown-app".equals(preview.error));

        System.out.println(checks + " checks, " + failures + " failures");
        if (failures > 0) System.exit(1);
    }
}
