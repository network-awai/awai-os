package network.awai.tests;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import org.json.JSONObject;

/** Run ONLY on the task's disposable emulator. It resets this test installation's setup progress. */
public final class SetupInstrumentation extends Instrumentation {
    private int assertions;
    private void check(boolean ok,String label){assertions++;if(!ok)throw new AssertionError(label);}
    private boolean move(Context c,String action,int stage)throws Exception{
        return (Boolean)Class.forName("network.awai.home.SetupPlatform").getMethod("transition",Context.class,String.class,int.class).invoke(null,c,action,stage);
    }
    @Override public void onCreate(Bundle args){super.onCreate(args);if(!"disposable-emulator".equals(args.getString("scope")))throw new SecurityException("explicit disposable scope required");start();}
    @Override public void onStart(){Bundle result=new Bundle();Context c=getTargetContext();try{
        check(android.os.Build.HARDWARE.contains("ranchu"),"emulator only");
        c.getSharedPreferences("android-setup-v1",0).edit().clear().commit();
        check(!move(c,"finish",0),"no premature completion");
        check(!move(c,"next",4),"stale step refuses");
        check(!move(c,"enroll",0),"unknown operation refuses");
        check(move(c,"next",0)&&move(c,"next",1),"welcome-language progression");
        check(move(c,"offline",2),"explicit offline choice");
        check(move(c,"back",3),"back from date");
        check(move(c,"next",2)&&move(c,"next",3),"offline selection retained");
        check(!move(c,"next",4),"no fabricated account");
        check(move(c,"defer",4)&&move(c,"next",5),"explicit defer then privacy");
        JSONObject s=(JSONObject)Class.forName("network.awai.home.SetupPlatform").getMethod("snapshot",Context.class).invoke(null,c);
        if(!s.getBoolean("secure"))check(!move(c,"next",6),"no fake PIN acceptance");
        check(!move(c,"finish",6),"no skip to Home");
        check(!s.getBoolean("identityEnrollment")&&!s.getBoolean("osProvisioning"),"capability limits truthful");
        result.putString("stream","Android setup boundary: "+assertions+" assertions passed\n");finish(-1,result);
    }catch(Throwable e){result.putString("stream","FAIL "+e.toString());finish(0,result);}
    finally{c.getSharedPreferences("android-setup-v1",0).edit().clear().commit();}}
}
