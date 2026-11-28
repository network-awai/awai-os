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
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;

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
    private static final String CHECK_OPERATION = "network.awai.store.check";
    private static volatile UpdateHttpTransport transport;

    static void configureTransport(UpdateHttpTransport updateTransport) {
        transport = updateTransport;
    }

    /** Keeps the scheduled job in line with the approval: scheduled while active, cancelled otherwise. */
    public static void sync(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null) return;
        UpdatePolicy.Approval a = approval(c);
        long now = System.currentTimeMillis() / 1000;
        boolean hasInternet = c.checkSelfPermission(Manifest.permission.INTERNET) == PackageManager.PERMISSION_GRANTED;
        if (!hasInternet || !UpdatePolicy.approvalRefusals(a, CHECK_OPERATION, now).isEmpty()) {
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
        run(c, new AutoUpdateRun());
    }

    static void run(Context c, AutoUpdateRun run) {
        long now = System.currentTimeMillis() / 1000;
        SharedPreferences prefs = c.getSharedPreferences(AutoInstall.PREFS, 0);
        try {
            requireApproval(c, run);
            Runnable authorizeKeyWrite = () -> requireApprovedEffect(c, run, null);
            KeyList key = StoreTrust.inspect(c);
            synchronized (AutoUpdateRun.EFFECTS) {
                StoreTrust.remember(c, key, authorizeKeyWrite);
            }
            // A newer key list replaces or withdraws role keys. A refused or unreachable list keeps the one in use.
            try {
                byte[] keysEnvelope = fetch(c, run, StoreTrust.URL, StoreTrust.MAX_ENVELOPE_BYTES);
                KeyList fetched;
                synchronized (AutoUpdateRun.EFFECTS) {
                    requireApproval(c, run);
                    fetched = StoreTrust.admit(c, keysEnvelope, authorizeKeyWrite);
                }
                if (fetched.sequence > key.sequence) log(c, "keys", null, "sequence " + fetched.sequence);
                key = fetched;
            }
            catch (AutoUpdateRun.Stopped stopped) { throw stopped; }
            catch (Exception notAdopted) { log(c, notAdopted instanceof SecurityException ? "keys-refused" : "keys-unreachable", null, code(notAdopted)); }
            long floor = prefs.getLong("pointer-sequence", 0);
            LatestPointer p = LatestPointer.verifyEnvelope(fetch(c, run, LatestPointer.URL, LatestPointer.MAX_ENVELOPE_BYTES), key, now, floor);
            synchronized (AutoUpdateRun.EFFECTS) {
                requireApproval(c, run);
                SharedPreferences.Editor edit = prefs.edit().putLong("pointer-sequence", p.sequence);
                run.requireEffect();
                if (!edit.commit()) throw new SecurityException("pointer-store");
            }

            byte[] envelope = fetch(c, run, p.catalog.url, (int) p.catalog.maxBytes);
            p.checkCatalog(envelope);
            synchronized (AutoUpdateRun.EFFECTS) {
                requireApproval(c, run);
                admitCatalog(c, run, envelope, key, now, p);
            }
            log(c, "catalog", null, "sequence " + p.sequence);

            Catalog catalog = new Catalog(c, true);
            JSONArray apps = new JSONObject(catalog.json()).getJSONArray("apps");
            int installed = 0, refused = 0;
            for (int n = 0; n < apps.length(); n++) {
                JSONObject app = apps.getJSONObject(n);
                String id = app.getString("id");
                long current;
                try { current = c.getPackageManager().getPackageInfo(id, 0).getLongVersionCode(); }
                catch (PackageManager.NameNotFoundException absent) { continue; }
                if (current >= app.getLong("versionCode")) continue;
                if (!p.apks.containsKey(id)) { log(c, "refused", id, "not-in-pointer"); refused++; continue; }
                LatestPointer.Pin pin = p.apks.get(id);
                if (bytesToday(prefs, now) + pin.maxBytes > AutoInstall.DAILY_BYTE_BUDGET) { log(c, "refused", id, "daily-budget"); refused++; continue; }
                AutoInstall.Result r;
                try {
                    requireApproval(c, run, id);
                    if (catalog.isOnlineDelivery(id)) stage(c, run, p, id, pin);
                    r = AutoInstall.attempt(c, id, run);
                } catch (AutoUpdateRun.Excluded excluded) {
                    log(c, "refused", id, code(excluded));
                    refused++;
                    continue;
                }
                if (r.refusals.isEmpty()) { log(c, "installing", id, app.getString("versionName")); installed++; }
                else { log(c, "refused", id, join(r.refusals)); refused++; }
            }
            synchronized (AutoUpdateRun.EFFECTS) {
                requireApproval(c, run);
                if (installed + refused == 0) log(c, "current", null, "no updates");
                if (refused > 0) notify(c, run, "更新の確認が必要です", refused + " 件の更新は自動では入れられません。Store の「更新」で確認してください。");
            }
        } catch (AutoUpdateRun.Stopped stopped) {
            if (!"job-stopped".equals(stopped.getMessage())) {
                log(c, "skip", null, code(stopped));
                sync(c);
            }
        } catch (Exception e) {
            log(c, "error", null, code(e));
        }
    }

    private static String code(Exception e) {
        String m = e.getMessage();
        return e instanceof SecurityException && m != null && m.matches("[a-z0-9-]{1,40}") ? m : e.getClass().getSimpleName();
    }

    /** Admits the pointer's catalog as the Store's online catalog after the same checks as a manual check. */
    private static void admitCatalog(Context c, AutoUpdateRun run, byte[] envelope, KeyList key, long now, LatestPointer p) throws Exception {
        JSONObject e = new JSONObject(new String(envelope, StandardCharsets.UTF_8));
        String raw = e.getString("raw"), signature = e.getString("signature");
        JSONObject candidate = Catalog.verifyMetadata(raw.getBytes(StandardCharsets.UTF_8),
                android.util.Base64.decode(signature, android.util.Base64.DEFAULT), key, now);
        Catalog.checkOnline(candidate);
        long revision = candidate.getLong("revision");
        if (revision < new Catalog(c, true).valueRevision()) throw new SecurityException("catalog-rollback");
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
        requireApproval(c, run);
        if (!Catalog.saveOnline(c, raw, signature, revision, run::requireEffect)) throw new SecurityException("catalog-store");
    }

    private static void stage(Context c, AutoUpdateRun run, LatestPointer p, String id, LatestPointer.Pin pin) throws Exception {
        File target = new File(c.getFilesDir(), Catalog.onlineFileFor(id));
        if (target.isFile()) { // already staged and still the pinned bytes
            try { p.checkApk(id, Integrity.read(new java.io.FileInputStream(target), (int) pin.maxBytes)); return; }
            catch (Exception stale) { /* fetch again */ }
        }
        byte[] bytes = fetch(c, run, pin.url, (int) pin.maxBytes, id);
        p.checkApk(id, bytes);
        saveStagedApk(c, run, id, target, bytes);
    }

    private static void saveStagedApk(Context c, AutoUpdateRun run, String id, File target, byte[] bytes) throws Exception {
        SharedPreferences prefs = c.getSharedPreferences(AutoInstall.PREFS, 0);
        File temporary = File.createTempFile("auto-", ".apk", c.getFilesDir());
        try {
            try (FileOutputStream out = new FileOutputStream(temporary)) {
                out.write(bytes);
                out.getFD().sync();
            }
            synchronized (AutoUpdateRun.EFFECTS) {
                requireApproval(c, run, id);
                long now = System.currentTimeMillis() / 1000;
                SharedPreferences.Editor edit = prefs.edit().putLong("download-day", now / 86400)
                        .putLong("download-bytes", bytesToday(prefs, now) + bytes.length);
                run.requireEffect();
                if (!edit.commit()) throw new SecurityException("stage-budget");
                run.requireEffect();
                if (!temporary.renameTo(target)) throw new SecurityException("stage");
            }
        } finally {
            temporary.delete();
        }
    }

    /** GET over HTTPS to raw.githubusercontent.com only, no redirects, bounded body. */
    private static byte[] fetch(Context c, AutoUpdateRun run, String url, int limit) throws Exception {
        return fetch(c, run, url, limit, null);
    }

    private static byte[] fetch(Context c, AutoUpdateRun run, String url, int limit, String id) throws Exception {
        requireApproval(c, run, id);
        URI u = new URI(url);
        if (!"https".equals(u.getScheme()) || !"raw.githubusercontent.com".equals(u.getHost()) || u.getPort() != -1
                || u.getRawUserInfo() != null || u.getRawFragment() != null)
            throw new SecurityException("fetch-origin");
        UpdateHttpTransport activeTransport = transport;
        if (activeTransport == null) throw new SecurityException("fetch-unavailable");
        UpdateHttpTransport.Request request = activeTransport.prepare(url, limit);
        boolean complete = false;
        try {
            synchronized (AutoUpdateRun.EFFECTS) {
                requireApproval(c, run, id);
                run.start(request);
            }
            byte[] bytes = request.receive();
            requireApproval(c, run, id);
            complete = true;
            return bytes;
        } catch (Exception e) {
            requireApproval(c, run, id);
            throw e;
        } finally {
            synchronized (AutoUpdateRun.EFFECTS) {
                run.detach(request);
                if (!complete) request.cancel();
            }
        }
    }

    private static UpdatePolicy.Approval requireApproval(Context c, AutoUpdateRun run) {
        return requireApproval(c, run, null);
    }

    static void requireApprovedEffect(Context c, AutoUpdateRun run, String id) {
        requireApproval(c, run, id);
        run.requireEffect();
    }

    static UpdatePolicy.Approval requireApproval(Context c, AutoUpdateRun run, String id) {
        run.check();
        if (c.checkSelfPermission(Manifest.permission.INTERNET) != PackageManager.PERMISSION_GRANTED)
            throw new AutoUpdateRun.Stopped("internet-permission");
        UpdatePolicy.Approval a = approval(c);
        List<String> refusals = UpdatePolicy.approvalRefusals(a, CHECK_OPERATION, System.currentTimeMillis() / 1000);
        if (!refusals.isEmpty()) throw new AutoUpdateRun.Stopped(refusals.get(0));
        if (a.unmeteredOnly && !AutoInstall.unmetered(c)) throw new AutoUpdateRun.Stopped("network-metered");
        if (id != null && a.excludedApps.contains(id)) throw new AutoUpdateRun.Excluded();
        run.check();
        return a;
    }

    private static long bytesToday(SharedPreferences prefs, long now) {
        return prefs.getLong("download-day", -1) == now / 86400 ? prefs.getLong("download-bytes", 0) : 0;
    }

    static UpdatePolicy.Approval approval(Context c) {
        return UpdateApprovalRecord.decode(c.getSharedPreferences(AutoInstall.PREFS, 0).getString("approval", null));
    }

    static boolean changeApproval(Context c, UnaryOperator<UpdatePolicy.Approval> change) {
        synchronized (AutoUpdateRun.EFFECTS) {
            UpdatePolicy.Approval next = change.apply(approval(c));
            // Superseded jobs must stay stopped even if approval is later granted again.
            AutoUpdateRun.approvalChanged();
            return c.getSharedPreferences(AutoInstall.PREFS, 0).edit()
                    .putString("approval", UpdateApprovalRecord.encode(next)).commit();
        }
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

    static void notify(Context c, AutoUpdateRun run, String title, String text) {
        if (c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "自動更新", NotificationManager.IMPORTANCE_LOW);
        run.requireEffect();
        nm.createNotificationChannel(channel);
        android.content.Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        Notification.Builder b = new Notification.Builder(c, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title).setContentText(text).setAutoCancel(true);
        if (open != null) b.setContentIntent(android.app.PendingIntent.getActivity(c, 0, open, android.app.PendingIntent.FLAG_IMMUTABLE));
        Notification notification = b.build();
        run.requireEffect();
        nm.notify(JOB_ID, notification);
    }

    private static String join(List<String> xs) {
        StringBuilder s = new StringBuilder();
        for (String x : xs) { if (s.length() > 0) s.append(','); s.append(x); }
        return s.toString();
    }
}
