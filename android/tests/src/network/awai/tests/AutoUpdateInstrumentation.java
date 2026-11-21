package network.awai.tests;
import android.app.Instrumentation;
import android.os.Bundle;
import network.awai.platform.AutoInstall;

/** AWAI-3663: runs one automatic-update attempt in the Store's process and reports the result.
 *  Usage: am instrument -w -e package <id> network.awai.tests/.AutoUpdateInstrumentation */
public final class AutoUpdateInstrumentation extends Instrumentation {
    private String id;
    @Override public void onCreate(Bundle args){super.onCreate(args);id=args.getString("package","network.itonami.yotei");start();}
    @Override public void onStart(){Bundle r=new Bundle();
        try{AutoInstall.Result result=AutoInstall.attempt(getTargetContext(),id);
            r.putString("stream","auto-update "+id+": "+(result.refusals.isEmpty()?"committed session "+result.sessionId:"refused "+result.refusals)+"\n");finish(-1,r);}
        catch(Throwable e){r.putString("stream","FAIL: "+e+"\n");finish(0,r);}}
}
