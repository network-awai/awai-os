import network.awai.platform.Catalog;
import network.awai.platform.Integrity;
import network.awai.platform.LatestPointer;
import network.awai.platform.OnlinePins;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Verifies OnlinePins against Catalog.assetFor/onlineFileFor and LatestPointer.MAX_APPS (AWAI-3729).
 * Compiled against android.jar (stubs only; no Android runtime methods are invoked).
 *
 * <p>CLI modes used by {@code android/tests/online-pins-build.py} for exact-byte round-trip checks:
 * <ul>
 *   <li>{@code --pins-file <path> <expectedApkCount>}: asserts bytes fit {@link OnlinePins#MAX_BYTES}
 *       and pass {@link OnlinePins#loadAllowlist} with {@code Catalog::assetFor} + {@code Catalog::onlineFileFor}.</li>
 *   <li>{@code --reject-pins-file <path>}: asserts bytes fail either {@link Integrity#read} or
 *       {@link OnlinePins#loadAllowlist} with an empty allowlist.</li>
 *   <li>{@code --parse-json <path> <accept|reject>}: asserts {@link OnlinePins#parseJson} matches
 *       expected accept/reject on raw JSON bytes.</li>
 * </ul>
 */
public final class CatalogOnlinePinsCheck {
    static int checks = 0, failures = 0;

    static void ok(String name, boolean cond) {
        checks++;
        if (cond) System.out.println("ok   " + name);
        else { failures++; System.out.println("FAIL " + name); }
    }

    public static void main(String[] args) throws Exception {
        if (args.length >= 3 && "--pins-file".equals(args[0])) {
            Path file = Paths.get(args[1]);
            int expectedApks = Integer.parseInt(args[2]);
            byte[] raw = Files.readAllBytes(file);
            byte[] bounded = Integrity.read(new ByteArrayInputStream(raw), OnlinePins.MAX_BYTES);
            String text = new String(bounded, StandardCharsets.UTF_8);
            OnlinePins.LoadResult loaded = OnlinePins.loadAllowlist(text, id -> {
                Catalog.assetFor(id);
                Catalog.onlineFileFor(id);
            });
            ok("round-trip pins file fits OnlinePins.MAX_BYTES and passes Catalog admission (" + expectedApks + " APKs)",
                    loaded.error == null && loaded.allowedUrls.size() == 1 + expectedApks);
            System.out.println(checks + " checks, " + failures + " failures");
            if (failures > 0) System.exit(1);
            return;
        }

        if (args.length >= 2 && "--reject-pins-file".equals(args[0])) {
            Path file = Paths.get(args[1]);
            byte[] raw = Files.readAllBytes(file);
            boolean rejected = false;
            try {
                byte[] bounded = Integrity.read(new ByteArrayInputStream(raw), OnlinePins.MAX_BYTES);
                String text = new String(bounded, StandardCharsets.UTF_8);
                OnlinePins.LoadResult loaded = OnlinePins.loadAllowlist(text, id -> {
                    Catalog.assetFor(id);
                    Catalog.onlineFileFor(id);
                });
                rejected = loaded.error != null && loaded.allowedUrls.isEmpty();
            } catch (Exception expected) {
                rejected = true;
            }
            ok("round-trip pins file rejected by OnlinePins+Catalog: " + file.getFileName(), rejected);
            System.out.println(checks + " checks, " + failures + " failures");
            if (failures > 0) System.exit(1);
            return;
        }

        if (args.length >= 3 && "--parse-json".equals(args[0])) {
            Path file = Paths.get(args[1]);
            boolean expectAccept = "accept".equals(args[2]);
            String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
            boolean accepted;
            try {
                OnlinePins.parseJson(text);
                accepted = true;
            } catch (Exception rejected) {
                accepted = false;
            }
            ok("parseJson(" + file.getFileName() + ") " + (expectAccept ? "accepted" : "rejected"), accepted == expectAccept);
            System.out.println(checks + " checks, " + failures + " failures");
            if (failures > 0) System.exit(1);
            return;
        }

        Path root = args.length > 0 ? Paths.get(args[0]) : Paths.get(".");
        ok("LatestPointer.MAX_APPS == OnlinePins.MAX_APPS", LatestPointer.MAX_APPS == OnlinePins.MAX_APPS);

        byte[] devRaw = Files.readAllBytes(root.resolve("android/online-pins.dev.json"));
        String devJson = new String(Integrity.read(new ByteArrayInputStream(devRaw), OnlinePins.MAX_BYTES), StandardCharsets.UTF_8);
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
