package network.awai.platform;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
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

    /** The outcome of one attempt; {@code refusals} is empty when an install session was committed. */
    public static final class Result {
        public final List<String> refusals;
        public final int sessionId;
        Result(List<String> refusals, int sessionId) { this.refusals = refusals; this.sessionId = sessionId; }
    }

    public static Result attempt(Context c, String id) {
        File verified = null;
        try {
            Catalog catalog = new Catalog(c);
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

            Set<String> ops = k.operations;
            int session = commit(c, id, verified);
            prefs.edit().putLong("bytes-day", now / 86400).putLong("bytes-used", bytesToday(prefs, now) + verified.length())
                    .putString("pending-ops-" + session, encodeOps(ops)).putInt("auto-session", session).commit();
            return new Result(Collections.<String>emptyList(), session);
        } catch (Exception e) {
            String m = e.getMessage();
            if (e instanceof SecurityException && m != null && m.matches("[a-z0-9-]{1,40}")) return refused(m);
            android.util.Log.w("AwaiAutoInstall", "attempt failed for " + id, e);
            return refused("error-" + e.getClass().getSimpleName());
        } finally {
            if (verified != null && !verified.delete()) verified.deleteOnExit();
        }
    }

    /** Called by {@link InstallReceiver} with a session's final status (automatic or person-confirmed). */
    static void finished(Context c, int session, boolean success, String id) {
        SharedPreferences prefs = c.getSharedPreferences(PREFS, 0);
        SharedPreferences.Editor e = prefs.edit();
        if (prefs.getInt("auto-session", -2) == session) e.remove("auto-session");
        String ops = prefs.getString("pending-ops-" + session, null);
        e.remove("pending-ops-" + session);
        if (success && id != null) { if (ops != null) e.putString("installed-ops-" + id, ops); else e.remove("installed-ops-" + id); }
        e.commit();
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

    private static int commit(Context c, String id, File verified) throws Exception {
        PackageInstaller installer = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(id);
        params.setSize(verified.length());
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(verified); OutputStream out = session.openWrite("base.apk", 0, verified.length())) {
                byte[] buffer = new byte[65536];
                int n;
                while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                session.fsync(out);
            }
            Intent callback = new Intent(c, InstallReceiver.class).setAction(c.getPackageName() + ".AUTO_INSTALL_RESULT")
                    .putExtra("auto", true).putExtra("package", id);
            PendingIntent status = PendingIntent.getBroadcast(c, sessionId, callback, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            session.commit(status.getIntentSender());
        } catch (Exception e) {
            installer.abandonSession(sessionId);
            throw e;
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

    private static Set<String> installedOperations(SharedPreferences prefs, String id, PackageInfo installed) {
        if (!permissions(installed).contains(INTERNET)) return new HashSet<>();
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
    private static boolean unmetered(Context c) {
        try {
            ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
            NetworkCapabilities caps = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
        } catch (SecurityException noPermission) {
            return false;
        }
    }
}
