package network.awai.tests;
import android.app.Instrumentation;
import android.os.Bundle;
import android.content.Context;
import network.awai.platform.Catalog;
import network.awai.platform.Integrity;
import network.awai.platform.LatestPointer;
import network.awai.platform.StorageProfile;
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
    // AWAI-3662: the signed latest-catalog pointer.
    private static final String REV="ed429b406cbecc048f3cb41a9f31a1fb4a4a636d";
    private static final String BASE="https://raw.githubusercontent.com/network-awai/awai-os/"+REV+"/store/distribution/";
    private static JSONObject pin(String url,String sha,long max)throws Exception{return new JSONObject().put("url",url).put("sha256",sha).put("maxBytes",max);}
    private static JSONObject pointer(long seq,long issued,long expires)throws Exception{
        String sha=Integrity.sha256(new byte[]{1});
        return new JSONObject().put("schema",LatestPointer.SCHEMA).put("sequence",seq).put("issuedAt",issued).put("expiresAt",expires)
            .put("pins",new JSONObject().put("revision",REV).put("catalog",pin(BASE+"dev-r/catalog-envelope.json",sha,100))
                .put("apks",new JSONObject().put("network.itonami.torihiki",pin(BASE+"dev-r/torihiki.apk",sha,1))));
    }
    private static byte[] sign(byte[] raw,KeyPair pair)throws Exception{java.security.Signature s=java.security.Signature.getInstance("SHA256withRSA");s.initSign(pair.getPrivate());s.update(raw);return s.sign();}
    private LatestPointer accept(JSONObject v,KeyPair pair,long now,long floor)throws Exception{byte[] raw=v.toString().getBytes(StandardCharsets.UTF_8);return LatestPointer.verify(raw,sign(raw,pair),pair.getPublic().getEncoded(),now,floor);}
    private void refusesPointer(JSONObject v,KeyPair pair,long now,long floor,String name)throws Exception{refuses(()->accept(v,pair,now,floor),name);}
    private void latestPointer()throws Exception{
        KeyPair pair=KeyPairGenerator.getInstance("RSA").generateKeyPair();long now=1_800_000_000L,day=86_400L;
        LatestPointer ok=accept(pointer(5,now-day,now+30*day),pair,now,5);
        check(ok.sequence==5&&ok.apks.containsKey("network.itonami.torihiki")&&ok.catalog.maxBytes==100,"pointer accepted");
        ok.checkCatalog(new byte[]{1});refuses(()->ok.checkCatalog(new byte[]{2}),"pointer catalog digest");
        ok.checkApk("network.itonami.torihiki",new byte[]{1});refuses(()->ok.checkApk("network.itonami.yotei",new byte[]{1}),"pointer unlisted app");
        byte[] raw=pointer(5,now-day,now+30*day).toString().getBytes(StandardCharsets.UTF_8);
        byte[] env=new JSONObject().put("raw",new String(raw,StandardCharsets.UTF_8)).put("signature",android.util.Base64.encodeToString(sign(raw,pair),android.util.Base64.NO_WRAP)).toString().getBytes(StandardCharsets.UTF_8);
        check(LatestPointer.verifyEnvelope(env,pair.getPublic().getEncoded(),now,1).sequence==5,"pointer envelope accepted");
        refuses(()->LatestPointer.verify(raw,sign(raw,pair),KeyPairGenerator.getInstance("RSA").generateKeyPair().getPublic().getEncoded(),now,1),"pointer wrong key");
        byte[] changed=raw.clone();changed[raw.length-2]^=1;refuses(()->LatestPointer.verify(changed,sign(raw,pair),pair.getPublic().getEncoded(),now,1),"pointer changed bytes");
        refusesPointer(pointer(4,now-day,now+30*day),pair,now,5,"pointer sequence rollback");
        refusesPointer(pointer(5,now-31*day,now),pair,now,1,"pointer expired");
        refusesPointer(pointer(5,now-day,now-day+32*day),pair,now,1,"pointer lifetime over 31 days");
        refusesPointer(pointer(5,now+3600,now+10*day),pair,now,1,"pointer issued in the future");
        refusesPointer(pointer(5,now-day,now+10*day).put("schema","itonami.store.latest.v2"),pair,now,1,"pointer schema");
        refusesPointer(pointer(5,now-day,now+10*day).put("sequence",5.5),pair,now,1,"pointer non-integer sequence");
        String sha=Integrity.sha256(new byte[]{1});
        for(String url:new String[]{"https://example.com/network-awai/awai-os/"+REV+"/store/distribution/x.apk",
                "https://raw.githubusercontent.com/network-awai/awai-os/main/store/distribution/x.apk",
                BASE+"x.apk?y=1",BASE+"x.apk#f",BASE+"../../../x.apk",BASE+"%2e%2e/x.apk","http://raw.githubusercontent.com/network-awai/awai-os/"+REV+"/store/distribution/x.apk",
                "https://raw.githubusercontent.com:8443/network-awai/awai-os/"+REV+"/store/distribution/x.apk"}){
            JSONObject v=pointer(5,now-day,now+10*day);v.getJSONObject("pins").getJSONObject("apks").put("network.itonami.torihiki",pin(url,sha,1));
            refusesPointer(v,pair,now,1,"pointer url "+url);
        }
        JSONObject unknown=pointer(5,now-day,now+10*day);unknown.getJSONObject("pins").getJSONObject("apks").put("network.itonami.notlisted",pin(BASE+"x.apk",sha,1));
        refusesPointer(unknown,pair,now,1,"pointer unknown app");
        JSONObject over=pointer(5,now-day,now+10*day);over.getJSONObject("pins").getJSONObject("apks").put("network.itonami.torihiki",pin(BASE+"x.apk",sha,Catalog.maxApkBytes("network.itonami.torihiki")+1));
        refusesPointer(over,pair,now,1,"pointer over app budget");
        JSONObject badSha=pointer(5,now-day,now+10*day);badSha.getJSONObject("pins").getJSONObject("catalog").put("sha256","XYZ");
        refusesPointer(badSha,pair,now,1,"pointer bad digest");
        refuses(()->LatestPointer.verifyEnvelope(new byte[LatestPointer.MAX_ENVELOPE_BYTES+1],pair.getPublic().getEncoded(),now,1),"pointer envelope size");
    }
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){Bundle result=new Bundle();try{
        Context c=getTargetContext();byte[] raw=Integrity.read(c.getAssets().open("catalog.json"),131072),sig=Integrity.read(c.getAssets().open("catalog.sig"),4096),key=Integrity.read(c.getAssets().open("catalog-key.der"),4096);
        check(Integrity.authentic(raw,sig,key),"metadata signature");
        Catalog catalog=new Catalog(c);check(catalog.app("network.itonami.yotei").getLong("versionCode")>0,"version");
        byte[] apk=catalog.verifiedApk(c,"network.itonami.yotei");check(apk.length>0,"APK bytes and package/signer/version");
        if(catalog.json().contains("\"network.itonami.app\"")){
        check(catalog.app("network.itonami.app").getLong("versionCode")==1000,"itonami version");
        byte[] second=catalog.verifiedApk(c,"network.itonami.app");check(second.length>20*1024*1024,"itonami APK bytes and package/signer/version");
        }
        if(catalog.json().contains("\"network.itonami.torihiki.bot\"")){byte[] bot=catalog.verifiedApk(c,"network.itonami.torihiki.bot");check(bot.length>20*1024*1024,"torihiki bot APK bytes and package/signer/version");}
        if(catalog.json().contains("\"network.itonami.tabimikake\"")){byte[] tabi=catalog.verifiedApk(c,"network.itonami.tabimikake");check(tabi.length>20*1024*1024,"tabi mikake APK bytes and package/signer/version");}
        if(catalog.json().contains("\"network.itonami.deai\"")){byte[] deai=catalog.verifiedApk(c,"network.itonami.deai");check(deai.length>10*1024*1024,"deai APK bytes and package/signer/version");}
        if(catalog.json().contains("\"network.itonami.hiring\"")){byte[] hiring=catalog.verifiedApk(c,"network.itonami.hiring");check(hiring.length>10*1024*1024,"hiring APK bytes and package/signer/version");}
        if(catalog.json().contains("\"network.itonami.kumade\"")){byte[] kumade=catalog.verifiedApk(c,"network.itonami.kumade");check(kumade.length>10*1024*1024,"kumade APK bytes and package/signer/version");}
        for (String local : Catalog.LOCAL_APPS) {
            String id = "network.itonami." + local;
            check(("packages/" + local + ".apk").equals(Catalog.assetFor(id))
                    && ("online-" + local + ".apk").equals(Catalog.onlineFileFor(id))
                    && Catalog.maxApkBytes(id) == 40 * 1024 * 1024, local + " fixed paths and budget");
            if (catalog.json().contains("\"" + id + "\"")) {
                byte[] localApk = catalog.verifiedApk(c, id);
                check(localApk.length > 0 && localApk.length <= Catalog.maxApkBytes(id),
                        local + " APK bytes and package/signer/version");
            }
        }
        refuses(()->Catalog.assetFor("network.itonami.notlisted"),"unlisted network.itonami id refuses");
        check("packages/aozora.apk".equals(Catalog.assetFor("app.aozora")),"Aozora fixed bundled asset");
        check("online-aozora.apk".equals(Catalog.onlineFileFor("app.aozora")),"Aozora fixed online file");
        check(Catalog.maxApkBytes("app.aozora")==64*1024*1024,"Aozora size limit");
        if (catalog.json().contains("\"app.aozora\"")) {
            check(catalog.verifiedApk(c,"app.aozora").length > 0,"Aozora APK bytes and package/signer/version");
        } else {
            refuses(()->catalog.verifiedApk(c,"app.aozora"),"Aozora unavailable without signed catalog entry");
        }
        refuses(()->catalog.verifiedApk(c,"network.awai.notallowed"),"unknown APK refuses");
        JSONArray apps = new JSONObject(catalog.json()).getJSONArray("apps");
        for(int i=0;i<apps.length();i++){
            String id=apps.getJSONObject(i).getString("id");
            java.io.File verified=catalog.verifiedApkFile(c,id);
            try{check(verified.length()==catalog.artifact(id).getLong("bytes"),"streamed APK exact size/package/signer");}
            finally{verified.delete();}
        }
        KeyPair pair=KeyPairGenerator.getInstance("RSA").generateKeyPair();
        JSONObject duplicate=new JSONObject(catalog.json());
        duplicate.getJSONArray("apps").put(new JSONObject(apps.getJSONObject(0).toString()));
        refuses(()->verifySigned(duplicate,pair),"duplicate package refuses");
        refuses(()->Catalog.onlineFileFor("network.itonami.client.preview"),"preview has no online artifact path");
        for(String name:new String[]{"shakai","kaisha","kaikei"}) {
            String id="network.itonami."+name;
            check(Catalog.assetFor(id).equals("packages/"+name+".apk"),name+" asset mapping");
            check(Catalog.onlineFileFor(id).equals("online-"+name+".apk"),name+" online mapping");
            check(Catalog.maxApkBytes(id)==64*1024*1024,name+" size bound");
        }
        byte[] changed=raw.clone();changed[0]^=1;check(!Integrity.authentic(changed,sig,key),"changed metadata refuses");
        refuses(()->catalog.app("network.awai.notallowed"),"unknown app refuses");
        long expires=catalog.app("network.itonami.yotei").getLong("versionCode");
        refuses(()->Catalog.verifyMetadata(raw,sig,key,Long.MAX_VALUE),"expired metadata refuses");
        byte[] wrong=KeyPairGenerator.getInstance("RSA").generateKeyPair().getPublic().getEncoded();
        boolean bad=false;try{bad=!Integrity.authentic(raw,sig,wrong);}catch(Exception expected){bad=true;}check(bad,"wrong key refuses");
        byte[] altered=apk.clone();altered[altered.length-1]^=1;check(!Integrity.sha256(apk).equals(Integrity.sha256(altered)),"changed APK digest");
        check(Integrity.sha256("abc".getBytes(StandardCharsets.UTF_8)).equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),"SHA256 known answer");
        refuses(()->Integrity.read(new java.io.ByteArrayInputStream(new byte[10]),5),"size bound");
        check("temporary".equals(StorageProfile.kind("/data/user/0/app/files","/dev/root / erofs ro 0 0\ntmpfs /data tmpfs rw 0 0\n")),"RAM session classification");
        check("app-private".equals(StorageProfile.kind("/data/user/0/app/files","/dev/data /data ext4 rw 0 0\ntmpfs /data-other tmpfs rw 0 0\n")),"mount prefix boundary");
        check("app-private".equals(StorageProfile.kind("/data/user/0/app/files","tmpfs /data tmpfs rw 0 0\n/dev/block /data/user/0/app ext4 rw 0 0\n")),"longest nested mount wins");
        check("unknown".equals(StorageProfile.kind("/data/user/0/app/files","invalid")),"unknown storage is not durability");
        latestPointer();
        result.putString("stream","Awai Android store integrity: "+assertions+" assertions passed\n");finish(-1,result);
    }catch(Throwable e){result.putString("stream","FAIL: "+e.getClass().getSimpleName()+" "+e.getMessage());finish(0,result);}}
}
