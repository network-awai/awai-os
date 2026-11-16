package network.awai.platform;
import android.content.*;
import android.content.pm.PackageInstaller;

/** Private explicit PendingIntent callback, bound to this app's current session. */
public final class InstallReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        int session=intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1);
        if(session<0||session!=context.getSharedPreferences("host",0).getInt("install-session",-2))return;
        int result=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
        if(result==PackageInstaller.STATUS_PENDING_USER_ACTION){
            Intent confirm=intent.getParcelableExtra(Intent.EXTRA_INTENT,Intent.class);
            if(confirm!=null)context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }else{
            context.getSharedPreferences("host",0).edit().remove("install-session").putString("message",result==PackageInstaller.STATUS_SUCCESS?"Android の追加処理が完了しました。ライブラリから開けます。":"追加は完了していません。内容を確認してやり直してください。").apply();
            Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());if(launch!=null)context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
    }
}
