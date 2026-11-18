package network.awai.platform;

import android.content.Context;
import android.content.pm.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Android host boundary: authenticated bundled metadata and exact APK identity. No network. */
public final class Catalog {
    private final JSONObject value;
    public final boolean online;
    public Catalog(Context context) throws Exception {
        byte[] bytes = Integrity.read(context.getAssets().open("catalog.json"), 131072);
        byte[] sig = Integrity.read(context.getAssets().open("catalog.sig"), 4096);
        byte[] key = Integrity.read(context.getAssets().open("catalog-key.der"), 4096);
        JSONObject bundled=verifyMetadata(bytes,sig,key,System.currentTimeMillis()/1000);
        android.content.SharedPreferences saved=context.getSharedPreferences("online",0);
        online=saved.contains("raw");
        if(online){
            bytes=saved.getString("raw","").getBytes(StandardCharsets.UTF_8);
            sig=android.util.Base64.decode(saved.getString("signature",""),android.util.Base64.DEFAULT);
        }
        value = verifyMetadata(bytes,sig,key,System.currentTimeMillis()/1000);
        if(value.getLong("revision")<Math.max(bundled.getLong("revision"),saved.getLong("highest",0)))throw new SecurityException("catalog-rollback");
    }
    public static JSONObject verifyMetadata(byte[] bytes,byte[] sig,byte[] key,long now) throws Exception {
        if (!Integrity.authentic(bytes, sig, key)) throw new SecurityException("catalog-signature");
        JSONObject value = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!"itonami.store.bundled.v1".equals(value.getString("schema")) || value.getLong("revision") < 1
                || value.getLong("expiresAt") <= now) throw new SecurityException("catalog-expired");
        JSONArray apps = value.getJSONArray("apps");
        if (apps.length() < 1) throw new SecurityException("catalog-app");
        for (int i = 0; i < apps.length(); i++) {
            JSONObject entry = apps.getJSONObject(i);
            assetFor(entry.getString("id"));
            if(entry.getLong("versionCode")<1||entry.getDouble("versionCode")!=entry.getLong("versionCode"))
                throw new SecurityException("catalog-version");
        }
        return value;
    }
    // AWAI-3502: Tauri v3 itonami apps that keep all data on the device and request no INTERNET
    // permission (android/local-apps.json lists the same suffixes; tests/local-apps.test.mjs checks
    // that). Each is network.itonami.<suffix>, asset packages/<suffix>.apk, 40 MiB budget.
    public static final java.util.List<String> LOCAL_APPS = java.util.Collections.unmodifiableList(java.util.Arrays.asList(
            "ki", "hakkou", "koke", "openossekai", "otakiage", "seibutsu", "shinka", "kabi", "kinoko", "kobo", "saikin", "kiyome", "omikuji", "moldallergy", "explorer", "organismviz", "icc", "abaki", "hibiki", "wakai", "tawami", "yudane", "minori", "torifune", "hiramekietz", "umisachi", "tomoshibi", "tsumugi"));
    static String localSuffix(String id) {
        if (id == null || !id.startsWith("network.itonami.")) return null;
        String suffix = id.substring("network.itonami.".length());
        return LOCAL_APPS.contains(suffix) ? suffix : null;
    }
    // Admitted store apps. Unknown ids are refused; per-app asset name, staged
    // download filename and byte budget are fixed here, never taken from callers.
    public static String assetFor(String id) throws SecurityException {
        if ("network.itonami.yotei".equals(id)) return "packages/yotei.apk";
        if ("network.itonami.app".equals(id)) return "packages/itonami.apk";
        if ("network.itonami.torihiki".equals(id)) return "packages/torihiki.apk";
        if ("network.itonami.torihiki.bot".equals(id)) return "packages/torihiki-bot.apk";
        if ("network.itonami.tabimikake".equals(id)) return "packages/tabi-mikake.apk";
        if ("network.itonami.deai".equals(id)) return "packages/deai.apk";
        if ("network.itonami.hiring".equals(id)) return "packages/hiring.apk";
        if ("network.itonami.kumade".equals(id)) return "packages/kumade.apk";
        if ("app.aozora".equals(id)) return "packages/aozora.apk";
        if ("network.itonami.agenttrace".equals(id)) return "packages/agent-trace.apk";
        String local = localSuffix(id);
        if (local != null) return "packages/" + local + ".apk";
        throw new SecurityException("unknown-app");
    }
    public static String onlineFileFor(String id) throws SecurityException {
        if ("network.itonami.yotei".equals(id)) return "online-yotei.apk";
        if ("network.itonami.app".equals(id)) return "online-itonami.apk";
        if ("network.itonami.torihiki".equals(id)) return "online-torihiki.apk";
        if ("network.itonami.torihiki.bot".equals(id)) return "online-torihiki-bot.apk";
        if ("network.itonami.tabimikake".equals(id)) return "online-tabi-mikake.apk";
        if ("network.itonami.deai".equals(id)) return "online-deai.apk";
        if ("network.itonami.hiring".equals(id)) return "online-hiring.apk";
        if ("network.itonami.kumade".equals(id)) return "online-kumade.apk";
        if ("app.aozora".equals(id)) return "online-aozora.apk";
        if ("network.itonami.agenttrace".equals(id)) return "online-agent-trace.apk";
        String local = localSuffix(id);
        if (local != null) return "online-" + local + ".apk";
        throw new SecurityException("unknown-app");
    }
    public static int maxApkBytes(String id) throws SecurityException {
        if ("network.itonami.yotei".equals(id)) return 20 * 1024 * 1024;
        if ("network.itonami.app".equals(id)) return 64 * 1024 * 1024;
        if ("network.itonami.torihiki".equals(id)) return 20 * 1024 * 1024;
        // Tauri v3 APK (network-awai/app-itonami-torihiki app/), about 29.5 MB at 0.1.0.
        if ("network.itonami.torihiki.bot".equals(id)) return 40 * 1024 * 1024;
        // Tauri v3 APK (network-awai/app-tabi-mikake), about 29.6 MB at 0.1.0.
        if ("network.itonami.tabimikake".equals(id)) return 40 * 1024 * 1024;
        // Tauri v3 APK (network-awai/app-deai), stripped debug build.
        if ("network.itonami.deai".equals(id)) return 40 * 1024 * 1024;
        // Tauri v3 APK (network-awai/app-itonami-hiring), about 20.6 MB at 0.1.0 (debug, no debug symbols).
        if ("network.itonami.hiring".equals(id)) return 40 * 1024 * 1024;
        // Tauri v3 APK (network-awai/app-itonami-kumade), debug build without native debug symbols.
        if ("network.itonami.kumade".equals(id)) return 40 * 1024 * 1024;
        if ("app.aozora".equals(id)) return 64 * 1024 * 1024;
        if ("network.itonami.agenttrace".equals(id)) return 2 * 1024 * 1024;
        // AWAI-3502 local apps: Tauri v3 debug builds without native debug symbols, about 19.6 MB at 0.1.0.
        if (localSuffix(id) != null) return 40 * 1024 * 1024;
        throw new SecurityException("unknown-app");
    }
    public long valueRevision() throws Exception { return value.getLong("revision"); }
    public String json() { return value.toString(); }
    public JSONObject app(String id) throws Exception {
        assetFor(id);
        JSONArray apps = value.getJSONArray("apps");
        for (int i = 0; i < apps.length(); i++) {
            JSONObject app = apps.getJSONObject(i);
            if (app.getString("id").equals(id)) return app;
        }
        throw new SecurityException("unknown-app");
    }
    public JSONObject artifact(String id) throws Exception {
        String asset = assetFor(id);
        JSONArray entries = app(id).getJSONArray("artifacts");
        for (int i = 0; i < entries.length(); i++) {
            JSONObject a = entries.getJSONObject(i);
            if ("android".equals(a.getString("platform")) && "android".equals(a.getString("runtime"))
                    && "apk".equals(a.getString("kind")) && asset.equals(a.getString("asset"))) return a;
        }
        throw new SecurityException("no-android-artifact");
    }
    public byte[] verifiedApk(Context context, String id) throws Exception {
        String onlineFile = onlineFileFor(id);
        int budget = maxApkBytes(id);
        JSONObject app = app(id), a = artifact(id);
        byte[] bytes = Integrity.read((online ? new FileInputStream(new File(context.getFilesDir(),onlineFile)) : context.getAssets().open(a.getString("asset"))), budget);
        if (bytes.length != a.getLong("bytes") || !Integrity.sha256(bytes).equals(a.getString("sha256")))
            throw new SecurityException("artifact-integrity");
        File file = File.createTempFile("awai-verify-", ".apk", context.getCacheDir());
        try {
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
            PackageInfo info = context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
            if (info == null || !id.equals(info.packageName) || info.getLongVersionCode() != app.getLong("versionCode"))
                throw new SecurityException("package-version");
            if (info.signingInfo == null || info.signingInfo.hasMultipleSigners()) throw new SecurityException("signer-count");
            android.content.pm.Signature[] signers = info.signingInfo.getApkContentsSigners();
            if (signers.length != 1 || !Integrity.sha256(signers[0].toByteArray()).equals(a.getString("signerSha256")))
                throw new SecurityException("package-signer");
            try {
                PackageInfo installed = context.getPackageManager().getPackageInfo(id, PackageManager.GET_SIGNING_CERTIFICATES);
                if (installed.getLongVersionCode() > app.getLong("versionCode")) throw new SecurityException("downgrade");
                if (installed.signingInfo == null || installed.signingInfo.hasMultipleSigners()
                        || !Integrity.sha256(installed.signingInfo.getApkContentsSigners()[0].toByteArray()).equals(a.getString("signerSha256")))
                    throw new SecurityException("installed-signer");
            } catch (PackageManager.NameNotFoundException absent) { /* fresh install */ }
            return bytes;
        } finally { if (!file.delete()) file.deleteOnExit(); }
    }
}
