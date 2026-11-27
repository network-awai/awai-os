import network.awai.platform.Integrity;
import network.awai.platform.OnlinePins;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Plain JVM regression tests for OnlinePins (AWAI-3729). Run: bash android/tests/online-pins.sh */
public final class OnlinePinsTest {
    static int checks = 0, failures = 0;
    static final String REV = repeat('a', 40);
    static final String SHA = repeat('b', 64);
    static final String BASE = OnlinePins.DISTRIBUTION_PREFIX + REV + "/store/distribution/dev/";

    static String repeat(char ch, int n) {
        StringBuilder sb = new StringBuilder(n);
        for (int i = 0; i < n; i++) sb.append(ch);
        return sb.toString();
    }

    static void ok(String name, boolean cond) {
        checks++;
        if (cond) System.out.println("ok   " + name);
        else { failures++; System.out.println("FAIL " + name); }
    }

    static String buildPinsJson(int appCount) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"revision\":\"").append(REV).append("\",\"catalog\":{\"url\":\"")
          .append(BASE).append("catalog-envelope.json\",\"sha256\":\"").append(SHA)
          .append("\",\"maxBytes\":16965},\"apks\":{");
        for (int i = 0; i < appCount; i++) {
            if (i > 0) sb.append(',');
            String suffix = "app" + i;
            sb.append("\"network.itonami.").append(suffix).append("\":{\"url\":\"")
              .append(BASE).append(suffix).append(".apk\",\"sha256\":\"").append(SHA)
              .append("\",\"maxBytes\":1048576}");
        }
        sb.append("}}");
        return sb.toString();
    }

    static OnlinePins.AppValidator acceptAll() {
        return id -> {};
    }

    public static void main(String[] args) throws Exception {
        Path root = args.length > 0 ? Paths.get(args[0]) : Paths.get(".");

        // 1. Checked-in android/online-pins.dev.json (>= 17 APKs) must be accepted and allow its catalog + APK URLs.
        byte[] devBytes = Files.readAllBytes(root.resolve("android/online-pins.dev.json"));
        ok("online-pins.dev.json fits within OnlinePins.MAX_BYTES",
                Integrity.read(new ByteArrayInputStream(devBytes), OnlinePins.MAX_BYTES).length == devBytes.length);
        String devJson = new String(devBytes, StandardCharsets.UTF_8);
        OnlinePins devPins = OnlinePins.parseOrNull(devJson, acceptAll());
        ok("online-pins.dev.json parses with >= 17 APKs", devPins != null && devPins.apks.size() >= 17);
        ok("online-pins.dev.json allows catalog + every APK URL",
                devPins != null
                        && devPins.allowedUrls.contains(devPins.catalog.url)
                        && devPins.allowedUrls.size() == 1 + devPins.apks.size());
        OnlinePins.LoadResult devLoaded = OnlinePins.loadAllowlist(devJson, acceptAll());
        ok("loadAllowlist(online-pins.dev.json) succeeds without error",
                devLoaded.error == null && devLoaded.allowedUrls.size() == 1 + devPins.apks.size());

        // 2. Offline builds write literal JSON "null": must stay empty and emit NO error.
        OnlinePins.LoadResult offlineNull = OnlinePins.loadAllowlist("null", acceptAll());
        ok("offline literal null stays empty with no error",
                offlineNull.error == null && offlineNull.allowedUrls.isEmpty());
        OnlinePins.LoadResult offlinePaddedNull = OnlinePins.loadAllowlist("  null\n", acceptAll());
        ok("offline padded null stays empty with no error",
                offlinePaddedNull.error == null && offlinePaddedNull.allowedUrls.isEmpty());

        // 3. Boundary cases: 0 APKs rejected, exact MAX_APPS accepted (and fits MAX_BYTES), MAX_APPS + 1 rejected.
        OnlinePins.LoadResult zero = OnlinePins.loadAllowlist(buildPinsJson(0), acceptAll());
        ok("0 APKs fails closed with pins-apps-count",
                zero.allowedUrls.isEmpty() && "SecurityException: pins-apps-count".equals(zero.error));

        String atMaxJson = buildPinsJson(OnlinePins.MAX_APPS);
        byte[] atMaxBytes = atMaxJson.getBytes(StandardCharsets.UTF_8);
        ok("MAX_APPS (" + OnlinePins.MAX_APPS + ") minified JSON fits within MAX_BYTES (" + OnlinePins.MAX_BYTES + ")",
                Integrity.read(new ByteArrayInputStream(atMaxBytes), OnlinePins.MAX_BYTES).length == atMaxBytes.length);
        OnlinePins.LoadResult atMax = OnlinePins.loadAllowlist(atMaxJson, acceptAll());
        ok("exact MAX_APPS (" + OnlinePins.MAX_APPS + ") accepted with catalog + all APK URLs",
                atMax.error == null && atMax.allowedUrls.size() == 1 + OnlinePins.MAX_APPS);

        OnlinePins.LoadResult overMax = OnlinePins.loadAllowlist(buildPinsJson(OnlinePins.MAX_APPS + 1), acceptAll());
        ok("MAX_APPS + 1 (" + (OnlinePins.MAX_APPS + 1) + ") fails closed with pins-apps-count",
                overMax.allowedUrls.isEmpty() && "SecurityException: pins-apps-count".equals(overMax.error));

        // 4. Validator rejection, malformed JSON, duplicate keys, bad URL, bad revision, bad digest, bad budget.
        OnlinePins.LoadResult unknownApp = OnlinePins.loadAllowlist(buildPinsJson(2), id -> {
            if ("network.itonami.app1".equals(id)) throw new SecurityException("unknown-app");
        });
        ok("unknown app id fails closed with empty allowlist and error",
                unknownApp.allowedUrls.isEmpty() && "SecurityException: unknown-app".equals(unknownApp.error));

        OnlinePins.LoadResult badJson = OnlinePins.loadAllowlist("{not-json", acceptAll());
        ok("malformed JSON fails closed with pins-json",
                badJson.allowedUrls.isEmpty() && "SecurityException: pins-json".equals(badJson.error));

        String dupJson = buildPinsJson(1).replace("}}}", "},\"network.itonami.app0\":{\"url\":\"" + BASE + "dup.apk\",\"sha256\":\"" + SHA + "\",\"maxBytes\":1}}}");
        OnlinePins.LoadResult dupKey = OnlinePins.loadAllowlist(dupJson, acceptAll());
        ok("duplicate app id key fails closed with pins-duplicate-key",
                dupKey.allowedUrls.isEmpty() && "SecurityException: pins-duplicate-key".equals(dupKey.error));

        OnlinePins.LoadResult queryUrl = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("app0.apk", "app0.apk?token=secret"), acceptAll());
        ok("query parameter in URL fails closed without leaking query text",
                queryUrl.allowedUrls.isEmpty()
                        && "SecurityException: pins-url".equals(queryUrl.error)
                        && !queryUrl.error.contains("secret"));

        OnlinePins.LoadResult fragUrl = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("app0.apk", "app0.apk#frag"), acceptAll());
        ok("fragment in URL fails closed with pins-url",
                fragUrl.allowedUrls.isEmpty() && "SecurityException: pins-url".equals(fragUrl.error));

        OnlinePins.LoadResult traversalUrl = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("app0.apk", "../evil.apk"), acceptAll());
        ok("path traversal in URL fails closed with pins-url",
                traversalUrl.allowedUrls.isEmpty() && "SecurityException: pins-url".equals(traversalUrl.error));

        OnlinePins.LoadResult badRev = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace(REV, "main"), acceptAll());
        ok("non-SHA revision fails closed with pins-revision",
                badRev.allowedUrls.isEmpty() && "SecurityException: pins-revision".equals(badRev.error));

        OnlinePins.LoadResult badSha = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace(SHA, "not-a-sha"), acceptAll());
        ok("invalid sha256 fails closed with pins-digest",
                badSha.allowedUrls.isEmpty() && "SecurityException: pins-digest".equals(badSha.error));

        OnlinePins.LoadResult overBudget = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("1048576", String.valueOf((long) OnlinePins.MAX_APK_BYTES + 1)), acceptAll());
        ok("APK maxBytes over ceiling fails closed with pins-budget",
                overBudget.allowedUrls.isEmpty() && "SecurityException: pins-budget".equals(overBudget.error));

        ok("errorSummary strips arbitrary exception messages (no secret leak)",
                "RuntimeException".equals(OnlinePins.errorSummary(new RuntimeException("secret-token=12345")))
                        && "IOException: size-limit".equals(OnlinePins.errorSummary(new IOException("size-limit"))));

        // 5. Cross-file consistency: HostActivity.java, LatestPointer.java, OnlinePins.java, and android/client/online.js agree.
        String hostSrc = new String(Files.readAllBytes(root.resolve("android/shared/src/network/awai/platform/HostActivity.java")), StandardCharsets.UTF_8);
        String pointerSrc = new String(Files.readAllBytes(root.resolve("android/shared/src/network/awai/platform/LatestPointer.java")), StandardCharsets.UTF_8);
        String onlineJs = new String(Files.readAllBytes(root.resolve("android/client/online.js")), StandardCharsets.UTF_8);

        ok("HostActivity delegates pin loading to OnlinePins (no hardcoded >16 limit)",
                hostSrc.contains("OnlinePins.loadAllowlist")
                        && hostSrc.contains("OnlinePins.MAX_APPS")
                        && !hostSrc.contains("apks.length()>16"));
        ok("HostActivity distinguishes FileNotFoundException and logs rejected pins via Log.e",
                hostSrc.contains("catch(FileNotFoundException")
                        && hostSrc.contains("android.util.Log.e(\"AwaiStore\""));
        ok("LatestPointer.MAX_APPS aligns with OnlinePins.MAX_APPS",
                pointerSrc.contains("MAX_APPS = OnlinePins.MAX_APPS"));

        Matcher jsMax = Pattern.compile("export\\s+const\\s+MAX_PINNED_APPS\\s*=\\s*(\\d+)").matcher(onlineJs);
        ok("android/client/online.js MAX_PINNED_APPS matches OnlinePins.MAX_APPS (" + OnlinePins.MAX_APPS + ")",
                jsMax.find() && Integer.parseInt(jsMax.group(1)) == OnlinePins.MAX_APPS);

        System.out.println(checks + " checks, " + failures + " failures");
        if (failures > 0) System.exit(1);
    }
}
