package network.awai.home;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import org.json.JSONObject;

/** Platform observations and bounded persistence. Never stores a PIN or identity credential. */
public final class SetupPlatform {
    // AOSP setup owns language (1), network (2), date/time (3) and screen lock (6).
    // Their indices stay reserved so saved progress keeps its meaning.
    static boolean retired(int stage){return stage==1||stage==2||stage==3||stage==6;}
    static int forward(int stage){while(retired(stage))stage++;return stage;}
    static int backward(int stage){while(stage>0&&retired(stage))stage--;return stage;}
    private SetupPlatform() {}
    public static JSONObject snapshot(Context c) throws Exception {
        SharedPreferences p=c.getSharedPreferences("android-setup-v1",0);
        ConnectivityManager cm=c.getSystemService(ConnectivityManager.class);
        NetworkCapabilities n=cm.getNetworkCapabilities(cm.getActiveNetwork());
        boolean connected=n!=null;
        boolean validated=connected&&n.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        boolean secure=c.getSystemService(KeyguardManager.class).isDeviceSecure();
        JSONObject o=new JSONObject();
        // A saved retired stage resumes at the next remaining one.
        int stage=forward(p.getInt("stage",0));
        o.put("stage",stage);o.put("complete",p.getBoolean("complete",false)&&secure);
        o.put("connected",connected);o.put("validated",validated);
        o.put("captive",connected&&n.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL));
        o.put("secure",secure);
        // Flow marker only. Browser must reverify the saved awai.link.v1 proof
        // against its non-exportable device key before treating this as identity.
        o.put("account",p.getString("account","unlinked"));
        o.put("locale",c.getResources().getConfiguration().getLocales().get(0).toLanguageTag());
        o.put("timeZone",java.util.TimeZone.getDefault().getID());
        o.put("identityEnrollment",true);o.put("osProvisioning",false);
        return o;
    }
    public static synchronized boolean transition(Context c,String action,int expected) {
        try {
            JSONObject s=snapshot(c);int stage=s.getInt("stage");
            if(expected!=stage)return false;
            SharedPreferences.Editor e=c.getSharedPreferences("android-setup-v1",0).edit();
            if("relink".equals(action)&&"linked".equals(s.getString("account")))
                return e.putInt("stage",4).putBoolean("complete",false).putString("account","unlinked").commit();
            if(s.getBoolean("complete"))return false;
            if("back".equals(action)&&stage>0)e.putInt("stage",backward(stage-1));
            else if("defer".equals(action)&&stage==4)e.putString("account","deferred").putInt("stage",5);
            else if("linked".equals(action)&&stage==4)e.putString("account","linked").putInt("stage",5);
            else if("next".equals(action)&&stage>=0&&stage<7) {
                if(stage==4)return false;
                e.putInt("stage",forward(stage+1));
            } else if("finish".equals(action)&&stage==7&&s.getBoolean("secure")&&("deferred".equals(s.getString("account"))||"linked".equals(s.getString("account"))))
                e.putBoolean("complete",true);
            else return false;
            return e.commit();
        } catch(Exception unavailable) { return false; }
    }
}
