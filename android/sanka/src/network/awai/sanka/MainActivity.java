package network.awai.sanka;

import android.app.Activity;
import network.awai.systembars.SystemBars;
import android.graphics.Typeface;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * ADR 0027 V4 (AWAI-3123): the owner's confirmation and acceptance cards, drawn by this native
 * Activity from the exact bytes it signs. No WebView, dapp or model draws them.
 *
 * <p>A request arrives as files in this app's private storage: {@code request.kind} ("order" or
 * "acceptance"), {@code request.bin} (the canonical order or receipt bytes) and, for acceptance,
 * {@code answer.json} (the canonical answer message whose CID the receipt names). The card shows
 * fields parsed from those bytes and signs the bytes' CID. A signature is made only after a tap on
 * this Activity's own button, with a non-exportable P-256 key from Android Keystore. The result is
 * written to {@code result.json}. The key is a device key standing in for the owner's Passkey or
 * wallet (ADR 0026 D13); it requires no user authentication on this build.
 */
public final class MainActivity extends Activity {
    static final String ALIAS = "awai.sanka.owner-approval";
    static final byte[] CID_PREFIX = {0x01, (byte) 0xa9, 0x02, 0x12, 0x20};
    static final String BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

    private LinearLayout root;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        SystemBars.applyForUiMode(this, getResources().getConfiguration());
        ScrollView scroll = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private void render() {
        root.removeAllViews();
        try {
            String spki = ensureKey();
            File kind = file("request.kind");
            if (!kind.exists()) {
                title("参加 Sanka");
                row("Pending request", "None / 確認待ちはありません");
                row("Owner key", spki.substring(0, 24) + "…");
                return;
            }
            String k = read(kind).trim();
            byte[] bytes = Files.readAllBytes(file("request.bin").toPath());
            if ("order".equals(k)) {
                orderCard(bytes);
            } else if ("acceptance".equals(k)) {
                acceptanceCard(bytes);
            } else {
                refuseCard("Unknown request kind / 不明な依頼です");
            }
        } catch (Exception e) {
            refuseCard("This request cannot be shown / 表示できません: " + e.getClass().getSimpleName());
        }
    }

    private void orderCard(byte[] bytes) throws Exception {
        JSONObject o = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        String cid = cid(bytes);
        if (!"awai.order/1".equals(o.optString("kind"))) {
            refuseCard("Not an order / 注文ではありません");
            return;
        }
        title("注文の確認 · Confirm order");
        row("Provider / 提供者", o.optString("provider"));
        row("Amount / 金額", o.optString("amount") + " " + o.optString("asset"));
        row("Value class / 価値区分", label(o.optString("value-class")));
        row("Expires / 期限", time(o.optLong("expires-at") * 1000));
        row("Data sent / 送るデータ", join(o.optJSONArray("data-categories")));
        JSONObject m = o.optJSONObject("model");
        row("Model / モデル", m == null ? "?" : m.optString("revision").substring(0, Math.min(12, m.optString("revision").length()))
                + " · " + m.optString("digest").substring(0, Math.min(19, m.optString("digest").length())));
        row("Max tokens", String.valueOf(o.optLong("max-tokens")));
        row("Demand / 需要", o.optString("demand"));
        row("Order", cid);
        buttons("承認する · Approve", "拒否する · Deny", verdict ->
                sign("awai.sanka.approval/1\norder=" + cid + "\nverdict=" + verdict + "\nat=" + System.currentTimeMillis()),
                "approve", "deny");
    }

    private void acceptanceCard(byte[] receiptBytes) throws Exception {
        JSONObject r = new JSONObject(new String(receiptBytes, StandardCharsets.UTF_8));
        byte[] answerBytes = Files.readAllBytes(file("answer.json").toPath());
        String answerCid = cid(answerBytes);
        if (!"awai.work-receipt/1".equals(r.optString("kind")) || !answerCid.equals(r.optString("output"))) {
            refuseCard("The answer does not match the receipt / 回答が受領記録と一致しません");
            return;
        }
        String receiptCid = cid(receiptBytes);
        JSONObject answer = new JSONObject(new String(answerBytes, StandardCharsets.UTF_8));
        JSONObject measured = r.optJSONObject("measured");
        title("結果の受入 · Accept result");
        row("Provider / 提供者", r.optString("provider"));
        row("Node", r.optString("node"));
        row("Model / モデル", r.optJSONObject("model") == null ? "?" : r.optJSONObject("model").optString("digest"));
        row("Measured / 計測", measured == null ? "?" : measured.optLong("prompt-tokens") + " + "
                + measured.optLong("completion-tokens") + " tokens");
        row("Answer / 回答", answer.optString("content"));
        row("Order", r.optString("order"));
        row("Receipt", receiptCid);
        String order = r.optString("order");
        buttons("受け入れる · Accept", "受け入れない · Reject", verdict ->
                sign("awai.sanka.acceptance/1\norder=" + order + "\nreceipt=" + receiptCid
                        + "\nverdict=" + verdict + "\nat=" + System.currentTimeMillis()),
                "accept", "reject");
    }

