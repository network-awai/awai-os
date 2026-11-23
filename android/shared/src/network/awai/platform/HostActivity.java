package network.awai.platform;

import android.app.*;
import android.app.role.RoleManager;
import network.awai.systembars.SystemBars;
import android.content.*;
import android.content.pm.*;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Narrow native adapter for a bundled, shared browser client. No remote UI or arbitrary commands. */
public abstract class HostActivity extends Activity {
    public static final String ORIGIN = "https://appassets.androidplatform.net";
    /** Torihiki devnet: one fixed host. Reads are exact GET routes (the account id is the only variable value);
     *  the only write is POST /tx with no query (mirrors torihiki.js, AWAI-491). */
    static final String TORIHIKI_HOST = "torihiki-node.04-feasts-minded.workers.dev";
    static boolean torihikiHost(Uri u){
        return "https".equals(u.getScheme())&&TORIHIKI_HOST.equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&u.getUserInfo()==null&&u.getEncodedFragment()==null;
    }
    static boolean torihikiRead(Uri u){
        if(!torihikiHost(u))return false;
        String path=u.getEncodedPath(),query=u.getEncodedQuery();
        return ("/head".equals(path)&&query==null)||("/market".equals(path)&&"id=1".equals(query))||("/book".equals(path)&&"market=1&depth=15".equals(query))
            ||("/account".equals(path)&&query!=null&&query.matches("id=[1-9][0-9]{5,13}"))
            ||("/trades".equals(path)&&"market=1".equals(query))
            ||("/candles".equals(path)&&("market=1&span=1".equals(query)||"market=1&span=10".equals(query)||"market=1&span=50".equals(query)));
    }
    static boolean torihikiTx(Uri u){ return torihikiHost(u)&&"/tx".equals(u.getEncodedPath())&&u.getEncodedQuery()==null; }
    protected WebView web;
    private Set<String> assets;
    private final Set<String> onlineUrls=new HashSet<>();
    private JSONArray cachedApps;
    private boolean ready;
    private boolean installing;
    protected abstract String mode();
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setDecorFitsSystemWindows(false);
        // The bars are drawn over the decor view (edge-to-edge), following the
        // device theme through the shared library (AWAI-3443). awai_background
        // is the palette background, the same color as the lib's canonical
        // light/dark backgrounds, so the lib's default matches the frame.
        SystemBars.applyForUiMode(this, getResources().getConfiguration());
        FrameLayout frame = new FrameLayout(this); frame.setBackgroundColor(getColor(getResources().getIdentifier("awai_background","color",getPackageName())));
        web = new WebView(this); web.setBackgroundColor(Color.TRANSPARENT);
        if((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)WebView.setWebContentsDebuggingEnabled(true);
        frame.addView(web, new FrameLayout.LayoutParams(-1,-1));
        frame.setOnApplyWindowInsetsListener((view, insets)->{
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            view.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,ime.bottom)); return insets;
        });
        setContentView(frame);
        try { assets = new HashSet<>(Arrays.asList(new String(Integrity.read(getAssets().open("assets.list"),65536),StandardCharsets.UTF_8).split("\n"))); }
        catch (Exception e) { fail("画面のファイルを確認できません。"); return; }
        if("store".equals(mode()))try{
            JSONObject pins=new JSONObject(new String(Integrity.read(getAssets().open("online-pins.json"),16384),StandardCharsets.UTF_8));
            String rev=pins.getString("revision");if(!rev.matches("[0-9a-f]{40}"))throw new SecurityException();
            // One catalog pin plus one APK pin per admitted app id; an unknown id refuses every online URL.
            JSONObject apks=pins.getJSONObject("apks");if(apks.length()<1||apks.length()>16)throw new SecurityException();
            java.util.List<String> urls=new java.util.ArrayList<>();urls.add(pins.getJSONObject("catalog").getString("url"));
            for(java.util.Iterator<String> ids=apks.keys();ids.hasNext();){String id=ids.next();Catalog.assetFor(id);urls.add(apks.getJSONObject(id).getString("url"));}
            for(String url:urls){
                Uri parsed=Uri.parse(url);
                if(!url.startsWith("https://raw.githubusercontent.com/network-awai/awai-os/"+rev+"/store/distribution/")||parsed.getEncodedQuery()!=null||parsed.getEncodedFragment()!=null)throw new SecurityException();
                onlineUrls.add(url);
            }
        }catch(Exception absent){onlineUrls.clear();}
        WebSettings s = web.getSettings(); s.setBlockNetworkLoads(onlineUrls.isEmpty()&&!"home".equals(mode())&&!"torihiki".equals(mode())); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false); s.setBuiltInZoomControls(true); s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true); s.setLoadWithOverviewMode(true);
        PackageInfo webview = WebView.getCurrentWebViewPackage();
        try { if (webview != null && Integer.parseInt(webview.versionName.split("\\.")[0]) < 146)
            s.setTextZoom(Math.round(getResources().getConfiguration().fontScale*100)); }
        catch (Exception ignored) { s.setTextZoom(Math.round(getResources().getConfiguration().fontScale*100)); }
        web.addJavascriptInterface(new Bridge(), "AwaiHost");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl(); String path=u.getEncodedPath();
                if("GET".equals(req.getMethod()) && onlineUrls.contains(u.toString()))return null;
                if("torihiki".equals(mode())&&(("GET".equals(req.getMethod())&&torihikiRead(u))||("POST".equals(req.getMethod())&&torihikiTx(u))))return null;
                if("home".equals(mode())&&"GET".equals(req.getMethod())&&"https".equals(u.getScheme())
                    &&"relay.awai.network".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)
                    &&u.getUserInfo()==null&&u.getEncodedQuery()==null&&u.getEncodedFragment()==null
                    &&path!=null&&path.matches("/[0-9a-f]{32}/json"))return null;
                if (!"GET".equals(req.getMethod()) || !"https".equals(u.getScheme()) || !"appassets.androidplatform.net".equals(u.getHost())
                        || u.getPort()!=-1 || u.getEncodedQuery()!=null || u.getEncodedFragment()!=null || path==null || !path.startsWith("/awai/")) return denied();
                String file = path.substring(6);
                if (!assets.contains(file)) return denied();
                try {
                    String mime=file.endsWith(".html")?"text/html":file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":file.endsWith(".woff2")?"font/woff2":"image/png";
                    return new WebResourceResponse(mime,"UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),getAssets().open(file));
                } catch (IOException e) { return denied(); }
            }
            @Override public void onPageFinished(WebView view,String url) { ready=true; }
        });
        if("store".equals(mode()))AutoUpdater.sync(this);
        web.loadUrl(ORIGIN+"/awai/index.html");
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0,()->web.evaluateJavascript("window.awaiBack ? window.awaiBack() : false",result->{ if (!"true".equals(result) && !"home".equals(mode())) finish(); }));
    }
    private static WebResourceResponse denied() { return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0])); }
    private void fail(String message) { new AlertDialog.Builder(this).setTitle("Awai").setMessage(message).setPositiveButton("閉じる",(d,w)->finish()).show(); }
    @Override protected void onPause() { if(web!=null)web.evaluateJavascript("window.awaiVisibility && window.awaiVisibility(true)",null); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if(web!=null)web.evaluateJavascript("window.awaiVisibility && window.awaiVisibility(false)",null); cachedApps=null; if (ready) web.evaluateJavascript("window.awaiRefresh && window.awaiRefresh()",null); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent);setIntent(intent);if(ready&&"home".equals(mode()))web.evaluateJavascript("window.awaiGoHome && window.awaiGoHome()",null); }
    @Override public void onTrimMemory(int level) { super.onTrimMemory(level); if(level>=TRIM_MEMORY_UI_HIDDEN)cachedApps=null; }
    @Override protected void onDestroy() { if(web!=null){web.removeJavascriptInterface("AwaiHost");web.destroy();}super.onDestroy(); }
    private String storageKind(){
        try{return StorageProfile.kind(getFilesDir().getCanonicalPath(),new String(Integrity.read(new FileInputStream("/proc/self/mounts"),1048576),StandardCharsets.UTF_8));}catch(Exception unavailable){return "unknown";}
    }
    private Catalog trustedCatalog() throws Exception { return new Catalog(this); }
    private void message(String msg) { getSharedPreferences("host",0).edit().putString("message",msg).apply();runOnUiThread(()->{if(ready)web.evaluateJavascript("window.awaiRefresh && window.awaiRefresh()",null);}); }
    private JSONArray launchable() throws Exception {
        if(cachedApps!=null)return cachedApps;
        Intent query=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> found=getPackageManager().queryIntentActivities(query,0);
        found.sort((a,b)->a.loadLabel(getPackageManager()).toString().compareToIgnoreCase(b.loadLabel(getPackageManager()).toString()));
        JSONArray out=new JSONArray();Set<String> seen=new HashSet<>();
        for(ResolveInfo r:found){String id=r.activityInfo.packageName;if(!seen.add(id))continue;
            JSONObject item=new JSONObject();item.put("id",id);item.put("label",r.loadLabel(getPackageManager()).toString());
            Drawable drawable=r.loadIcon(getPackageManager());Bitmap image=Bitmap.createBitmap(64,64,Bitmap.Config.ARGB_8888);
            drawable.setBounds(0,0,64,64);drawable.draw(new Canvas(image));ByteArrayOutputStream bytes=new ByteArrayOutputStream();image.compress(Bitmap.CompressFormat.PNG,100,bytes);image.recycle();
            item.put("icon","data:image/png;base64,"+android.util.Base64.encodeToString(bytes.toByteArray(),android.util.Base64.NO_WRAP));out.put(item);
        }cachedApps=out;return out;
    }
    private void launchPackage(String id) {
        try { boolean allowed=false;JSONArray list=launchable();for(int i=0;i<list.length();i++)if(id.equals(list.getJSONObject(i).getString("id")))allowed=true;
            if(!allowed)throw new SecurityException();Intent target=getPackageManager().getLaunchIntentForPackage(id);if(target==null)throw new SecurityException();startActivity(target);
        }catch(Exception e){message("このアプリは起動できません。");}
    }
    private void recordInstalled(JSONObject installed, String id) throws JSONException {
        try { installed.put(id, getPackageManager().getPackageInfo(id, 0).getLongVersionCode()); }
        catch (PackageManager.NameNotFoundException absent) { /* fresh install */ }
    }
    public final class Bridge {
        @JavascriptInterface public String setupSnapshot(){
            if(!"home".equals(mode()))return "null";
            try{return Class.forName("network.awai.home.SetupPlatform").getMethod("snapshot",android.content.Context.class).invoke(null,HostActivity.this).toString();}
            catch(Exception unavailable){return "null";}
        }
        @JavascriptInterface public boolean setupTransition(String action,int expected){
            if(!"home".equals(mode()))return false;
            try{return (Boolean)Class.forName("network.awai.home.SetupPlatform").getMethod("transition",android.content.Context.class,String.class,int.class).invoke(null,HostActivity.this,action,expected);}
            catch(Exception unavailable){return false;}
        }
        @JavascriptInterface public boolean openAccountLink(String address) {
            if(!"home".equals(mode()) || address==null || address.length()>4096)return false;
            Uri uri=Uri.parse(address);
            String fragment=uri.getEncodedFragment();
            if(!"https".equals(uri.getScheme()) || !"awai.network".equals(uri.getEncodedAuthority())
                    || !"/link/".equals(uri.getEncodedPath()) || uri.getEncodedQuery()!=null
                    || fragment==null || !fragment.matches("[A-Za-z0-9_-]{1,4000}"))return false;
            runOnUiThread(()->{
                try {startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));}
                catch(android.content.ActivityNotFoundException unavailable){message("アカウント連携を開けるブラウザがありません。");}
            });
            return true;
        }
        @JavascriptInterface public void setupSettings(String kind){
            if(!"home".equals(mode()))return;
            runOnUiThread(()->{
                String action="language".equals(kind)?Settings.ACTION_LOCALE_SETTINGS:
                    "network".equals(kind)?Settings.ACTION_WIRELESS_SETTINGS:
                    "wifi".equals(kind)?Settings.ACTION_WIFI_SETTINGS:
                    "tether".equals(kind)?Settings.ACTION_WIRELESS_SETTINGS:
                    "datetime".equals(kind)?Settings.ACTION_DATE_SETTINGS:
                    "accessibility".equals(kind)?Settings.ACTION_ACCESSIBILITY_SETTINGS:
                    "lock".equals(kind)?android.app.admin.DevicePolicyManager.ACTION_SET_NEW_PASSWORD:null;
                if(action==null)return;
                try{startActivity(new Intent(action));}catch(ActivityNotFoundException unavailable){message("対応する Android 設定が見つかりません。");}
            });
        }
        @JavascriptInterface public String snapshot(){try{
            JSONObject o=new JSONObject();o.put("mode",mode());o.put("platform","android");o.put("runtime","android");o.put("apps","home".equals(mode())?launchable():new JSONArray());
            JSONObject installed=new JSONObject();
            if ("store".equals(mode())) {
                try {
                    JSONArray known = new JSONObject(trustedCatalog().json()).getJSONArray("apps");
                    for (int i = 0; i < known.length(); i++) recordInstalled(installed, known.getJSONObject(i).getString("id"));
                } catch (Exception invalidCatalog) { /* catalog() reports refusal independently */ }
            } else {
                recordInstalled(installed, "network.itonami.yotei");
            }
            String storage = storageKind();
            o.put("storageKind", storage);
            o.put("temporaryStorage", "temporary".equals(storage));
            o.put("motionReduced",Settings.Global.getFloat(getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f || getSystemService(PowerManager.class).isPowerSaveMode());
            o.put("installed",installed);RoleManager roles=getSystemService(RoleManager.class);o.put("isDefaultHome",roles!=null&&roles.isRoleHeld(RoleManager.ROLE_HOME));
            JSONArray agenda=new JSONArray();if("home".equals(mode())){try(Cursor c=getContentResolver().query(Uri.parse("content://network.itonami.yotei.agenda/events"),null,null,null,null)){if(c!=null&&c.moveToFirst())agenda=new JSONArray(c.getString(0));}catch(Exception absent){}}
            o.put("agenda",agenda);o.put("catalogOnline","store".equals(mode())&&Catalog.hasOnline(HostActivity.this));String msg=getSharedPreferences("host",0).getString("message","");o.put("message",msg);getSharedPreferences("host",0).edit().remove("message").apply();return o.toString();
        }catch(Exception e){return "{\"mode\":\""+mode()+"\",\"platform\":\"android\",\"runtime\":\"android\",\"apps\":[],\"installed\":{},\"agenda\":[]}";}}
        /** The key list this Store uses, for the page's own catalog check (AWAI-3775). */
        @JavascriptInterface public String keyList(){if(!"store".equals(mode()))return "{}";try{KeyList k=StoreTrust.load(HostActivity.this);
            java.util.Base64.Encoder b=java.util.Base64.getEncoder();
            return new JSONObject().put("root",b.encodeToString(Integrity.read(getAssets().open("store-root.der"),4096))).put("raw",b.encodeToString(k.raw())).put("signature",b.encodeToString(k.signature())).toString();
        }catch(Exception unavailable){return "{}";}}
        @JavascriptInterface public String catalog(){try{return "store".equals(mode())?trustedCatalog().json():"{\"apps\":[]}";}catch(Exception invalid){return "{}";}}
        @JavascriptInterface public void launch(String id){runOnUiThread(()->launchPackage(id));}
        @JavascriptInterface public void openStore(){runOnUiThread(()->launchPackage("network.awai.store"));}
        @JavascriptInterface public void openAppearance(){if(!"home".equals(mode()))return;runOnUiThread(()->{Intent i=new Intent();i.setClassName(getPackageName(),"network.awai.home.AppearanceActivity");startActivity(i);});}
        @JavascriptInterface public void openSettings(){runOnUiThread(()->startActivity(new Intent(Settings.ACTION_SETTINGS)));}
        @JavascriptInterface public void launchCategory(String category){runOnUiThread(()->{
            Intent q="phone".equals(category)?new Intent(Intent.ACTION_DIAL):"browser".equals(category)?new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_BROWSER):"camera".equals(category)?new Intent("android.media.action.STILL_IMAGE_CAMERA"):null;
            try{if(q==null)throw new SecurityException();ResolveInfo r=getPackageManager().resolveActivity(q,PackageManager.MATCH_DEFAULT_ONLY);if(r==null)throw new SecurityException();launchPackage(r.activityInfo.packageName);}catch(Exception unavailable){message("対応するアプリが見つかりません。");}
        });}
        @JavascriptInterface public void chooseHome(){if(!"home".equals(mode()))return;runOnUiThread(()->{RoleManager rm=getSystemService(RoleManager.class);if(rm!=null&&rm.isRoleAvailable(RoleManager.ROLE_HOME)&&!rm.isRoleHeld(RoleManager.ROLE_HOME))startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME),10);});}
        @JavascriptInterface public String admitOnlineCatalog(String raw,String signature){
            if(!"store".equals(mode())||onlineUrls.isEmpty()||raw==null||raw.length()>131072||signature==null||signature.length()>8192)return refusedCatalog("input");
            try{
                KeyList key=StoreTrust.load(HostActivity.this);
                JSONObject candidate=Catalog.verifyMetadata(raw.getBytes(StandardCharsets.UTF_8),android.util.Base64.decode(signature,android.util.Base64.DEFAULT),key,System.currentTimeMillis()/1000);
                // Any number of admitted apps (AWAI-3729). Transport stays limited to the pinned URLs: an app listed
                // without a pin is shown but cannot be fetched. Offline-only previews are refused here, not later.
                Catalog.checkOnline(candidate);
                Catalog current=trustedCatalog();long revision=candidate.getLong("revision");
                if(revision<current.valueRevision())throw new SecurityException("catalog-rollback");
                JSONObject pins=new JSONObject(new String(Integrity.read(getAssets().open("online-pins.json"),16384),StandardCharsets.UTF_8));
                JSONObject envelope=new JSONObject();envelope.put("raw",raw);envelope.put("signature",signature);
                // The exact release envelope is digest-pinned by the browser; host independently pins APK bytes and metadata signer.
                // Pin-driven lookup across admitted apps: catalog order never grants admission.
                // Every pinned app must be listed with exactly the pinned android artifact digest.
                JSONObject apks=pins.getJSONObject("apks");JSONArray listed=candidate.getJSONArray("apps");
                for(java.util.Iterator<String> ids=apks.keys();ids.hasNext();){String id=ids.next();Catalog.assetFor(id);String digest=null;
                    for(int j=0;j<listed.length();j++)if(id.equals(listed.getJSONObject(j).getString("id"))){JSONArray entries=listed.getJSONObject(j).getJSONArray("artifacts");
                        for(int i=0;i<entries.length();i++)if("android".equals(entries.getJSONObject(i).getString("platform")))digest=entries.getJSONObject(i).getString("sha256");}
                    if(digest==null||!digest.equals(apks.getJSONObject(id).getString("sha256")))throw new SecurityException("unpinned-artifact");}
                return Catalog.saveOnline(HostActivity.this,raw,signature,revision)?"ok":refusedCatalog("catalog-store");
            }catch(Exception invalid){return refusedCatalog(invalid instanceof SecurityException&&invalid.getMessage()!=null&&invalid.getMessage().matches("[a-z0-9-]{1,40}")?invalid.getMessage():invalid.getClass().getSimpleName());}
        }
        @JavascriptInterface public boolean hasOnlineApk(String id){if(!"store".equals(mode()))return false;try{Catalog c=trustedCatalog();if(!c.isOnlineDelivery(id))return false;verifyStaged(c,id);return true;}catch(Exception absent){return false;}}
        /** Permission difference between the installed app and its verified catalog APK. known=false when either side is unavailable. */
        @JavascriptInterface public String permissionChanges(String id){
            if(!"store".equals(mode()))return "{\"known\":false}";
            File file=null;
            try{Catalog c=trustedCatalog();PackageInfo installed=getPackageManager().getPackageInfo(id,PackageManager.GET_PERMISSIONS);
                file=c.verifiedApkFile(HostActivity.this,id);
                PackageInfo candidate=getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),PackageManager.GET_PERMISSIONS);
                if(candidate==null)return "{\"known\":false}";
                JSONObject o=new JSONObject();o.put("known",true);o.put("versionCode",candidate.getLongVersionCode());
                o.put("added",new JSONArray(UpdatePolicy.addedPermissions(requested(installed),requested(candidate))));return o.toString();
            }catch(Exception unknown){return "{\"known\":false}";}
            finally{if(file!=null&&!file.delete())file.deleteOnExit();}
        }
        @JavascriptInterface public String stageOnlineApk(String id,String encoded){
            int budget;try{budget=Catalog.maxApkBytes(id);}catch(SecurityException unadmitted){return "refused";}
            if(!"store".equals(mode())||encoded==null||encoded.length()>(long)budget*4/3+64)return "refused";
            File temporary=null;
            try{Catalog c=trustedCatalog();if(!c.isOnlineDelivery(id))throw new SecurityException();JSONObject a=c.artifact(id);
                byte[] bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);
                if(bytes.length>budget||bytes.length!=a.getLong("bytes")||!Integrity.sha256(bytes).equals(a.getString("sha256")))throw new SecurityException();
                temporary=File.createTempFile("online-", ".apk",getFilesDir());try(FileOutputStream output=new FileOutputStream(temporary)){output.write(bytes);output.getFD().sync();}
                if(!temporary.renameTo(new File(getFilesDir(),Catalog.onlineFileFor(id))))throw new IOException();
                verifyStaged(c,id);return "ok";
            }catch(Exception invalid){if(temporary!=null)temporary.delete();return "refused";}
        }
        // AWAI-3661: standing update approval. The page may read it, narrow it (stop, exclude) or ask
        // the host to show its native confirmation. Only a press in that native dialog turns it on or
        // widens it; no bridge method writes an approval directly.
        @JavascriptInterface public String autoUpdateState(){
            if(!"store".equals(mode()))return "{}";
            try{UpdatePolicy.Approval a=loadApproval();long now=System.currentTimeMillis()/1000;JSONObject o=new JSONObject();
                o.put("enabled",a.enabled);o.put("active",a.enabled&&a.grantedAt<=now&&a.expiresAt>now);
                o.put("expiresAt",a.expiresAt);o.put("unmeteredOnly",a.unmeteredOnly);o.put("excluded",new JSONArray(a.excludedApps));
                o.put("developmentKey",true);
                android.app.job.JobScheduler js=getSystemService(android.app.job.JobScheduler.class);
                o.put("running",js!=null&&js.getPendingJob(AutoUpdater.JOB_ID)!=null);
                o.put("log",new JSONArray(AutoUpdater.logJson(HostActivity.this)));return o.toString();
            }catch(Exception e){return "{}";}
        }
        @JavascriptInterface public void requestAutoUpdate(boolean unmeteredOnly){if(!"store".equals(mode()))return;runOnUiThread(()->confirmAutoUpdate(unmeteredOnly));}
        @JavascriptInterface public void revokeAutoUpdate(){if(!"store".equals(mode()))return;saveApproval(UpdateApprovalRecord.revoke(loadApproval()));AutoUpdater.sync(HostActivity.this);message("自動更新を止めました。更新はこれまでどおり毎回確認します。");}
        @JavascriptInterface public void excludeFromAutoUpdate(String id){if(!"store".equals(mode()))return;
            try{Catalog.assetFor(id);}catch(SecurityException unknown){return;}
            saveApproval(UpdateApprovalRecord.exclude(loadApproval(),id));message("このアプリは自動更新の対象外にしました。");}
        @JavascriptInterface public void requestAutoUpdateFor(String id){if(!"store".equals(mode()))return;runOnUiThread(()->confirmAutoUpdateFor(id));}
        @JavascriptInterface public void prepareInstall(String id){if(!"store".equals(mode()))return;runOnUiThread(()->confirmInstall(id));}
        @JavascriptInterface public void persistEvents(String json){if(!"yotei".equals(mode())||json==null||json.length()>131072)return;
            try{JSONArray events=new JSONArray(json);if(events.length()>200)return;for(int i=0;i<events.length();i++){JSONObject e=events.getJSONObject(i);if(e.getString("title").length()>160||e.getString("id").length()>80||e.getLong("at")<=0)return;}
                getSharedPreferences("agenda",0).edit().putString("events",events.toString()).apply();getContentResolver().notifyChange(Uri.parse("content://network.itonami.yotei.agenda/events"),null);
            }catch(JSONException invalid){} }
    }
    /** "refused:<code>" for the page, and one log line, so a refusal is never silent. The code names a check, never data. */
    private static String refusedCatalog(String code){android.util.Log.w("AwaiStore","online catalog refused: "+code);return "refused:"+code;}
    private static Set<String> requested(PackageInfo p){return p.requestedPermissions==null?new HashSet<String>():new HashSet<>(Arrays.asList(p.requestedPermissions));}
    private void verifyStaged(Catalog catalog, String id) throws Exception {
        File file = catalog.verifiedApkFile(this, id);
        if (!file.delete()) file.deleteOnExit();
    }
    private UpdatePolicy.Approval loadApproval(){return UpdateApprovalRecord.decode(getSharedPreferences("auto-update",0).getString("approval",null));}
    private void saveApproval(UpdatePolicy.Approval a){getSharedPreferences("auto-update",0).edit().putString("approval",UpdateApprovalRecord.encode(a)).commit();}
    /** Native, outside page control. Allow is armed after 600 ms, as in the consent dialog. */
    private void confirmNative(String title,String body,String allow,Runnable onAllow){
        AlertDialog d=new AlertDialog.Builder(this).setTitle(title).setMessage(body)
            .setPositiveButton(allow,(x,w)->onAllow.run()).setNegativeButton("今はしない",null).create();
        d.setOnShowListener(v->{Button b=d.getButton(AlertDialog.BUTTON_POSITIVE);b.setFilterTouchesWhenObscured(true);b.setEnabled(false);b.postDelayed(()->b.setEnabled(true),600);});
        d.show();
    }
    private void confirmAutoUpdate(boolean unmeteredOnly){
        long now=System.currentTimeMillis()/1000;
        String until=java.text.DateFormat.getDateInstance(java.text.DateFormat.LONG,Locale.JAPAN).format(new Date((now+UpdatePolicy.MAX_APPROVAL_SECONDS)*1000));
        String body="対象: この Store で追加したアプリの更新\n"
            +"取得先: raw.githubusercontent.com（network-awai/awai-os の署名済み配布ファイル）\n"
            +"操作: 署名済みの鍵の一覧とカタログの読み取り（1 日 1 回まで）と、更新ファイルの取得・インストール\n"
            +"伝わる情報: IP アドレス、確認の時刻、追加済みのアプリ\n"
            +"条件: 同じ配布元の署名で、より新しい版で、新しい権限や通信先を追加しない更新だけ。それ以外の更新は、これまでどおり毎回確認します。\n"
            +"回線: "+(unmeteredOnly?"従量制でない回線（Wi-Fi など）のみ":"すべての回線")+"\n"
            +"期限: "+until+" まで（90 日）。Store の「更新」からいつでも止められます。\n\n"
            +"この版の配布は開発用の署名鍵です。本番の鍵はまだありません。";
        confirmNative("自動更新を有効にしますか？",body,"自動更新を有効にする",()->{
            saveApproval(UpdateApprovalRecord.grant(System.currentTimeMillis()/1000,unmeteredOnly,loadApproval().excludedApps));
            AutoUpdater.sync(this);
            if(checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},11);
            message("自動更新を有効にしました。");
        });
    }
    private void confirmAutoUpdateFor(String id){
        String name=id;
        try{name=trustedCatalog().app(id).getString("name");}catch(Exception unknown){return;}
        UpdatePolicy.Approval a=loadApproval();if(!a.enabled||!a.excludedApps.contains(id))return;
        confirmNative(name+" を自動更新の対象に戻しますか？","有効な自動更新の範囲に "+name+" の更新を加えます。条件と取得先は自動更新の設定と同じです。","対象に戻す",()->{
            saveApproval(UpdateApprovalRecord.include(loadApproval(),id));message("自動更新の対象に戻しました。");
        });
    }
    private void confirmInstall(String id){
        if(installing)return;
        try{Catalog catalog=trustedCatalog();JSONObject app=catalog.app(id),a=catalog.artifact(id);
            boolean onlineDelivery=catalog.isOnlineDelivery(id);
            if(!getPackageManager().canRequestPackageInstalls()){
                new AlertDialog.Builder(this).setTitle("Android の追加設定").setMessage("Itonami Store からアプリを追加するには、次の Android 設定でこの Store からの追加を許可してください。その後、追加内容をもう一度確認できます。")
                    .setPositiveButton("Android 設定を開く",(d,w)->startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())))).setNegativeButton("今は追加しない",null).show();return;
            }
            String previous = null;
            try { previous = getPackageManager().getPackageInfo(id, 0).versionName; }
            catch (PackageManager.NameNotFoundException absent) { /* fresh install */ }
            String operation = previous == null ? "追加" : "更新";
            new AlertDialog.Builder(this).setTitle(app.getString("name")+" の"+operation+"を確認")
                .setMessage("配布元: "+app.getString("publisher")+"\n版: "+(previous==null?"":previous+" → ")+app.getString("versionName")+"\n取得先: "+(onlineDelivery?"オンライン配信・検証済みキャッシュ":"この Store に同梱")+"\n外部への送信: なし"+(onlineDelivery?"（取得時に配信先へ IP 等が伝わります）":"")+("network.itonami.torihiki".equals(id)?"\nアプリ使用時: devnet ノードへ読み取り・署名した devnet 取引（送信ごとに確認）":"")+"\n\n署名と SHA-256 を確認した後、Android のインストール画面に進みます。\n\nSHA-256\n"+a.getString("sha256"))
                .setPositiveButton("今回の"+operation+"に進む",(d,w)->install(id)).setNegativeButton("今は追加しない",null).show();
        }catch(Exception invalid){message("配布元またはカタログを確認できません。追加を停止しました。");}
    }
    private void install(String id){installing=true;new Thread(()->{
        PackageInstaller installer=getPackageManager().getPackageInstaller();int sessionId=-1;File verified=null;
        try{verified=trustedCatalog().verifiedApkFile(this,id);PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(id);params.setSize(verified.length());params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);sessionId=installer.createSession(params);
            try(PackageInstaller.Session session=installer.openSession(sessionId)){
                try(InputStream input=new FileInputStream(verified);OutputStream out=session.openWrite("base.apk",0,verified.length())){byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)out.write(buffer,0,n);session.fsync(out);}
                getSharedPreferences("host",0).edit().putInt("install-session",sessionId).apply();
                AutoInstall.rememberPending(this,sessionId,trustedCatalog().app(id),verified);
                Intent callback=new Intent(this,InstallReceiver.class).setAction(getPackageName()+".INSTALL_RESULT").putExtra("package",id);
                PendingIntent status=PendingIntent.getBroadcast(this,sessionId,callback,PendingIntent.FLAG_MUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
                session.commit(status.getIntentSender());
            }message("Android の追加確認をお待ちください。");
        }catch(Exception invalid){if(sessionId>=0)installer.abandonSession(sessionId);message("ファイルの署名または整合性を確認できません。追加を停止しました。");}
        finally{if(verified!=null&&!verified.delete())verified.deleteOnExit();installing=false;}
    },"awai-install").start();}
}
