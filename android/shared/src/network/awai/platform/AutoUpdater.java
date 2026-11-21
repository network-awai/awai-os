package network.awai.platform;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * One automatic-update check (AWAI-3653, step 5). Runs only while the person's standing update
 * approval is in force, and reaches only the fixed pointer URL and the commit-pinned URLs the
 * verified pointer lists, all on raw.githubusercontent.com. Each step is logged for the person.
 */
public final class AutoUpdater {
    private AutoUpdater() {}

    static final int JOB_ID = 3668;
    static final long PERIOD_MS = 24L * 60 * 60 * 1000;
    static final int MAX_LOG = 50;
    static final String CHANNEL = "auto-update";

    /** Keeps the scheduled job in line with the approval: scheduled while active, cancelled otherwise. */
    public static void sync(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null) return;
        UpdatePolicy.Approval a = approval(c);
        long now = System.currentTimeMillis() / 1000;
        boolean hasInternet = c.checkSelfPermission(Manifest.permission.INTERNET) == PackageManager.PERMISSION_GRANTED;
        if (!hasInternet || !UpdatePolicy.approvalRefusals(a, "network.awai.store.check", now).isEmpty()) {
            js.cancel(JOB_ID);
            return;
        }
        JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(c, AutoUpdateJob.class))
                .setPeriodic(PERIOD_MS)
                .setRequiredNetworkType(a.unmeteredOnly ? JobInfo.NETWORK_TYPE_UNMETERED : JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build();
        JobInfo existing = js.getPendingJob(JOB_ID);
        if (existing == null || existing.getNetworkType() != info.getNetworkType()) js.schedule(info);
    }

    /** One full check. Never throws; every outcome is logged. */
    public static void run(Context c) {
        long now = System.currentTimeMillis() / 1000;
        UpdatePolicy.Approval a = approval(c);
        if (!UpdatePolicy.approvalRefusals(a, "network.awai.store.check", now).isEmpty()) {
            log(c, "skip", null, "approval-off");
            sync(c);
            return;
        }
        SharedPreferences prefs = c.getSharedPreferences(AutoInstall.PREFS, 0);
        try {
            byte[] key = Integrity.read(c.getAssets().open("catalog-key.der"), 4096);
            long floor = prefs.getLong("pointer-sequence", 0);
            LatestPointer p = LatestPointer.verifyEnvelope(fetch(LatestPointer.URL, LatestPointer.MAX_ENVELOPE_BYTES), key, now, floor);
            prefs.edit().putLong("pointer-sequence", p.sequence).commit();

            byte[] envelope = fetch(p.catalog.url, (int) p.catalog.maxBytes);
            p.checkCatalog(envelope);
            admitCatalog(c, envelope, key, now, p);
            log(c, "catalog", null, "sequence " + p.sequence);

            Catalog catalog = new Catalog(c);
            JSONArray apps = new JSONObject(catalog.json()).getJSONArray("apps");
            int installed = 0, refused = 0;
            for (int n = 0; n < apps.length(); n++) {
                JSONObject app = apps.getJSONObject(n);
                String id = app.getString("id");
                long current;
                try { current = c.getPackageManager().getPackageInfo(id, 0).getLongVersionCode(); }
                catch (PackageManager.NameNotFoundException absent) { continue; }
                if (current >= app.getLong("versionCode")) continue;
                if (a.excludedApps.contains(id)) { log(c, "refused", id, "app-excluded"); refused++; continue; }
                if (!p.apks.containsKey(id)) { log(c, "refused", id, "not-in-pointer"); refused++; continue; }
                LatestPointer.Pin pin = p.apks.get(id);
                if (bytesToday(prefs, now) + pin.maxBytes > AutoInstall.DAILY_BYTE_BUDGET) { log(c, "refused", id, "daily-budget"); refused++; continue; }
                if (catalog.isOnlineDelivery(id)) stage(c, p, id, pin);
                AutoInstall.Result r = AutoInstall.attempt(c, id);
                if (r.refusals.isEmpty()) { log(c, "installing", id, app.getString("versionName")); installed++; }
                else { log(c, "refused", id, join(r.refusals)); refused++; }
            }
            if (installed + refused == 0) log(c, "current", null, "no updates");
            if (refused > 0) notify(c, "更新の確認が必要です", refused + " 件の更新は自動では入れられません。Store の「更新」で確認してください。");
        } catch (Exception e) {
            String m = e.getMessage();
            log(c, "error", null, e instanceof SecurityException && m != null && m.matches("[a-z0-9-]{1,40}") ? m : e.getClass().getSimpleName());
        }
    }

    /** Admits the pointer's catalog as the Store's online catalog after the same checks as a manual check. */
    private static void admitCatalog(Context c, byte[] envelope, byte[] key, long now, LatestPointer p) throws Exception {
        JSONObject e = new JSONObject(new String(envelope, StandardCharsets.UTF_8));
        String raw = e.getString("raw"), signature = e.getString("signature");
        JSONObject candidate = Catalog.verifyMetadata(raw.getBytes(StandardCharsets.UTF_8),
                android.util.Base64.decode(signature, android.util.Base64.DEFAULT), key, now);
        long revision = candidate.getLong("revision");
        if (revision < new Catalog(c).valueRevision()) throw new SecurityException("catalog-rollback");
        JSONArray listed = candidate.getJSONArray("apps");
        for (Map.Entry<String, LatestPointer.Pin> pin : p.apks.entrySet()) {
            String digest = null;
            for (int j = 0; j < listed.length(); j++) {
                if (!pin.getKey().equals(listed.getJSONObject(j).getString("id"))) continue;
                JSONArray artifacts = listed.getJSONObject(j).getJSONArray("artifacts");
                for (int i = 0; i < artifacts.length(); i++)
                    if ("android".equals(artifacts.getJSONObject(i).getString("platform"))) digest = artifacts.getJSONObject(i).getString("sha256");
            }
            if (digest == null || !digest.equals(pin.getValue().sha256)) throw new SecurityException("unpinned-artifact");
        }
        if (!c.getSharedPreferences("online", 0).edit().putString("raw", raw).putString("signature", signature)
                .putLong("highest", revision).commit()) throw new SecurityException("catalog-store");
    }

    private static void stage(Context c, LatestPointer p, String id, LatestPointer.Pin pin) throws Exception {
        File target = new File(c.getFilesDir(), Catalog.onlineFileFor(id));
        if (target.isFile()) { // already staged and still the pinned bytes
            try { p.checkApk(id, Integrity.read(new java.io.FileInputStream(target), (int) pin.maxBytes)); return; }
            catch (Exception stale) { /* fetch again */ }
        }
        byte[] bytes = fetch(pin.url, (int) pin.maxBytes);
        p.checkApk(id, bytes);
        SharedPreferences prefs = c.getSharedPreferences(AutoInstall.PREFS, 0);
        long now = System.currentTimeMillis() / 1000;
        prefs.edit().putLong("download-day", now / 86400).putLong("download-bytes", bytesToday(prefs, now) + bytes.length).commit();
        File temporary = File.createTempFile("auto-", ".apk", c.getFilesDir());
        try (FileOutputStream out = new FileOutputStream(temporary)) { out.write(bytes); out.getFD().sync(); }
        if (!temporary.renameTo(target)) { temporary.delete(); throw new SecurityException("stage"); }
    }

    /** GET over HTTPS to raw.githubusercontent.com only, no redirects, bounded body. */
    static byte[] fetch(String url, int limit) throws Exception {
        URL u = new URL(url);
        if (!"https".equals(u.getProtocol()) || !"raw.githubusercontent.com".equals(u.getHost()) || u.getPort() != -1)
            throw new SecurityException("fetch-origin");
        HttpURLConnection h = (HttpURLConnection) u.openConnection();
        h.setInstanceFollowRedirects(false);
        h.setConnectTimeout(15000);
        h.setReadTimeout(30000);
        h.setUseCaches(false);
        h.setRequestProperty("Accept-Encoding", "identity");
        try {
            if (h.getResponseCode() != 200) throw new SecurityException("fetch-status");
            if (!"raw.githubusercontent.com".equals(h.getURL().getHost())) throw new SecurityException("fetch-origin");
            long declared = h.getContentLengthLong();
            if (declared > limit) throw new SecurityException("fetch-size");
            try (InputStream in = h.getInputStream()) { return Integrity.read(in, limit); }
        } finally {
            h.disconnect();
        }
    }

    private static long bytesToday(SharedPreferences prefs, long now) {
        return prefs.getLong("download-day", -1) == now / 86400 ? prefs.getLong("download-bytes", 0) : 0;
    }

    static UpdatePolicy.Approval approval(Context c) {
        return UpdateApprovalRecord.decode(c.getSharedPreferences(AutoInstall.PREFS, 0).getString("approval", null));
    }

    /** Appends one entry to the person-visible log: {at, kind, id, detail}; keeps the last 50. */
    static synchronized void log(Context c, String kind, String id, String detail) {
        SharedPreferences prefs = c.getSharedPreferences(AutoInstall.PREFS, 0);
        try {
            JSONArray old = new JSONArray(prefs.getString("log", "[]")), next = new JSONArray();
            for (int n = Math.max(0, old.length() - (MAX_LOG - 1)); n < old.length(); n++) next.put(old.get(n));
            JSONObject e = new JSONObject().put("at", System.currentTimeMillis() / 1000).put("kind", kind).put("detail", detail);
            if (id != null) e.put("id", id);
            next.put(e);
            prefs.edit().putString("log", next.toString()).commit();
        } catch (Exception ignored) { /* the log never blocks an update */ }
    }

    static String logJson(Context c) { return c.getSharedPreferences(AutoInstall.PREFS, 0).getString("log", "[]"); }

    static void notify(Context c, String title, String text) {
        if (c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "自動更新", NotificationManager.IMPORTANCE_LOW));
        android.content.Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        Notification.Builder b = new Notification.Builder(c, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title).setContentText(text).setAutoCancel(true);
        if (open != null) b.setContentIntent(android.app.PendingIntent.getActivity(c, 0, open, android.app.PendingIntent.FLAG_IMMUTABLE));
        nm.notify(JOB_ID, b.build());
    }

    private static String join(List<String> xs) {
        StringBuilder s = new StringBuilder();
        for (String x : xs) { if (s.length() > 0) s.append(','); s.append(x); }
        return s.toString();
    }
}
