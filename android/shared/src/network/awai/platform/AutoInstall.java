package network.awai.platform;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.content.SharedPreferences;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.*;

/**
 * Installs an update without asking when, and only when, {@link UpdatePolicy} finds it eligible
 * under the person's standing update approval (AWAI-3653, step 4).
 *
 * <p>Every fact comes from a verified source: the authenticated catalog, the hashed APK (via
 * {@link Catalog#verifiedApkFile}), PackageManager and the host's own records. Anything that cannot
 * be established is a refusal, and a refused update stays an ordinary update that the person
 * confirms as before. If Android still asks for confirmation, the host records that and waits; it
 * never opens the installer screen from the background.
 */
public final class AutoInstall {
    private AutoInstall() {}

    public static final long DAILY_BYTE_BUDGET = 200L * 1024 * 1024;
    static final String PREFS = "auto-update";
    static final String INTERNET = "android.permission.INTERNET";
    private static final Map<Integer, AutoUpdateRun> AUTOMATIC_RUNS = new HashMap<>();
    private static final String RESULT_ID = "auto-result-package-";
    private static final String RESULT_STATUS = "auto-result-status-";
    private static final String RESULTS = "auto-result-history";

    /** The outcome of one attempt; {@code refusals} is empty when an install session was committed. */
    public static final class Result {
        public final List<String> refusals;
        public final int sessionId;
        Result(List<String> refusals, int sessionId) { this.refusals = refusals; this.sessionId = sessionId; }
    }

    public static Result attempt(Context c, String id) {
        return attempt(c, id, new AutoUpdateRun());
    }

    static Result attempt(Context c, String id, AutoUpdateRun run) {
        File verified = null;
        try {
            AutoUpdater.requireApproval(c, run, id);
            Catalog catalog = new Catalog(c, true);
            JSONObject entry = catalog.app(id);
            verified = catalog.verifiedApkFile(c, id); // size, SHA-256, package, version, signer, no downgrade
            PackageManager pm = c.getPackageManager();
            int flags = PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_PERMISSIONS;
            PackageInfo installed;
            try { installed = pm.getPackageInfo(id, flags); }
            catch (PackageManager.NameNotFoundException absent) { return refused("not-installed"); }
            PackageInfo candidate = pm.getPackageArchiveInfo(verified.getAbsolutePath(), flags);
            if (candidate == null) return refused("candidate-unreadable");

            SharedPreferences prefs = c.getSharedPreferences(PREFS, 0);
            long now = System.currentTimeMillis() / 1000;
            UpdatePolicy.Approval approval = UpdateApprovalRecord.decode(prefs.getString("approval", null));
            String installer = null;
            try { InstallSourceInfo source = pm.getInstallSourceInfo(id); installer = source.getInstallingPackageName(); }
            catch (Exception unknown) { /* not installed by us */ }

            UpdatePolicy.Installed i = new UpdatePolicy.Installed(id, installed.getLongVersionCode(), signer(installed),
                    c.getPackageName().equals(installer), permissions(installed),
                    installedOperations(prefs, id, installed));
            JSONObject artifact = catalog.artifact(id);
            UpdatePolicy.Candidate k = new UpdatePolicy.Candidate(true, catalog.valueRevision(), catalogExpiresAt(catalog),
                    candidate.packageName, candidate.getLongVersionCode(), signer(candidate), verified.length(),
                    verified.length() == artifact.getLong("bytes"), // verifiedApkFile already matched size and SHA-256
                    permissions(candidate), candidateOperations(entry, candidate));
            UpdatePolicy.Device d = new UpdatePolicy.Device(now, admittedRevision(c), Catalog.maxApkBytes(id),
                    bytesToday(prefs, now), DAILY_BYTE_BUDGET, unmetered(c));
            List<String> refusals = UpdatePolicy.refusals(approval, i, k, d);
            if (!refusals.isEmpty()) return new Result(refusals, -1);

            int session = commit(c, id, verified, candidate.getLongVersionCode(), k.operations, run);
            prefs.edit().putLong("bytes-day", now / 86400).putLong("bytes-used", bytesToday(prefs, now) + verified.length())
                    .commit();
            return new Result(Collections.<String>emptyList(), session);
        } catch (AutoUpdateRun.Stopped | AutoUpdateRun.Excluded e) {
            throw e;
        } catch (Exception e) {
            String m = e.getMessage();
            if (e instanceof SecurityException && m != null && m.matches("[a-z0-9-]{1,40}")) return refused(m);
            android.util.Log.w("AwaiAutoInstall", "attempt failed for " + id, e);
            return refused("error-" + e.getClass().getSimpleName());
        } finally {
            if (verified != null && !verified.delete()) verified.deleteOnExit();
        }
    }

