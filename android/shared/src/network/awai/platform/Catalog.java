package network.awai.platform;

import android.content.Context;
import android.content.pm.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Android host boundary: authenticated bundled metadata and exact APK identity. No network. */
public final class Catalog {
    public static final long MAX_APK_BYTES=256L*1024*1024;
    private static final Map<String,String> ASSETS;
    static {
        Map<String,String> assets=new HashMap<>();
        assets.put("network.itonami.yotei","packages/yotei.apk");
        assets.put("app.aozora.awai.preview","packages/aozora.apk");
        assets.put("network.itonami.dougaka.preview","packages/dougaka.apk");
        assets.put("network.itonami.ongakuka.preview","packages/ongakuka.apk");
        assets.put("network.itonami.client.preview","packages/itonami.apk");
        assets.put("network.itonami.yataverse.preview","packages/yataverse.apk");
        ASSETS=Collections.unmodifiableMap(assets);
    }
    private final JSONObject value;
    public final boolean online;
    public Catalog(Context context) throws Exception {
        byte[] bytes = Integrity.read(context.getAssets().open("catalog.json"), 131072);
        byte[] sig = Integrity.read(context.getAssets().open("catalog.sig"), 4096);
        byte[] key = Integrity.read(context.getAssets().open("catalog-key.der"), 4096);
        JSONObject bundled=verifyMetadata(bytes,sig,key,System.currentTimeMillis()/1000);
        android.content.SharedPreferences saved=context.getSharedPreferences("online",0);
        online=saved.contains("raw");
        if(online){
            bytes=saved.getString("raw","").getBytes(StandardCharsets.UTF_8);
            sig=android.util.Base64.decode(saved.getString("signature",""),android.util.Base64.DEFAULT);
        }
        value = verifyMetadata(bytes,sig,key,System.currentTimeMillis()/1000);
        if(value.getLong("revision")<Math.max(bundled.getLong("revision"),saved.getLong("highest",0)))throw new SecurityException("catalog-rollback");
    }
    public static JSONObject verifyMetadata(byte[] bytes,byte[] sig,byte[] key,long now) throws Exception {
        if (!Integrity.authentic(bytes, sig, key)) throw new SecurityException("catalog-signature");
        JSONObject value = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!"itonami.store.bundled.v1".equals(value.getString("schema")) || value.getLong("revision") < 1
                || value.getLong("expiresAt") <= now) throw new SecurityException("catalog-expired");
        JSONArray apps = value.getJSONArray("apps");
        if (apps.length()<1 || apps.length()>ASSETS.size())throw new SecurityException("catalog-app-count");
        Set<String> seen=new HashSet<>();
        for(int i=0;i<apps.length();i++) {
            JSONObject app=apps.getJSONObject(i);String id=app.getString("id");
            if(!ASSETS.containsKey(id)||!seen.add(id))throw new SecurityException("catalog-app");
            if(app.getLong("versionCode")<1||app.getDouble("versionCode")!=app.getLong("versionCode"))throw new SecurityException("catalog-version");
            JSONArray artifacts=app.getJSONArray("artifacts");int android=0;
            for(int j=0;j<artifacts.length();j++) {
                JSONObject a=artifacts.getJSONObject(j);
                if(!"android".equals(a.getString("platform")))continue;
                if(++android!=1||!"android".equals(a.getString("runtime"))||!"apk".equals(a.getString("kind"))||!ASSETS.get(id).equals(a.getString("asset")))throw new SecurityException("catalog-artifact");
                long artifactBytes=a.getLong("bytes");
                if(artifactBytes<1||artifactBytes>MAX_APK_BYTES||a.getDouble("bytes")!=artifactBytes||!a.getString("sha256").matches("[0-9a-f]{64}")||!a.getString("signerSha256").matches("[0-9a-f]{64}"))throw new SecurityException("catalog-artifact-identity");
            }
            if(android!=1)throw new SecurityException("no-android-artifact");
        }
        return value;
    }
    public long valueRevision() throws Exception { return value.getLong("revision"); }
    public String json() { return value.toString(); }
    public JSONObject app(String id) throws Exception {
        JSONArray apps=value.getJSONArray("apps");
        for(int i=0;i<apps.length();i++){JSONObject app=apps.getJSONObject(i);if(app.getString("id").equals(id))return app;}
        throw new SecurityException("unknown-app");
    }
    public JSONObject artifact(String id) throws Exception {
        JSONArray entries = app(id).getJSONArray("artifacts");
        for (int i = 0; i < entries.length(); i++) {
            JSONObject a = entries.getJSONObject(i);
            if ("android".equals(a.getString("platform")) && "android".equals(a.getString("runtime"))
                    && "apk".equals(a.getString("kind")) && ASSETS.get(id).equals(a.getString("asset"))) return a;
        }
        throw new SecurityException("no-android-artifact");
    }
    /** Caller owns the verified temporary file and must delete it after use. */
    public File verifiedApkFile(Context context, String id) throws Exception {
        JSONObject app=app(id),a=artifact(id);long expected=a.getLong("bytes");
        if(expected<1||expected>MAX_APK_BYTES)throw new SecurityException("artifact-size");
        if(online&&!"network.itonami.yotei".equals(id))throw new SecurityException("online-app-not-supported");
        File file=File.createTempFile("awai-verify-",".apk",context.getCacheDir());boolean verified=false;
        try {
            MessageDigest hash=MessageDigest.getInstance("SHA-256");long count=0;
            try(InputStream input=online?new FileInputStream(new File(context.getFilesDir(),"online-yotei.apk")):context.getAssets().open(a.getString("asset"));FileOutputStream output=new FileOutputStream(file)){
                byte[] buffer=new byte[65536];int n;
                while((n=input.read(buffer))!=-1){count+=n;if(count>expected)throw new SecurityException("artifact-size");hash.update(buffer,0,n);output.write(buffer,0,n);}
                output.getFD().sync();
            }
            StringBuilder hex=new StringBuilder();for(byte b:hash.digest())hex.append(String.format(Locale.ROOT,"%02x",b&255));
            if(count!=expected||!hex.toString().equals(a.getString("sha256")))throw new SecurityException("artifact-integrity");
            PackageInfo info = context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
            if (info == null || !id.equals(info.packageName) || info.getLongVersionCode() != app.getLong("versionCode"))
                throw new SecurityException("package-version");
            if (info.signingInfo == null || info.signingInfo.hasMultipleSigners()) throw new SecurityException("signer-count");
            android.content.pm.Signature[] signers = info.signingInfo.getApkContentsSigners();
            if (signers.length != 1 || !Integrity.sha256(signers[0].toByteArray()).equals(a.getString("signerSha256")))
                throw new SecurityException("package-signer");
            try {
                PackageInfo installed = context.getPackageManager().getPackageInfo(id, PackageManager.GET_SIGNING_CERTIFICATES);
                if (installed.getLongVersionCode() > app.getLong("versionCode")) throw new SecurityException("downgrade");
                if (installed.signingInfo == null || installed.signingInfo.hasMultipleSigners()
                        || !Integrity.sha256(installed.signingInfo.getApkContentsSigners()[0].toByteArray()).equals(a.getString("signerSha256")))
                    throw new SecurityException("installed-signer");
            } catch (PackageManager.NameNotFoundException absent) { /* fresh install */ }
            verified=true;return file;
        } finally { if(!verified&&!file.delete())file.deleteOnExit(); }
    }
    /** Legacy small-fixture accessor; installation uses the streaming file API. */
    public byte[] verifiedApk(Context context,String id)throws Exception {
        File file=verifiedApkFile(context,id);
        try{return Integrity.read(new FileInputStream(file),20*1024*1024);}finally{if(!file.delete())file.deleteOnExit();}
    }
}
