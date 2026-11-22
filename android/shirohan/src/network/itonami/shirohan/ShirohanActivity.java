package network.itonami.shirohan;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class ShirohanActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String ENTRY = ORIGIN + "/index.html";
    private static final int PICK_ART = 1;
    private static final int MAX_EXPORT_BYTES = 8 * 1024 * 1024;
    private static final Map<String, String> TYPES = Map.of(
            "index.html", "text/html", "app.css", "text/css", "app.js", "text/javascript",
            "runtime.js", "text/javascript", "worker.js", "text/javascript",
            "descriptor.json", "application/json");
    private static final String CSP = "default-src 'none'; script-src 'self'; style-src 'self'; "
            + "img-src blob:; worker-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

    private WebView web;
    private ValueCallback<Uri[]> picker;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                    | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setBlockNetworkLoads(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("GET".equals(request.getMethod()) && "https".equals(url.getScheme())
                        && "appassets.androidplatform.net".equals(url.getEncodedAuthority())
                        && url.getQuery() == null && url.getPathSegments().size() == 1) {
                    String name = url.getLastPathSegment();
                    String mime = TYPES.get(name);
                    if (mime != null && (!request.isForMainFrame() || ENTRY.equals(url.toString()))) {
                        try {
                            return new WebResourceResponse(mime, "UTF-8", 200, "OK",
                                    Map.of("Content-Security-Policy", CSP, "X-Content-Type-Options", "nosniff"),
                                    getAssets().open(name));
                        } catch (IOException missing) {
                            // Fall through to a closed response for a missing packaged asset.
                        }
                    }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Map.of(),
                        new ByteArrayInputStream(new byte[0]));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (picker != null || params.getMode() != FileChooserParams.MODE_OPEN) {
                    callback.onReceiveValue(null);
                    return true;
                }
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("image/*").putExtra(Intent.EXTRA_MIME_TYPES,
                                new String[]{"image/svg+xml", "image/png", "image/jpeg", "image/webp"});
                picker = callback;
                try {
                    startActivityForResult(intent, PICK_ART);
                } catch (ActivityNotFoundException unavailable) {
                    finishPicker(null);
                }
                return true;
            }
        });
        // Only the packaged document can load scripts. The bridge writes generated SVGs
        // to Downloads and exposes no filesystem reads or arbitrary paths.
        web.addJavascriptInterface(new SvgExports(getContentResolver()), "ShirohanFiles");
        setContentView(web);
        web.loadUrl(ENTRY);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_ART) return;
        Uri selected = result == RESULT_OK && data != null ? data.getData() : null;
        finishPicker(selected != null && "content".equals(selected.getScheme()) ? new Uri[]{selected} : null);
    }

    private void finishPicker(Uri[] result) {
        ValueCallback<Uri[]> callback = picker;
        picker = null;
        if (callback != null) callback.onReceiveValue(result);
    }

    @Override protected void onDestroy() {
        finishPicker(null);
        web.removeJavascriptInterface("ShirohanFiles");
        web.destroy();
        super.onDestroy();
    }

    public static final class SvgExports {
        private final ContentResolver resolver;

        SvgExports(ContentResolver resolver) { this.resolver = resolver; }

        @JavascriptInterface public boolean saveSvg(String name, String svg) {
            if (name == null || !name.matches("[0-9a-zA-Z_#-]{1,96}\\.svg")
                    || svg == null || svg.length() > MAX_EXPORT_BYTES) return false;
            byte[] bytes = svg.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_EXPORT_BYTES) return false;

            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, "image/svg+xml");
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Shirohan");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri output = null;
            try {
                output = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (output == null) return false;
                try (OutputStream stream = resolver.openOutputStream(output)) {
                    if (stream == null) throw new IOException("Downloads output unavailable");
                    stream.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                if (resolver.update(output, values, null, null) != 1) throw new IOException("Publish failed");
                return true;
            } catch (IOException | RuntimeException failure) {
                if (output != null) {
                    try { resolver.delete(output, null, null); } catch (RuntimeException ignored) { }
                }
                return false;
            }
        }
    }
}