    /** Called by {@link InstallReceiver} with a person-confirmed session's final status. */
    static synchronized void finished(Context c, int session, boolean success, String id) {
        SharedPreferences prefs = c.getSharedPreferences(PREFS, 0);
        SharedPreferences.Editor e = prefs.edit();
        String ops = prefs.getString("pending-ops-" + session, null);
        e.remove("pending-ops-" + session);
        if (success && id != null) {
            e.putString("installed-ops-" + id, ops).remove("installed-ops-version-" + id);
        }
        e.commit();
    }

    static final class Completion {
        final AutoUpdateRun run;
        final int status;
        Completion(AutoUpdateRun run, int status) { this.run = run; this.status = status; }
    }

    /** Keep the received status on disk before consuming the original install request. */
    static synchronized Completion finishAutomatic(Context c, int session, Integer reportedStatus, String id) throws IOException {
        if (session < 0 || id == null) return null;
        SharedPreferences prefs = c.getSharedPreferences(PREFS, 0);
        String resultPackage = prefs.getString(RESULT_ID + session, null);
        if (resultPackage != null && !id.equals(resultPackage)) return null;
        String recordedId = prefs.getString("pending-auto-package-" + session, null);
        boolean legacy = recordedId == null && prefs.getInt("auto-session", -2) == session;
        if (!legacy && !id.equals(recordedId)) return null;
        int status;
        if (resultPackage == null) {
            if (reportedStatus == null) return null;
            status = reportedStatus;
            if (!prefs.edit().putString(RESULT_ID + session, id).putInt(RESULT_STATUS + session, status).commit()) {
                // A failed SharedPreferences commit still changes that instance's
                // cache. Restore the in-memory state before a retry or redelivery.
                prefs.edit().remove(RESULT_ID + session).remove(RESULT_STATUS + session).apply();
                throw new IOException("install-result-write");
            }
        } else {
            status = prefs.getInt(RESULT_STATUS + session, PackageInstaller.STATUS_FAILURE);
        }

        long expectedVersion = prefs.getLong("pending-auto-version-" + session, -1);
        String ops = prefs.getString("pending-ops-" + session, null);
        String history = prefs.getString(RESULTS, "");
        SharedPreferences.Editor edit = removeAutomaticRecord(prefs, session)
                .remove(RESULT_ID + session).remove(RESULT_STATUS + session)
                .putString(RESULTS, addResult(history, session, id, status));
        if (legacy) edit.remove("auto-session");
        String installedOps = "installed-ops-" + id;
        String installedVersion = "installed-ops-version-" + id;
        String priorOps = prefs.getString(installedOps, null);
        long priorVersion = prefs.getLong(installedVersion, -1);
        boolean updateOps = status == PackageInstaller.STATUS_SUCCESS && (legacy || isInstalledVersion(c, id, expectedVersion));
        if (updateOps) {
            edit.putString(installedOps, ops);
            if (legacy || ops == null) edit.remove(installedVersion);
            else edit.putLong(installedVersion, expectedVersion);
        }
        if (!edit.commit()) {
            SharedPreferences.Editor restore = prefs.edit().putString(RESULTS, history)
                    .putString(RESULT_ID + session, id).putInt(RESULT_STATUS + session, status)
                    .putString("pending-ops-" + session, ops);
            if (legacy) restore.putInt("auto-session", session);
            else restore.putString("pending-auto-package-" + session, recordedId).putLong("pending-auto-version-" + session, expectedVersion);
            if (updateOps) {
                restore.putString(installedOps, priorOps);
                if (priorVersion == -1) restore.remove(installedVersion);
                else restore.putLong(installedVersion, priorVersion);
            }
            restore.apply();
            throw new IOException("install-result-commit");
        }
        return new Completion(AUTOMATIC_RUNS.remove(session), status);
    }

