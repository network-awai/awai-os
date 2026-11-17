package network.awai.platform;

import android.app.*;
import android.app.role.RoleManager;
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
            ||("/account".equals(path)&&query!=null&&query.matches("id=[1-9][0-9]{5,13}"));
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
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT); getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().getDecorView(); // Ensure PhoneWindow creates its decor before requesting the controller.
        getWindow().getInsetsController().setSystemBarsAppearance(
                dark ? 0 : WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
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
            for(String kind:new String[]{"catalog","apk"}){
                String url=pins.getJSONObject(kind).getString("url");Uri parsed=Uri.parse(url);
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
            JSONObject installed=new JSONObject();for(String id:new String[]{"network.itonami.yotei","network.itonami.torihiki"}){try{installed.put(id,getPackageManager().getPackageInfo(id,0).getLongVersionCode());}catch(PackageManager.NameNotFoundException absent){}}
            o.put("motionReduced",Settings.Global.getFloat(getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f || getSystemService(PowerManager.class).isPowerSaveMode());
            o.put("installed",installed);RoleManager roles=getSystemService(RoleManager.class);o.put("isDefaultHome",roles!=null&&roles.isRoleHeld(RoleManager.ROLE_HOME));
            JSONArray agenda=new JSONArray();if("home".equals(mode())){try(Cursor c=getContentResolver().query(Uri.parse("content://network.itonami.yotei.agenda/events"),null,null,null,null)){if(c!=null&&c.moveToFirst())agenda=new JSONArray(c.getString(0));}catch(Exception absent){}}
            o.put("agenda",agenda);o.put("catalogOnline","store".equals(mode())&&getSharedPreferences("online",0).contains("raw"));String msg=getSharedPreferences("host",0).getString("message","");o.put("message",msg);getSharedPreferences("host",0).edit().remove("message").apply();return o.toString();
        }catch(Exception e){return "{\"mode\":\""+mode()+"\",\"platform\":\"android\",\"runtime\":\"android\",\"apps\":[],\"installed\":{},\"agenda\":[]}";}}
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
            if(!"store".equals(mode())||onlineUrls.isEmpty()||raw==null||raw.length()>131072||signature==null||signature.length()>8192)return "refused";
            try{
                byte[] key=Integrity.read(getAssets().open("catalog-key.der"),4096);
                JSONObject candidate=Catalog.verifyMetadata(raw.getBytes(StandardCharsets.UTF_8),android.util.Base64.decode(signature,android.util.Base64.DEFAULT),key,System.currentTimeMillis()/1000);
                Catalog current=trustedCatalog();long revision=candidate.getLong("revision");
                if(revision<current.valueRevision())throw new SecurityException("rollback");
                JSONObject pins=new JSONObject(new String(Integrity.read(getAssets().open("online-pins.json"),16384),StandardCharsets.UTF_8));
                JSONObject envelope=new JSONObject();envelope.put("raw",raw);envelope.put("signature",signature);
                // The exact release envelope is digest-pinned by the browser; host independently pins APK bytes and metadata signer.
                // Pin-driven lookup across admitted apps: catalog order never grants admission.
                JSONObject artifact=null;JSONArray listed=candidate.getJSONArray("apps");
                for(int j=0;j<listed.length()&&artifact==null;j++){try{Catalog.assetFor(listed.getJSONObject(j).getString("id"));}catch(SecurityException unadmitted){continue;}
                    JSONArray entries=listed.getJSONObject(j).getJSONArray("artifacts");
                    for(int i=0;i<entries.length();i++)if("android".equals(entries.getJSONObject(i).getString("platform")))artifact=entries.getJSONObject(i);}
                if(artifact==null||!artifact.getString("sha256").equals(pins.getJSONObject("apk").getString("sha256")))throw new SecurityException("unpinned-artifact");
                return getSharedPreferences("online",0).edit().putString("raw",raw).putString("signature",signature).putLong("highest",revision).commit()?"ok":"refused";
            }catch(Exception invalid){return "refused";}
        }
        @JavascriptInterface public boolean hasOnlineApk(String id){if(!"store".equals(mode()))return false;try{Catalog c=trustedCatalog();if(!c.online)return false;c.verifiedApk(HostActivity.this,id);return true;}catch(Exception absent){return false;}}
        @JavascriptInterface public String stageOnlineApk(String id,String encoded){
            int budget;try{budget=Catalog.maxApkBytes(id);}catch(SecurityException unadmitted){return "refused";}
            if(!"store".equals(mode())||encoded==null||encoded.length()>(long)budget*4/3+64)return "refused";
            File temporary=null;
            try{Catalog c=trustedCatalog();if(!c.online)throw new SecurityException();JSONObject a=c.artifact(id);
                byte[] bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);
                if(bytes.length>budget||bytes.length!=a.getLong("bytes")||!Integrity.sha256(bytes).equals(a.getString("sha256")))throw new SecurityException();
                temporary=File.createTempFile("online-", ".apk",getFilesDir());try(FileOutputStream output=new FileOutputStream(temporary)){output.write(bytes);output.getFD().sync();}
                if(!temporary.renameTo(new File(getFilesDir(),Catalog.onlineFileFor(id))))throw new IOException();
                c.verifiedApk(HostActivity.this,id);return "ok";
            }catch(Exception invalid){if(temporary!=null)temporary.delete();return "refused";}
        }
        @JavascriptInterface public void prepareInstall(String id){if(!"store".equals(mode()))return;runOnUiThread(()->confirmInstall(id));}
        @JavascriptInterface public void persistEvents(String json){if(!"yotei".equals(mode())||json==null||json.length()>131072)return;
            try{JSONArray events=new JSONArray(json);if(events.length()>200)return;for(int i=0;i<events.length();i++){JSONObject e=events.getJSONObject(i);if(e.getString("title").length()>160||e.getString("id").length()>80||e.getLong("at")<=0)return;}
                getSharedPreferences("agenda",0).edit().putString("events",events.toString()).apply();getContentResolver().notifyChange(Uri.parse("content://network.itonami.yotei.agenda/events"),null);
            }catch(JSONException invalid){} }
    }
    private void confirmInstall(String id){
        if(installing)return;
        try{JSONObject app=trustedCatalog().app(id),a=trustedCatalog().artifact(id);
            if(!getPackageManager().canRequestPackageInstalls()){
                new AlertDialog.Builder(this).setTitle("Android の追加設定").setMessage("Itonami Store からアプリを追加するには、次の Android 設定でこの Store からの追加を許可してください。その後、追加内容をもう一度確認できます。")
                    .setPositiveButton("Android 設定を開く",(d,w)->startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())))).setNegativeButton("今は追加しない",null).show();return;
            }
            new AlertDialog.Builder(this).setTitle(app.getString("name")+" の追加を確認")
                .setMessage("配布元: "+app.getString("publisher")+"\n版: "+app.getString("versionName")+"\n取得先: "+(trustedCatalog().online?"オンライン配信・検証済みキャッシュ":"この Store に同梱")+"\n外部への送信: なし（取得時に配信先へ IP 等が伝わります）"+("network.itonami.torihiki".equals(id)?"\nアプリ使用時: devnet ノードへ読み取り・署名した devnet 取引（送信ごとに確認）":"")+"\n\n署名と SHA-256 を確認した後、Android のインストール画面に進みます。\n\nSHA-256\n"+a.getString("sha256"))
                .setPositiveButton("今回の追加に進む",(d,w)->install(id)).setNegativeButton("今は追加しない",null).show();
        }catch(Exception invalid){message("配布元またはカタログを確認できません。追加を停止しました。");}
    }
    private void install(String id){installing=true;new Thread(()->{
        PackageInstaller installer=getPackageManager().getPackageInstaller();int sessionId=-1;
        try{byte[] bytes=trustedCatalog().verifiedApk(this,id);PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(id);params.setSize(bytes.length);params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);sessionId=installer.createSession(params);
            try(PackageInstaller.Session session=installer.openSession(sessionId)){
                try(OutputStream out=session.openWrite("base.apk",0,bytes.length)){out.write(bytes);session.fsync(out);}
                getSharedPreferences("host",0).edit().putInt("install-session",sessionId).apply();
                Intent callback=new Intent(this,InstallReceiver.class).setAction(getPackageName()+".INSTALL_RESULT");
                PendingIntent status=PendingIntent.getBroadcast(this,sessionId,callback,PendingIntent.FLAG_MUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
                session.commit(status.getIntentSender());
            }message("Android の追加確認をお待ちください。");
        }catch(Exception invalid){if(sessionId>=0)installer.abandonSession(sessionId);message("ファイルの署名または整合性を確認できません。追加を停止しました。");}
        finally{installing=false;}
    },"awai-install").start();}
}
