package network.awai.home;

import android.app.KeyguardManager;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Same-user, same-signer IPC to the account already linked in Awai Home. */
public final class HostAccountProvider extends ContentProvider {
    private static final String APP = "network.itonami.app";
    private static final String ORIGIN = "https://appassets.androidplatform.net/awai/";
    private static final String NONCE = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Semaphore issuing = new Semaphore(1);

    @Override public boolean onCreate() { return true; }

    @Override public Bundle call(String method, String nonce, Bundle extras) {
        final Context context = getContext();
        final int uid = Binder.getCallingUid();
        if (!"itonami-session-v1".equals(method) || nonce == null || !nonce.matches(NONCE) ||
                extras != null || context == null || Looper.myLooper() == Looper.getMainLooper()) return null;
        try {
            PackageManager packages = context.getPackageManager();
            if (!APP.equals(getCallingPackage()) || packages.getApplicationInfo(APP, 0).uid != uid ||
                    packages.checkSignatures(uid, android.os.Process.myUid()) != PackageManager.SIGNATURE_MATCH ||
                    !unlocked(context) || !issuing.tryAcquire()) return null;
            try {
                String request = new JSONObject().put("app", APP).put("uid", uid).put("nonce", nonce).toString();
                CompletableFuture<String> result = new CompletableFuture<>();
                main.post(() -> readLink(context, request, result));
                String proof;
                try {
                    proof = result.get(5, TimeUnit.SECONDS);
                } finally {
                    result.complete("");
                }
                if (proof.isEmpty() || !unlocked(context)) return null;
                Bundle response = new Bundle();
                response.putString("proof", proof);
                return response;
            } finally {
                issuing.release();
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return null;
        } catch (Exception unavailable) {
            return null;
        }
    }

    private static boolean unlocked(Context context) {
        KeyguardManager keyguard = context.getSystemService(KeyguardManager.class);
        return keyguard != null && keyguard.isDeviceSecure() && !keyguard.isDeviceLocked();
    }

    private void readLink(Context context, String request, CompletableFuture<String> result) {
        if (result.isDone() || !unlocked(context)) {
            result.complete("");
            return;
        }
        try {
            WebView web = new WebView(context);
            result.whenComplete((value, error) -> main.post(() -> {
                web.removeJavascriptInterface("AwaiAccountBroker");
                web.destroy();
            }));
            web.getSettings().setJavaScriptEnabled(true);
            web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setAllowContentAccess(false);
            web.getSettings().setAllowFileAccess(false);
            web.getSettings().setBlockNetworkLoads(true);
            web.addJavascriptInterface(new ProofBridge(request, result), "AwaiAccountBroker");
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    if ("GET".equals(request.getMethod()) &&
                            (url.equals(ORIGIN + "account-broker.html") || url.equals(ORIGIN + "account-broker.js"))) {
                        String name = url.substring(ORIGIN.length());
                        try {
                            return new WebResourceResponse(name.endsWith(".html") ? "text/html" : "text/javascript",
                                    "UTF-8", context.getAssets().open(name));
                        } catch (IOException unavailable) { /* Fail closed below. */ }
                    }
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
            });
            web.loadUrl(ORIGIN + "account-broker.html");
        } catch (RuntimeException unavailable) {
            result.complete("");
        }
    }

    private static final class ProofBridge {
        private final String request;
        private final CompletableFuture<String> result;

        ProofBridge(String request, CompletableFuture<String> result) {
            this.request = request;
            this.result = result;
        }

        @JavascriptInterface public String request() { return request; }
        @JavascriptInterface public void complete(String proof) {
            result.complete(proof != null && proof.length() <= 2048 ? proof : "");
        }
    }

    @Override public String getType(Uri uri) { throw new UnsupportedOperationException(); }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