    /** Reload durable results on app restart without requesting a second installation. */
    static Map<Integer, String> pendingAutomaticResults(Context c) {
        Map<Integer, String> received = new HashMap<>();
        for (Map.Entry<String, ?> entry : c.getSharedPreferences(PREFS, 0).getAll().entrySet()) {
            if (!entry.getKey().startsWith(RESULT_ID) || !(entry.getValue() instanceof String)) continue;
            try {
                received.put(Integer.parseInt(entry.getKey().substring(RESULT_ID.length())), (String) entry.getValue());
            } catch (NumberFormatException ignored) { }
        }
        return received;
    }

    private static String addResult(String history, int session, String id, int status) {
        String[] previous = history.isEmpty() ? new String[0] : history.split("\n");
        StringBuilder next = new StringBuilder();
        for (int n = Math.max(0, previous.length - 49); n < previous.length; n++) next.append(previous[n]).append('\n');
        return next.append(session).append(' ').append(id).append(' ').append(status).toString();
    }

    private static boolean isInstalledVersion(Context c, String id, long expected) {
        try {
            return c.getPackageManager().getPackageInfo(id, 0).getLongVersionCode() == expected;
        } catch (PackageManager.NameNotFoundException unavailable) {
            return false;
        }
    }

    private static synchronized void recordAutomatic(Context c, int session, String id, long version,
            Set<String> ops, AutoUpdateRun run) {
        SharedPreferences prefs = c.getSharedPreferences(PREFS, 0);
        SharedPreferences.Editor edit = prefs.edit().putString("pending-auto-package-" + session, id)
                .putLong("pending-auto-version-" + session, version)
                .putString("pending-ops-" + session, encodeOps(ops));
        run.requireEffect();
        if (!edit.commit()) throw new SecurityException("session-record");
        AUTOMATIC_RUNS.put(session, run);
    }

    private static synchronized void discardAutomatic(Context c, int session) {
        AUTOMATIC_RUNS.remove(session);
        removeAutomaticRecord(c.getSharedPreferences(PREFS, 0), session).commit();
    }

    private static SharedPreferences.Editor removeAutomaticRecord(SharedPreferences prefs, int session) {
        return prefs.edit().remove("pending-auto-package-" + session)
                .remove("pending-auto-version-" + session).remove("pending-ops-" + session);
    }

