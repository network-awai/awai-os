package network.awai.tests;
import android.app.Instrumentation;
import android.os.Bundle;
import android.content.Context;
import network.awai.platform.Catalog;
import network.awai.platform.Integrity;
import java.util.Arrays;
import java.security.KeyPairGenerator;
import java.security.KeyPair;
import org.json.*;
import java.nio.charset.StandardCharsets;

public final class StoreInstrumentation extends Instrumentation {
    private int assertions;
    private void check(boolean value,String name){assertions++;if(!value)throw new AssertionError(name);}
    private interface Action{void run() throws Exception;}
    private void refuses(Action action,String name)throws Exception{boolean failed=false;try{action.run();}catch(Exception expected){failed=true;}check(failed,name);}
    private static void verifySigned(JSONObject value,KeyPair pair)throws Exception{
        byte[] raw=value.toString().getBytes(StandardCharsets.UTF_8);java.security.Signature signer=java.security.Signature.getInstance("SHA256withRSA");signer.initSign(pair.getPrivate());signer.update(raw);Catalog.verifyMetadata(raw,signer.sign(),pair.getPublic().getEncoded(),System.currentTimeMillis()/1000);
    }
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){Bundle result=new Bundle();try{
        Context c=getTargetContext();byte[] raw=Integrity.read(c.getAssets().open("catalog.json"),131072),sig=Integrity.read(c.getAssets().open("catalog.sig"),4096),key=Integrity.read(c.getAssets().open("catalog-key.der"),4096);
        check(Integrity.authentic(raw,sig,key),"metadata signature");
        Catalog catalog=new Catalog(c);check(catalog.app("network.itonami.yotei").getLong("versionCode")>0,"version");
        byte[] apk=catalog.verifiedApk(c,"network.itonami.yotei");check(apk.length>0,"APK bytes and package/signer/version");
        JSONArray apps=new JSONObject(catalog.json()).getJSONArray("apps");
        for(int i=0;i<apps.length();i++){java.io.File verified=catalog.verifiedApkFile(c,apps.getJSONObject(i).getString("id"));try{check(verified.length()==catalog.artifact(apps.getJSONObject(i).getString("id")).getLong("bytes"),"streamed APK exact size/package/signer");}finally{verified.delete();}}
        KeyPair pair=KeyPairGenerator.getInstance("RSA").generateKeyPair();
        JSONObject duplicate=new JSONObject(catalog.json());duplicate.getJSONArray("apps").put(new JSONObject(apps.getJSONObject(0).toString()));refuses(()->verifySigned(duplicate,pair),"duplicate package refuses");
        JSONObject path=new JSONObject(catalog.json());path.getJSONArray("apps").getJSONObject(0).getJSONArray("artifacts").getJSONObject(0).put("asset","packages/elsewhere.apk");refuses(()->verifySigned(path,pair),"package asset mapping refuses");
        JSONObject size=new JSONObject(catalog.json());size.getJSONArray("apps").getJSONObject(0).getJSONArray("artifacts").getJSONObject(0).put("bytes",Catalog.MAX_APK_BYTES+1);refuses(()->verifySigned(size,pair),"APK byte ceiling refuses");
        JSONObject unknown=new JSONObject(catalog.json());unknown.getJSONArray("apps").getJSONObject(0).put("id","network.awai.notallowed");refuses(()->verifySigned(unknown,pair),"unapproved package refuses");
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