    interface Signer { void run(String verdict) throws Exception; }

    private void buttons(String yes, String no, Signer signer, String yesVerdict, String noVerdict) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.addView(button(no, signer, noVerdict));
        bar.addView(button(yes, signer, yesVerdict));
        root.addView(bar);
    }

    private Button button(String text, Signer signer, String verdict) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        // Refuse taps that pass through another app's overlay (tapjacking).
        b.setFilterTouchesWhenObscured(true);
        b.setOnClickListener((View v) -> {
            try {
                signer.run(verdict);
                done(verdict);
            } catch (Exception e) {
                refuseCard("Signing failed / 署名できません: " + e.getClass().getSimpleName());
            }
        });
        return b;
    }

    private void sign(String payload) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        Signature s = Signature.getInstance("SHA256withECDSA");
        s.initSign((PrivateKey) ks.getKey(ALIAS, null));
        s.update(payload.getBytes(StandardCharsets.UTF_8));
        JSONObject result = new JSONObject();
        result.put("payload", payload);
        result.put("sig", Base64.encodeToString(s.sign(), Base64.NO_WRAP));
        result.put("spki", ensureKey());
        write(file("result.json"), result.toString().getBytes(StandardCharsets.UTF_8));
        // One request, one answer.
        file("request.kind").delete();
        file("request.bin").delete();
        file("answer.json").delete();
    }

    private void done(String verdict) {
        root.removeAllViews();
        title("Done / 完了");
        row("Signed", verdict);
    }

    private String ensureKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyPairGenerator g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            g.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .build());
            g.generateKeyPair();
        }
        String spki = Base64.encodeToString(ks.getCertificate(ALIAS).getPublicKey().getEncoded(), Base64.NO_WRAP);
        File owner = file("owner.json");
        if (!owner.exists()) {
            JSONObject o = new JSONObject();
            o.put("kind", "awai.sanka.owner-key/1");
            o.put("spki", spki);
            write(owner, o.toString().getBytes(StandardCharsets.UTF_8));
        }
        return spki;
    }

    // -- CIDv1, dag-json, sha2-256, lower-case base32: the CID of the exact bytes received --

    static String cid(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        byte[] raw = new byte[CID_PREFIX.length + digest.length];
        System.arraycopy(CID_PREFIX, 0, raw, 0, CID_PREFIX.length);
        System.arraycopy(digest, 0, raw, CID_PREFIX.length, digest.length);
        StringBuilder out = new StringBuilder("b");
        int buffer = 0, bits = 0;
        for (byte b : raw) {
            buffer = (buffer << 8) | (b & 0xff);
            bits += 8;
            while (bits >= 5) {
                out.append(BASE32.charAt((buffer >> (bits - 5)) & 31));
                bits -= 5;
            }
        }
        if (bits > 0) out.append(BASE32.charAt((buffer << (5 - bits)) & 31));
        return out.toString();
    }

    // -- views and files --

    private void title(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(22);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, 0, 0, 24);
        root.addView(t);
    }

    private void row(String name, String value) {
        TextView n = new TextView(this);
        n.setText(name);
        n.setTextSize(12);
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(16);
        v.setTextIsSelectable(true);
        v.setPadding(0, 0, 0, 16);
        root.addView(n);
        root.addView(v);
    }

    private void refuseCard(String why) {
        root.removeAllViews();
        title("確認できません · Cannot confirm");
        row("Reason", why);
    }

    private static String label(String valueClass) {
        if ("devnet".equals(valueClass)) return "devnet — no real value / 実際の価値なし";
        if ("simulation".equals(valueClass)) return "simulation — no real value / 実際の価値なし";
        return valueClass;
    }

    private static String time(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss z", Locale.ROOT).format(new Date(ms));
    }

    private static String join(JSONArray a) {
        if (a == null) return "?";
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < a.length(); i++) s.append(i == 0 ? "" : ", ").append(a.optString(i));
        return s.toString();
    }

    private File file(String name) { return new File(getFilesDir(), name); }

    private static String read(File f) throws Exception {
        return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
    }

    private static void write(File f, byte[] data) throws Exception {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data);
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IllegalStateException("rename");
    }
}
