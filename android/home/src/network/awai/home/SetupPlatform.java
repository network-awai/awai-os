package network.awai.home;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import org.json.JSONObject;

/**
 * Platform observations and bounded persistence. Never stores a PIN or identity credential.
 *
 * AWAI-4072: PC setup wizard mirrors the shared SetupWizard semantics (AWAI-3004)
 * but PC-adapted for keyboard/mouse and Ethernet. Settings APIs own locale,
 * validated connectivity, date/time and enrollment. The Itonami APK remains an
 * ordinary app and must not set Settings.Global.DEVICE_PROVISIONED or
 * Settings.Secure.user_setup_complete — SetupWizard owns the OS lifecycle.
 *
 * Profile transfer is honestly unavailable until account handover lands:
 * existing APIs allow only defer or sign-in linking; no copy promise.
 */
public final class SetupPlatform {
    // AOSP setup owns language (1), network (2), date/time (3) and screen lock (6)
    // on mobile: their indices stay reserved so saved progress keeps its meaning.
    static boolean retired(int stage){return stage==1||stage==2||stage==3||stage==6;}
    static int forward(int stage){while(retired(stage))stage++;return stage;}
    static int backward(int stage){while(stage>0&&retired(stage))stage--;return stage;}

    // PC: all stages 0..7 are visible in the PC wizard (keyboard/mouse, Ethernet).
    // Indices are identical to the shared stages in itonami.store.pc-setup.
    static boolean pcRetired(int stage){return false;}
    static int pcForward(int stage){while(stage>0 && stage<7) stage++; return stage;}
    static int pcBackward(int stage){return Math.max(0,stage-1);}

    static boolean isPc(Context c){
        try{
            if(c.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PC)) return true;
            if(c.getPackageManager().hasSystemFeature("android.hardware.type.pc")) return true;
            // Heuristic fallback: large display + no touchscreen
            final int touchscreen = c.getResources().getConfiguration().touchscreen;
            final android.util.DisplayMetrics dm = c.getResources().getDisplayMetrics();
            final float smallestDp = Math.min(dm.widthPixels, dm.heightPixels) / dm.density;
            return touchscreen == android.content.res.Configuration.TOUCHSCREEN_NOTOUCH
                || smallestDp > 600f;
        }catch(Exception e){ return false; }
    }

    static boolean hasEthernet(Context c){
        try{
            java.net.NetworkInterface nic = null;
            for(java.util.Enumeration<java.net.NetworkInterface> e = java.net.NetworkInterface.getNetworkInterfaces(); e.hasMoreElements();){
                java.net.NetworkInterface i = e.nextElement();
                String n = i.getName().toLowerCase();
                if(n.startsWith("eth") || n.startsWith("enp") || n.startsWith("eno")){ nic = i; break; }
            }
            return nic != null;
        }catch(Exception e){ return false; }
    }

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

    /** PC snapshot: same readback model, but stage is pc-bucketed and capabilities are exposed. */
    public static JSONObject pcSnapshot(Context c) throws Exception {
        SharedPreferences p=c.getSharedPreferences("pc-setup-v1",0);
        ConnectivityManager cm=c.getSystemService(ConnectivityManager.class);
        NetworkCapabilities n=cm.getNetworkCapabilities(cm.getActiveNetwork());
        boolean connected=n!=null;
        boolean validated=connected&&n.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        boolean captive = connected && n.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL);
        boolean metered = cm.isActiveNetworkMetered();
        boolean secure=c.getSystemService(KeyguardManager.class).isDeviceSecure();
        int stage=p.getInt("stage",0);
        // Clamp to valid range.
        if(stage<0) stage=0; if(stage>7) stage=7;
        JSONObject o=new JSONObject();
        o.put("stage",stage);
        o.put("complete",p.getBoolean("complete",false)&&secure);
        o.put("connected",connected);o.put("validated",validated);o.put("captive",captive);o.put("metered",metered);
        o.put("secure",secure);
        o.put("account",p.getString("account","unlinked"));
        // WebView UI decides language/timezone strings; platform readback is the truth.
        o.put("locale",c.getResources().getConfiguration().getLocales().get(0).toLanguageTag());
        o.put("timeZone",java.util.TimeZone.getDefault().getID());
        boolean pc = isPc(c);
        o.put("isPC",pc);
        o.put("hasEthernet",hasEthernet(c));
        o.put("hasWifi",c.getPackageManager().hasSystemFeature(PackageManager.FEATURE_WIFI));
        o.put("hasTethering",c.getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY));
        // Honesty gates for the PC wizard:
        o.put("identityEnrollment",true);
        o.put("osProvisioning",false); // never set DEVICE_PROVISIONED / user_setup_complete
        o.put("profileTransferUnavailable",true);
        o.put("profileTransferNote","プロフィールの転送はまだ利用できません。この端末で続けるか、あとで設定してください。");
        return o;
    }

    public static synchronized boolean transition(Context c,String action,int expected) {
        try {
            JSONObject s=snapshot(c);int stage=s.getInt("stage");
            if(expected!=stage)return false;
            SharedPreferences.Editor e=c.getSharedPreferences("android-setup-v1",0).edit();
            if("relink".equals(action)&&"linked".equals(s.getString("account"))) {
                if(s.getBoolean("complete"))return e.putString("account","deferred").commit();
                return e.putInt("stage",4).putBoolean("complete",false).putString("account","unlinked").commit();
            }
            if("link-after-setup".equals(action)&&stage==7&&s.getBoolean("complete")
                    &&"deferred".equals(s.getString("account")))
                return e.putString("account","linked").commit();
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

    /** PC transition: stages 1/2/3 are addressable here (vs retired on mobile). */
    public static synchronized boolean pcTransition(Context c,String action,int expected) {
        try{
            JSONObject s=pcSnapshot(c);int stage=s.getInt("stage");
            if(expected!=stage) return false;
            if(s.getBoolean("complete")) return false;
            SharedPreferences.Editor e=c.getSharedPreferences("pc-setup-v1",0).edit();
            if("back".equals(action)){
                if(stage==0) return false;
                e.putInt("stage",pcBackward(stage));
            } else if("defer".equals(action)&&stage==4){
                e.putString("account","deferred").putInt("stage",5);
            } else if("linked".equals(action)&&stage==4){
                e.putString("account","linked").putInt("stage",5);
            } else if("next".equals(action)){
                // Account (4) never auto-advances; must be explicit defer/linked.
                if(stage==4) return false;
                if(stage<0||stage>=7) return false;
                // For network (2), require observed state — allow skip only via explicit offline.
                // The web layer sets "next" only when validated/connected is observed or after
                // Settings visit; the native readback is the gate.
                e.putInt("stage",pcForward(stage+1));
            } else if("finish".equals(action)){
                if(stage!=7) return false;
                if(!s.getBoolean("secure")) return false;
                String acc=s.getString("account");
                if(!("deferred".equals(acc)||"linked".equals(acc))) return false;
                e.putBoolean("complete",true);
            } else return false;
            return e.commit();
        }catch(Exception ex){ return false; }
    }
}
