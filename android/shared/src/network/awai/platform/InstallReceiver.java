package network.awai.platform;
import android.content.*;
import android.content.pm.PackageInstaller;

/** Private explicit PendingIntent callback, bound to this app's current session. */
public final class InstallReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        int session=intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1);
        int result=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
        String id=intent.getStringExtra("package");
        if(intent.getBooleanExtra("auto",false)){
            // AWAI-3663: an automatic update. Never open the installer screen from the background.
            if(session<0||session!=context.getSharedPreferences(AutoInstall.PREFS,0).getInt("auto-session",-2))return;
            if(result==PackageInstaller.STATUS_PENDING_USER_ACTION){
                context.getPackageManager().getPackageInstaller().abandonSession(session);
                AutoInstall.finished(context,session,false,id);
                AutoUpdater.log(context,"needs-approval",id,"android-asked");
                AutoUpdater.notify(context,"更新の確認が必要です","Android が確認を求めました。Store の「更新」から確認してください。");
                context.getSharedPreferences("host",0).edit().putString("message","更新には確認が必要です。「更新」から確認してください。").apply();
            }else{
                boolean ok=result==PackageInstaller.STATUS_SUCCESS;
                AutoInstall.finished(context,session,ok,id);
                AutoUpdater.log(context,ok?"installed":"failed",id,ok?"":"status-"+result);
                if(ok){String name=id;try{name=String.valueOf(context.getPackageManager().getApplicationLabel(context.getPackageManager().getApplicationInfo(id,0)));}catch(Exception ignored){}
                    AutoUpdater.notify(context,name+" を更新しました","自動更新で新しい版を入れました。");}
            }
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
}
