package network.awai.home;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;
import org.json.JSONObject;

/** Broker for the signed account of the current Android user. */
public final class AccountBrokerActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net/awai/";
    private static final String ACTION = "network.awai.home.WNFS_ACCOUNT_PROOF";
    private WebView web;
    private String request;
    private boolean approved;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        final String app = getCallingPackage();
        if (state != null || !ACTION.equals(getIntent().getAction()) ||
                !("network.awai.drive".equals(app) || "network.awai.yataverse".equals(app)) ||
                getPackageManager().checkSignatures(app, getPackageName()) != PackageManager.SIGNATURE_MATCH ||
                !deviceAvailable()) {
            finish();
            return;
        }
        final String purpose = getIntent().getStringExtra("purpose");
        final String value = getIntent().getStringExtra("value");
        final String recipient = getIntent().getStringExtra("recipient");
        final boolean binding = "bind-wnfs-key".equals(purpose) && value != null &&
                value.matches("kv1:[A-Za-z0-9_-]{43}") && recipient == null;
        final boolean sharing = "sign-wnfs-share".equals(purpose) && value != null &&
                value.matches("[a-f0-9]{64}") && recipient != null && recipient.matches("did:key:z[1-9A-HJ-NP-Za-km-z]{20,110}");
        if (!binding && !sharing) {
            finish();
            return;
        }
        try {
            JSONObject action = new JSONObject().put("purpose", purpose).put("value", value);
            if (sharing) action.put("recipient", recipient);
            request = new JSONObject().put("app", app).put("action", action).toString();
        } catch (Exception invalid) {
            finish();
            return;
        }
        final String label = "network.awai.drive".equals(app) ? "Drive" : "Itonami";
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Awai アカウント")
                .setMessage(binding ? label + " の端末鍵をこのアカウントに登録しますか？\n\n" + value
                        : label + " のスナップショット共有票に署名しますか？\n\n宛先 " + recipient)
                .setNegativeButton("キャンセル", (ignored, button) -> finish())
                .setOnCancelListener(ignored -> finish())
                .setPositiveButton("承認", (ignored, button) -> startSigning())
                .create();
        dialog.getWindow().setHideOverlayWindows(true);
        dialog.show();
    }

    private boolean deviceAvailable() {
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        return keyguard != null && keyguard.isDeviceSecure() && !keyguard.isDeviceLocked();
    }

    private void startSigning() {
        if (!deviceAvailable()) {
            finish();
            return;
        }
        approved = true;
        web = new WebView(this);
        setContentView(web);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setBlockNetworkLoads(true);
        web.addJavascriptInterface(new BrokerBridge(), "AwaiAccountBroker");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if ("GET".equals(request.getMethod())) {
                    String url = request.getUrl().toString();
                    if (url.equals(ORIGIN + "account-broker.html") || url.equals(ORIGIN + "account-broker.js")) {
                        String name = url.substring(ORIGIN.length());
                        try {
                            return new WebResourceResponse(name.endsWith(".html") ? "text/html" : "text/javascript",
                                    "UTF-8", getAssets().open(name));
                        } catch (IOException unavailable) { /* Fail closed below. */ }
                    }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        web.loadUrl(ORIGIN + "account-broker.html");
        web.postDelayed(() -> { if (approved) finish(); }, 15000);
    }

    private final class BrokerBridge {
        @JavascriptInterface public String request() { return request; }

        @JavascriptInterface public void complete(String proof) {
            runOnUiThread(() -> {
                if (!approved || isFinishing()) return;
                approved = false;
                if (deviceAvailable() && proof != null && !proof.isEmpty() && proof.length() <= 16384) {
                    setResult(RESULT_OK, new Intent().putExtra("accountProof", proof));
                }
                finish();
            });
        }
    }

    @Override public void onDestroy() {
        approved = false;
        if (web != null) {
            web.removeJavascriptInterface("AwaiAccountBroker");
            web.destroy();
        }
        super.onDestroy();
    }
}
