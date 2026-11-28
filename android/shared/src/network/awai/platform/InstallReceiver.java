package network.awai.platform;
import android.content.*;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import java.io.IOException;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/** Private explicit PendingIntent callback, bound to a recorded install session. */
public final class InstallReceiver extends BroadcastReceiver {
    private static final Executor AUTOMATIC_RESULTS = Executors.newSingleThreadExecutor();

    static void resumeAutomaticResults(Context context) {
        AUTOMATIC_RESULTS.execute(() -> AutoInstall.pendingAutomaticResults(context).forEach(
                (session, id) -> automaticResult(context, session, null, id)));
    }

    @Override public void onReceive(Context context,Intent intent){
        int session=intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1);
        int result=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
        String id=intent.getStringExtra("package");
        if(intent.getBooleanExtra("auto",false)){
            PendingResult pending = goAsync();
            Context app = context.getApplicationContext();
            AUTOMATIC_RESULTS.execute(() -> {
                try { automaticResult(app, session, result, id); }
                finally { pending.finish(); }
            });
            return;
        }
        if(session<0||session!=context.getSharedPreferences("host",0).getInt("install-session",-2))return;
        if(result==PackageInstaller.STATUS_PENDING_USER_ACTION){
            Intent confirm=intent.getParcelableExtra(Intent.EXTRA_INTENT,Intent.class);
            if(confirm!=null)context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }else{
            AutoInstall.finished(context,session,result==PackageInstaller.STATUS_SUCCESS,id);
            context.getSharedPreferences("host",0).edit().remove("install-session").putString("message",result==PackageInstaller.STATUS_SUCCESS?"Android の追加処理が完了しました。ライブラリから開けます。":"追加は完了していません。内容を確認してやり直してください。").apply();
            Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());if(launch!=null)context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
    }

    private static void automaticResult(Context context, int session, Integer result, String id) {
        AutoInstall.Completion completion = persistAutomaticResult(context, session, result, id);
        if (completion == null) return;
        boolean needsApproval = completion.status == PackageInstaller.STATUS_PENDING_USER_ACTION;
        boolean installed = completion.status == PackageInstaller.STATUS_SUCCESS;
        if (needsApproval) {
            // AWAI-3663: never open the installer screen from the background.
            try { context.getPackageManager().getPackageInstaller().abandonSession(session); }
            catch (RuntimeException ignored) { /* Android already discarded the session. */ }
            AutoUpdater.log(context, "needs-approval", id, "android-asked");
        } else {
            AutoUpdater.log(context, installed ? "installed" : "failed", id, installed ? "" : "status-" + completion.status);
        }

        // Record already-committed outcomes even if the job was stopped or the app process
        // restarted. Only the original, still-approved run can emit a new notification.
        if (completion.run == null || (!needsApproval && !installed)) return;
        synchronized (AutoUpdateRun.EFFECTS) {
            try {
                AutoUpdater.requireApproval(context, completion.run, id);
                if (needsApproval) {
                    AutoUpdater.notify(context, completion.run, "更新の確認が必要です", "Android が確認を求めました。Store の「更新」から確認してください。");
                    SharedPreferences.Editor edit = context.getSharedPreferences("host", 0).edit()
                            .putString("message", "更新には確認が必要です。「更新」から確認してください。");
                    completion.run.requireEffect();
                    edit.apply();
                } else {
                    String name = id;
                    try {
                        name = String.valueOf(context.getPackageManager().getApplicationLabel(
                                context.getPackageManager().getApplicationInfo(id, 0)));
                    } catch (PackageManager.NameNotFoundException ignored) { }
                    completion.run.check();
                    AutoUpdater.notify(context, completion.run, name + " を更新しました", "自動更新で新しい版を入れました。");
                }
            } catch (AutoUpdateRun.Stopped | AutoUpdateRun.Excluded ignored) { }
        }
    }

    private static AutoInstall.Completion persistAutomaticResult(Context context, int session, Integer result, String id) {
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                return AutoInstall.finishAutomatic(context, session, result, id);
            } catch (IOException failure) {
                android.util.Log.w("AwaiAutoInstall", "Could not persist automatic result for session " + session, failure);
            }
        }
        return null;
    }
}