    /**
     * Before a person-confirmed install is committed: remember what operations it brings, so the
     * record becomes the installed state only if that install succeeds ({@link #finished}).
     */
    static void rememberPending(Context c, int session, JSONObject entry, File apk) {
        try {
            PackageInfo p = c.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_PERMISSIONS);
            Set<String> ops = p == null ? null : candidateOperations(entry, p);
            SharedPreferences.Editor e = c.getSharedPreferences(PREFS, 0).edit();
            if (ops == null) e.remove("pending-ops-" + session); else e.putString("pending-ops-" + session, encodeOps(ops));
            e.commit();
        } catch (Exception ignored) { /* unknown stays unknown */ }
    }

    private static int commit(Context c, String id, File verified, long version, Set<String> ops, AutoUpdateRun run) throws Exception {
        PackageInstaller installer = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(id);
        params.setSize(verified.length());
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int sessionId;
        synchronized (AutoUpdateRun.EFFECTS) {
            AutoUpdater.requireApproval(c, run, id);
            run.requireEffect();
            sessionId = installer.createSession(params);
        }
        boolean submitted = false;
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            run.check();
            try (InputStream in = new FileInputStream(verified); OutputStream out = session.openWrite("base.apk", 0, verified.length())) {
                byte[] buffer = new byte[65536];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    run.check();
                    out.write(buffer, 0, n);
                }
                run.check();
                session.fsync(out);
            }
            Intent callback = new Intent(c, InstallReceiver.class).setAction(c.getPackageName() + ".AUTO_INSTALL_RESULT")
                    .putExtra("auto", true).putExtra("package", id);
            PendingIntent status = PendingIntent.getBroadcast(c, sessionId, callback, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            IntentSender sender = status.getIntentSender();
            synchronized (AutoUpdateRun.EFFECTS) {
                AutoUpdater.requireApproval(c, run, id);
                recordAutomatic(c, sessionId, id, version, ops, run);
                AutoUpdater.requireApproval(c, run, id);
                run.requireEffect();
                session.commit(sender);
                submitted = true;
            }
        } catch (Exception e) {
            if (!submitted) {
                discardAutomatic(c, sessionId);
                try { installer.abandonSession(sessionId); }
                catch (RuntimeException cleanup) { e.addSuppressed(cleanup); }
                throw e;
            }
            android.util.Log.w("AwaiAutoInstall", "session close failed after submission", e);
        }
        return sessionId;
    }

    private static Result refused(String code) { return new Result(Collections.singletonList(code), -1); }

    private static String signer(PackageInfo p) throws Exception {
        if (p.signingInfo == null || p.signingInfo.hasMultipleSigners()) return null;
        android.content.pm.Signature[] s = p.signingInfo.getApkContentsSigners();
        return s.length == 1 ? Integrity.sha256(s[0].toByteArray()) : null;
    }

    private static Set<String> permissions(PackageInfo p) {
        return p.requestedPermissions == null ? new HashSet<String>() : new HashSet<>(Arrays.asList(p.requestedPermissions));
    }

    /** No INTERNET permission: no external operation is possible. Otherwise the signed catalog must declare them. */
    static Set<String> candidateOperations(JSONObject entry, PackageInfo apk) throws Exception {
        if (!permissions(apk).contains(INTERNET)) return new HashSet<>();
        JSONArray ops = entry.optJSONArray("operations");
        if (ops == null || ops.length() > 64) return null;
        Set<String> out = new TreeSet<>();
        for (int n = 0; n < ops.length(); n++) {
            Object o = ops.get(n);
            if (!(o instanceof String) || ((String) o).isEmpty() || ((String) o).length() > 256 || !((String) o).matches("[\\x21-\\x7e]+"))
                return null;
            out.add((String) o);
        }
        return out;
    }

    private static synchronized Set<String> installedOperations(SharedPreferences prefs, String id, PackageInfo installed) {
        if (!permissions(installed).contains(INTERNET)) return new HashSet<>();
        long recordedVersion = prefs.getLong("installed-ops-version-" + id, -1);
        if (recordedVersion != -1 && recordedVersion != installed.getLongVersionCode()) return null;
        String s = prefs.getString("installed-ops-" + id, null);
        return s == null ? null : decodeOps(s);
    }

    private static String encodeOps(Set<String> ops) { return ops == null ? null : new JSONArray(ops).toString(); }

    private static Set<String> decodeOps(String s) {
        try { JSONArray a = new JSONArray(s); Set<String> out = new TreeSet<>(); for (int n = 0; n < a.length(); n++) out.add(a.getString(n)); return out; }
        catch (Exception bad) { return null; }
    }

    private static long catalogExpiresAt(Catalog catalog) throws Exception {
        return new JSONObject(catalog.json()).getLong("expiresAt");
    }

    private static long admittedRevision(Context c) throws Exception {
        return c.getSharedPreferences("online", 0).getLong("highest", 0);
    }

    private static long bytesToday(SharedPreferences prefs, long now) {
        return prefs.getLong("bytes-day", -1) == now / 86400 ? prefs.getLong("bytes-used", 0) : 0;
    }

    /** Unknown (no network permission in an offline build, no active network) counts as metered. */
    static boolean unmetered(Context c) {
        try {
            ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
            NetworkCapabilities caps = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
        } catch (SecurityException noPermission) {
            return false;
        }
    }
}
