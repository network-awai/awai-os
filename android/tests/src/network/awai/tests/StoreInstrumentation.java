package network.awai.tests;
import android.app.Instrumentation;
import android.os.Bundle;
import android.content.Context;
import network.awai.platform.Catalog;
import network.awai.platform.Integrity;
import java.util.Arrays;
import java.security.KeyPairGenerator;
import java.nio.charset.StandardCharsets;

public final class StoreInstrumentation extends Instrumentation {
    private int assertions;
    private void check(boolean value,String name){assertions++;if(!value)throw new AssertionError(name);}
    private interface Action{void run() throws Exception;}
    private void refuses(Action action,String name)throws Exception{boolean failed=false;try{action.run();}catch(Exception expected){failed=true;}check(failed,name);}
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){Bundle result=new Bundle();try{
        Context c=getTargetContext();byte[] raw=Integrity.read(c.getAssets().open("catalog.json"),131072),sig=Integrity.read(c.getAssets().open("catalog.sig"),4096),key=Integrity.read(c.getAssets().open("catalog-key.der"),4096);
        check(Integrity.authentic(raw,sig,key),"metadata signature");
        Catalog catalog=new Catalog(c);check(catalog.app("network.itonami.yotei").getLong("versionCode")>0,"version");
        byte[] apk=catalog.verifiedApk(c,"network.itonami.yotei");check(apk.length>0,"APK bytes and package/signer/version");
        check(catalog.app("network.itonami.app").getLong("versionCode")==1000,"itonami version");
        byte[] second=catalog.verifiedApk(c,"network.itonami.app");check(second.length>20*1024*1024,"itonami APK bytes and package/signer/version");
        if(catalog.json().contains("\"network.itonami.torihiki.bot\"")){byte[] bot=catalog.verifiedApk(c,"network.itonami.torihiki.bot");check(bot.length>20*1024*1024,"torihiki bot APK bytes and package/signer/version");}
        if(catalog.json().contains("\"network.itonami.tabimikake\"")){byte[] tabi=catalog.verifiedApk(c,"network.itonami.tabimikake");check(tabi.length>20*1024*1024,"tabi mikake APK bytes and package/signer/version");}
        refuses(()->catalog.verifiedApk(c,"network.awai.notallowed"),"unknown APK refuses");
        byte[] changed=raw.clone();changed[0]^=1;check(!Integrity.authentic(changed,sig,key),"changed metadata refuses");
        refuses(()->catalog.app("network.awai.notallowed"),"unknown app refuses");
        long expires=catalog.app("network.itonami.yotei").getLong("versionCode");
        refuses(()->Catalog.verifyMetadata(raw,sig,key,Long.MAX_VALUE),"expired metadata refuses");
        byte[] wrong=KeyPairGenerator.getInstance("RSA").generateKeyPair().getPublic().getEncoded();
        boolean bad=false;try{bad=!Integrity.authentic(raw,sig,wrong);}catch(Exception expected){bad=true;}check(bad,"wrong key refuses");
        byte[] altered=apk.clone();altered[altered.length-1]^=1;check(!Integrity.sha256(apk).equals(Integrity.sha256(altered)),"changed APK digest");
        check(Integrity.sha256("abc".getBytes(StandardCharsets.UTF_8)).equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),"SHA256 known answer");
        refuses(()->Integrity.read(new java.io.ByteArrayInputStream(new byte[10]),5),"size bound");
        result.putString("stream","Awai Android store integrity: "+assertions+" assertions passed\n");finish(-1,result);
    }catch(Throwable e){result.putString("stream","FAIL: "+e.getClass().getSimpleName()+" "+e.getMessage());finish(0,result);}}
}
