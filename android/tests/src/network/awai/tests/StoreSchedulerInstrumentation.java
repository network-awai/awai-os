package network.awai.tests;

import android.Manifest;
import android.app.Activity;
import android.app.Instrumentation;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Bundle;
import java.util.Collections;
import network.awai.platform.AutoUpdateJob;
import network.awai.platform.AutoUpdater;
import network.awai.platform.UpdateApprovalRecord;

/** Exercises the Store's real JobScheduler registration in a disposable, disconnected guest. */
public final class StoreSchedulerInstrumentation extends Instrumentation {
    private static final int JOB_ID = 3668;
    private static final long DAY_MS = 24L * 60 * 60 * 1000;
    private Bundle arguments;

    @Override public void onCreate(Bundle args) {
        super.onCreate(args);
        arguments = args;
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            exercise(getTargetContext());
            result.putString("stream", "\nStore scheduler PASS API " + Build.VERSION.SDK_INT
                    + ": absent -> persisted unmetered -> persisted any network -> absent; original approval restored\n");
            finish(Activity.RESULT_OK, result);
        } catch (Exception failure) {
            result.putString("stream", "\nStore scheduler FAIL API " + Build.VERSION.SDK_INT
                    + ": " + failure.getMessage() + "\n");
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void exercise(Context target) {
        require("true".equals(arguments.getString("disposable")), "use a disposable guest");
        require(Integer.toString(Build.VERSION.SDK_INT).equals(arguments.getString("api")), "unexpected Android API");
        require((target.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0,
                "target must be the debuggable QA Store");
        require(target.checkSelfPermission(Manifest.permission.INTERNET) == PackageManager.PERMISSION_GRANTED,
                "target must be the online QA Store");
        requireDisconnected(target);
        JobScheduler scheduler = target.getSystemService(JobScheduler.class);
        require(scheduler != null && scheduler.getPendingJob(JOB_ID) == null, "guest already has Store job 3668");
        SharedPreferences prefs = target.getSharedPreferences("auto-update", Context.MODE_PRIVATE);
        String original = prefs.getString("approval", null);
        require(!UpdateApprovalRecord.decode(original).enabled, "guest already has standing approval");
        try {
            setAndSync(target, prefs, grant(true));
            requireJob(target, scheduler.getPendingJob(JOB_ID), true);
            setAndSync(target, prefs, grant(false));
            requireJob(target, scheduler.getPendingJob(JOB_ID), false);
            setAndSync(target, prefs, UpdateApprovalRecord.encode(UpdateApprovalRecord.revoke(
                    UpdateApprovalRecord.decode(prefs.getString("approval", null)))));
            require(scheduler.getPendingJob(JOB_ID) == null, "revocation left job 3668 pending");
        } finally {
            // Remove the fixture job even if persisting the original approval fails.
            scheduler.cancel(JOB_ID);
            require(prefs.edit().putString("approval", original).commit(), "could not restore original approval");
            require(scheduler.getPendingJob(JOB_ID) == null, "fixture job still pending after cleanup");
        }
    }

    private static String grant(boolean unmeteredOnly) {
        return UpdateApprovalRecord.encode(UpdateApprovalRecord.grant(
                System.currentTimeMillis() / 1000, unmeteredOnly, Collections.emptySet()));
    }

    private static void setAndSync(Context context, SharedPreferences prefs, String value) {
        requireDisconnected(context);
        require(prefs.edit().putString("approval", value).commit(), "could not save fixture approval");
        AutoUpdater.sync(context);
    }

    private static void requireJob(Context context, JobInfo job, boolean unmetered) {
        require(job != null, "standing approval did not schedule job 3668");
        require(context.getPackageName().equals(job.getService().getPackageName())
                && AutoUpdateJob.class.getName().equals(job.getService().getClassName()), "unexpected job service");
        require(job.isPersisted() && job.isPeriodic() && job.getIntervalMillis() == DAY_MS,
                "job must be persisted and run daily");
        NetworkRequest network = job.getRequiredNetwork();
        require(network != null && network.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && network.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == unmetered,
                "unexpected job network constraint");
    }

    private static void requireDisconnected(Context target) {
        ConnectivityManager connectivity = target.getSystemService(ConnectivityManager.class);
        require(connectivity != null && connectivity.getAllNetworks().length == 0, "guest still has an Android network");
    }

    private static void require(boolean condition, String failure) {
        if (!condition) throw new IllegalStateException(failure);
    }
}
