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

    static String buildPinsJsonExactBytes(int appCount, int targetBytes) {
        String baseJson = buildPinsJson(appCount);
        int extra = targetBytes - baseJson.getBytes(StandardCharsets.UTF_8).length;
        if (extra < 0) throw new IllegalArgumentException("target too small");
        int basePad = extra / appCount, rem = extra % appCount;
        StringBuilder sb = new StringBuilder();
        sb.append("{\"revision\":\"").append(REV).append("\",\"catalog\":{\"url\":\"")
          .append(BASE).append("catalog-envelope.json\",\"sha256\":\"").append(SHA)
          .append("\",\"maxBytes\":16965},\"apks\":{");
        for (int i = 0; i < appCount; i++) {
            if (i > 0) sb.append(',');
            int add = basePad + (i < rem ? 1 : 0);
            String suffix = "app" + i;
            String file = add > 0 ? suffix + "-" + repeat('p', add - 1) + ".apk" : suffix + ".apk";
            sb.append("\"network.itonami.").append(suffix).append("\":{\"url\":\"")
              .append(BASE).append(file).append("\",\"sha256\":\"").append(SHA)
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

        OnlinePins.LoadResult decimalBudget = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("1048576", "1024.0"), acceptAll());
        ok("decimal maxBytes (1024.0) fails closed with pins-budget",
                decimalBudget.allowedUrls.isEmpty() && "SecurityException: pins-budget".equals(decimalBudget.error));

        OnlinePins.LoadResult expBudget = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("1048576", "1e3"), acceptAll());
        ok("exponent maxBytes (1e3) fails closed with pins-budget",
                expBudget.allowedUrls.isEmpty() && "SecurityException: pins-budget".equals(expBudget.error));

        OnlinePins.LoadResult boolBudget = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("1048576", "true"), acceptAll());
        ok("boolean maxBytes fails closed with pins-budget",
                boolBudget.allowedUrls.isEmpty() && "SecurityException: pins-budget".equals(boolBudget.error));

        OnlinePins.LoadResult explicitPortUrl = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("https://raw.githubusercontent.com/", "https://raw.githubusercontent.com:443/"), acceptAll());
        ok("explicit :443 port in URL fails closed with pins-url",
                explicitPortUrl.allowedUrls.isEmpty() && "SecurityException: pins-url".equals(explicitPortUrl.error));

        OnlinePins.LoadResult trailingDotDotUrl = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("app0.apk", "dir/.."), acceptAll());
        ok("trailing /.. in URL fails closed with pins-url",
                trailingDotDotUrl.allowedUrls.isEmpty() && "SecurityException: pins-url".equals(trailingDotDotUrl.error));

        OnlinePins.LoadResult spaceUrl = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("app0.apk", "app 0.apk"), acceptAll());
        ok("space in URL fails closed with pins-url",
                spaceUrl.allowedUrls.isEmpty() && "SecurityException: pins-url".equals(spaceUrl.error));

        // Closed schema: extra root or pin metadata keys are refused with pins-shape.
        OnlinePins.LoadResult extraRootKey = OnlinePins.loadAllowlist(
                buildPinsJson(1).replaceFirst("\\{", "{\"extra\":1,"), acceptAll());
        ok("extra root metadata key fails closed with pins-shape",
                extraRootKey.allowedUrls.isEmpty() && "SecurityException: pins-shape".equals(extraRootKey.error));

        OnlinePins.LoadResult extraPinKey = OnlinePins.loadAllowlist(
                buildPinsJson(1).replace("\"maxBytes\":1048576", "\"maxBytes\":1048576,\"extra\":1"), acceptAll());
        ok("extra pin metadata key fails closed with pins-shape",
                extraPinKey.allowedUrls.isEmpty() && "SecurityException: pins-shape".equals(extraPinKey.error));

        OnlinePins.LoadResult bigIntMeta = OnlinePins.loadAllowlist(
                devJson.replaceFirst("\\{", "{\"externalId\":9223372036854775808,"), acceptAll());
        ok("17-APK dev fixture with int64-overflow metadata fails closed",
                bigIntMeta.allowedUrls.isEmpty() && "SecurityException: pins-json".equals(bigIntMeta.error));

        // Strict JSON parser parity checks: int64 bounds, non-finite double, lone surrogates, depth 16 vs 17, non-RFC ws.
        ok("parseJson accepts Long.MAX_VALUE and Long.MIN_VALUE",
                OnlinePins.parseJson("{\"a\":9223372036854775807,\"b\":-9223372036854775808}") != null);
        for (String[] badParserCase : new String[][]{
            {"int64 max + 1 (2^63)", "{\"v\":9223372036854775808}"},
            {"int64 min - 1 (-2^63 - 1)", "{\"v\":-9223372036854775809}"},
            {"huge integer (10^25)", "{\"v\":10000000000000000000000000}"},
            {"non-finite float (1e400)", "{\"v\":1e400}"},
            {"non-finite negative float (-1e400)", "{\"v\":-1e400}"},
            {"lone high surrogate (\\uD800)", "{\"v\":\"\\uD800\"}"},
            {"lone low surrogate (\\uDC00)", "{\"v\":\"\\uDC00\"}"},
            {"non-RFC NUL leading whitespace", "\u0000{\"v\":1}"},
            {"depth 17 empty nested objects", repeat('{', 17).replace("{", "{\"a\":").substring(0, 16 * 5) + "{}" + repeat('}', 16)},
        }) {
            boolean failed = false;
            try { OnlinePins.parseJson(badParserCase[1]); } catch (SecurityException expected) { failed = true; }
            ok("parseJson rejects " + badParserCase[0], failed);
        }
        String depth16 = repeat('[', 16) + "1" + repeat(']', 16);
        String depth17 = repeat('[', 17) + repeat(']', 17);
        ok("parseJson accepts depth 16 and valid surrogate pair",
                OnlinePins.parseJson(depth16) != null && OnlinePins.parseJson("{\"v\":\"\\uD83D\\uDE00\"}") != null);
        boolean d17Failed = false;
        try { OnlinePins.parseJson(depth17); } catch (SecurityException expected) { d17Failed = true; }
        ok("parseJson rejects depth 17 empty arrays", d17Failed);

        // Exact byte-limit boundary for 64 APKs: 32,768 bytes accepted; 32,769 bytes refused by Integrity.read.
        String exactMaxBytesJson = buildPinsJsonExactBytes(OnlinePins.MAX_APPS, OnlinePins.MAX_BYTES);
        byte[] exactMaxBytesBuf = exactMaxBytesJson.getBytes(StandardCharsets.UTF_8);
        ok("64-APK JSON at exact MAX_BYTES (" + OnlinePins.MAX_BYTES + ") passes Integrity.read and OnlinePins",
                exactMaxBytesBuf.length == OnlinePins.MAX_BYTES
                        && Integrity.read(new ByteArrayInputStream(exactMaxBytesBuf), OnlinePins.MAX_BYTES).length == OnlinePins.MAX_BYTES
                        && OnlinePins.loadAllowlist(exactMaxBytesJson, acceptAll()).allowedUrls.size() == 1 + OnlinePins.MAX_APPS);

        String overMaxBytesJson = buildPinsJsonExactBytes(OnlinePins.MAX_APPS, OnlinePins.MAX_BYTES + 1);
        byte[] overMaxBytesBuf = overMaxBytesJson.getBytes(StandardCharsets.UTF_8);
        String overErr = null;
        try {
            Integrity.read(new ByteArrayInputStream(overMaxBytesBuf), OnlinePins.MAX_BYTES);
        } catch (Exception expected) {
            overErr = OnlinePins.errorSummary(expected);
        }
        ok("64-APK JSON at MAX_BYTES + 1 (" + (OnlinePins.MAX_BYTES + 1) + ") fails Integrity.read with IOException: size-limit",
                overMaxBytesBuf.length == OnlinePins.MAX_BYTES + 1 && "IOException: size-limit".equals(overErr));

        ok("errorSummary strips arbitrary exception messages (no secret leak)",
                "RuntimeException".equals(OnlinePins.errorSummary(new RuntimeException("secret-token=12345")))
                        && "IOException: size-limit".equals(OnlinePins.errorSummary(new IOException("size-limit"))));

        // 5. Cross-file consistency: HostActivity.java, LatestPointer.java, OnlinePins.java, build.py, online-csp.mjs, and online.js agree.
        String hostSrc = new String(Files.readAllBytes(root.resolve("android/shared/src/network/awai/platform/HostActivity.java")), StandardCharsets.UTF_8);
        String pointerSrc = new String(Files.readAllBytes(root.resolve("android/shared/src/network/awai/platform/LatestPointer.java")), StandardCharsets.UTF_8);
        String onlineJs = new String(Files.readAllBytes(root.resolve("android/client/online.js")), StandardCharsets.UTF_8);
        String buildPy = new String(Files.readAllBytes(root.resolve("android/build.py")), StandardCharsets.UTF_8);
        String cspMjs = new String(Files.readAllBytes(root.resolve("android/online-csp.mjs")), StandardCharsets.UTF_8);

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
        Matcher jsBytes = Pattern.compile("export\\s+const\\s+MAX_PIN_BYTES\\s*=\\s*(\\d+)").matcher(onlineJs);
        ok("android/client/online.js MAX_PIN_BYTES matches OnlinePins.MAX_BYTES (" + OnlinePins.MAX_BYTES + ")",
                jsBytes.find() && Integer.parseInt(jsBytes.group(1)) == OnlinePins.MAX_BYTES);
        Matcher pyApps = Pattern.compile("MAX_ONLINE_PIN_APPS\\s*=\\s*(\\d+)").matcher(buildPy);
        Matcher pyBytes = Pattern.compile("MAX_ONLINE_PIN_BYTES\\s*=\\s*(\\d+)").matcher(buildPy);
        ok("android/build.py limits match OnlinePins (" + OnlinePins.MAX_APPS + " apps, " + OnlinePins.MAX_BYTES + " bytes)",
                pyApps.find() && Integer.parseInt(pyApps.group(1)) == OnlinePins.MAX_APPS
                        && pyBytes.find() && Integer.parseInt(pyBytes.group(1)) == OnlinePins.MAX_BYTES);
        Matcher cspApps = Pattern.compile("MAX_PIN_APPS\\s*=\\s*(\\d+)").matcher(cspMjs);
        Matcher cspBytes = Pattern.compile("MAX_PIN_BYTES\\s*=\\s*(\\d+)").matcher(cspMjs);
        ok("android/online-csp.mjs limits match OnlinePins (" + OnlinePins.MAX_APPS + " apps, " + OnlinePins.MAX_BYTES + " bytes)",
                cspApps.find() && Integer.parseInt(cspApps.group(1)) == OnlinePins.MAX_APPS
                        && cspBytes.find() && Integer.parseInt(cspBytes.group(1)) == OnlinePins.MAX_BYTES);

        System.out.println(checks + " checks, " + failures + " failures");
        if (failures > 0) System.exit(1);
    }
}
