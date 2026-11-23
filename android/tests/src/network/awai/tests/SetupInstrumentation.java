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
    private boolean pcMove(Context c,String action,int stage)throws Exception{
        return (Boolean)Class.forName("network.awai.home.SetupPlatform").getMethod("pcTransition",Context.class,String.class,int.class).invoke(null,c,action,stage);
    }
    @Override public void onCreate(Bundle args){super.onCreate(args);if(!"disposable-emulator".equals(args.getString("scope")))throw new SecurityException("explicit disposable scope required");start();}
    @Override public void onStart(){Bundle result=new Bundle();Context c=getTargetContext();int resultCode=-1;try{
        check(android.os.Build.HARDWARE.contains("ranchu"),"emulator only");
        c.getSharedPreferences("android-setup-v1",0).edit().clear().commit();
        check(!move(c,"finish",0),"no premature completion");
        check(!move(c,"next",4),"stale step refuses");
        check(!move(c,"enroll",0),"unknown operation refuses");
        check(move(c,"next",0),"welcome goes straight to account");
        check(!move(c,"next",1)&&!move(c,"next",3)&&!move(c,"offline",4),"no language, network or date/time step");
        check(move(c,"back",4)&&move(c,"next",0),"back from account returns to welcome");
        c.getSharedPreferences("android-setup-v1",0).edit().putInt("stage",2).commit();
        check(!move(c,"next",2),"saved retired stage is not addressable");
        check(!move(c,"next",4),"no fabricated account");
        check(move(c,"defer",4)&&move(c,"next",5),"explicit defer then privacy");
        JSONObject s=(JSONObject)Class.forName("network.awai.home.SetupPlatform").getMethod("snapshot",Context.class).invoke(null,c);
        check(!move(c,"next",6),"no lock step");
        if(!s.getBoolean("secure"))check(!move(c,"finish",7),"no completion without an Android screen lock");
        check(s.getBoolean("identityEnrollment")&&!s.getBoolean("osProvisioning"),"link client is not privileged provisioning");
        // AWAI-4072: PC wizard — language/network/datetime visible, isPC + honesty gates.
        c.getSharedPreferences("pc-setup-v1",0).edit().clear().commit();
        JSONObject pc=(JSONObject)Class.forName("network.awai.home.SetupPlatform").getMethod("pcSnapshot",Context.class).invoke(null,c);
        check(pc.has("isPC"),"pc snapshot exposes isPC");
        check(pc.optBoolean("profileTransferUnavailable",false),"profile transfer honestly unavailable");
        check(!pc.optBoolean("osProvisioning",true),"PC still not os provisioning");
        check(pcMove(c,"next",0),"pc welcome next");
        check(pcMove(c,"next",1)&&pcMove(c,"next",2),"pc language and network are addressable");
        check(pcMove(c,"back",3)&&pcMove(c,"next",2),"pc back from datetime returns to network");
        check(pcMove(c,"next",3),"pc datetime next");
        check(!pcMove(c,"next",4),"pc account requires defer/linked");
        check(pcMove(c,"defer",4)&&pcMove(c,"next",5),"pc explicit defer");
        result.putString("stream","Android setup boundary: "+assertions+" assertions passed\n");
    }catch(Throwable e){result.putString("stream","FAIL "+e.toString());resultCode=0;}
    finally{c.getSharedPreferences("android-setup-v1",0).edit().clear().commit();c.getSharedPreferences("pc-setup-v1",0).edit().clear().commit();}
    finish(resultCode,result);}}
