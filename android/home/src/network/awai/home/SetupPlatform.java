package network.awai.home;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import org.json.JSONObject;

/** Platform observations and bounded persistence. Never stores a PIN or identity credential. */
public final class SetupPlatform {
    private SetupPlatform() {}
    public static JSONObject snapshot(Context c) throws Exception {
        SharedPreferences p=c.getSharedPreferences("android-setup-v1",0);
        ConnectivityManager cm=c.getSystemService(ConnectivityManager.class);
        NetworkCapabilities n=cm.getNetworkCapabilities(cm.getActiveNetwork());
        boolean connected=n!=null;
        boolean validated=connected&&n.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        boolean secure=c.getSystemService(KeyguardManager.class).isDeviceSecure();
        JSONObject o=new JSONObject();
        o.put("stage",p.getInt("stage",0));o.put("complete",p.getBoolean("complete",false)&&secure);
        o.put("connected",connected);o.put("validated",validated);
        o.put("captive",connected&&n.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL));
        o.put("secure",secure);o.put("offline",p.getBoolean("offline",false));
        o.put("account","deferred".equals(p.getString("account",""))?"deferred":"unlinked");
        o.put("locale",c.getResources().getConfiguration().getLocales().get(0).toLanguageTag());
        o.put("timeZone",java.util.TimeZone.getDefault().getID());
        o.put("identityEnrollment",false);o.put("osProvisioning",false);
        return o;
    }
    public static synchronized boolean transition(Context c,String action,int expected) {
        try {
            JSONObject s=snapshot(c);int stage=s.getInt("stage");
            if(expected!=stage||s.getBoolean("complete"))return false;
            SharedPreferences.Editor e=c.getSharedPreferences("android-setup-v1",0).edit();
            if("back".equals(action)&&stage>0)e.putInt("stage",stage-1);
            else if("offline".equals(action)&&stage==2)e.putBoolean("offline",true).putInt("stage",3);
            else if("defer".equals(action)&&stage==4)e.putString("account","deferred").putInt("stage",5);
            else if("next".equals(action)&&stage>=0&&stage<7) {
                if(stage==2&&!s.getBoolean("validated")&&!s.getBoolean("offline"))return false;
                if(stage==4)return false;
                if(stage==6&&!s.getBoolean("secure"))return false;
                e.putInt("stage",stage+1);
            } else if("finish".equals(action)&&stage==7&&s.getBoolean("secure")&&"deferred".equals(s.getString("account")))
                e.putBoolean("complete",true);
            else return false;
            return e.commit();
        } catch(Exception unavailable) { return false; }
    }
}
