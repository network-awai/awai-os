package network.awai.nearbyprobe;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.net.wifi.p2p.WifiP2pManager;
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceInfo;
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceRequest;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;
import android.widget.TextView;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;

/**
 * AWAI-3058 P0 spike. Test-only package; touches no Awai app data.
 * Driven by: adb shell am start -n network.awai.nearbyprobe/.ProbeActivity --es op OP [--ei secs N] [--ez mlock true]
 * Every observation is one logcat line with tag AwaiProbe: "op=... event=... k=v".
 */
public final class ProbeActivity extends Activity {
    static final String TAG = "AwaiProbe";
    static final String NSD_TYPE = "_awai-pair._tcp";
    static final ParcelUuid BLE_UUID = new ParcelUuid(UUID.fromString("6a1f0b52-3e0a-4c43-9a8e-0d2a5c7a3056"));
    static final String[] PERMS = {
        "android.permission.ACCESS_LOCAL_NETWORK", Manifest.permission.NEARBY_WIFI_DEVICES,
        Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT};

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextView view;
    private NsdManager nsd;
    private NsdManager.RegistrationListener reg;
    private NsdManager.DiscoveryListener disc;
    private ServerSocket server;
    private WifiManager.MulticastLock lock;
    private AdvertiseCallback adv;
    private ScanCallback scan;
    private WifiP2pManager p2p;
    private WifiP2pManager.Channel channel;

    static void log(String op, String event, Object... kv) {
        StringBuilder b = new StringBuilder("op=").append(op).append(" event=").append(event);
        for (int i = 0; i + 1 < kv.length; i += 2) b.append(' ').append(kv[i]).append('=').append(kv[i + 1]);
        Log.i(TAG, b.toString());
    }

    static String token(int bytes) {
        byte[] r = new byte[bytes]; new SecureRandom().nextBytes(r);
        StringBuilder b = new StringBuilder(); for (byte x : r) b.append(String.format("%02x", x)); return b.toString();
    }

    @Override protected void onCreate(Bundle s) {
        super.onCreate(s);
        view = new TextView(this); view.setText("Awai nearby probe (AWAI-3058)"); view.setPadding(48, 48, 48, 48);
        setContentView(view);
        handle(getIntent());
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); handle(i); }

    private void handle(Intent i) {
        String op = i.getStringExtra("op"); if (op == null) op = "state";
        int secs = i.getIntExtra("secs", 20);
        boolean mlock = i.getBooleanExtra("mlock", false);
        view.setText("Awai nearby probe: " + op);
        try {
            switch (op) {
                case "state": state(); break;
                case "perms": requestPermissions(PERMS, 1); log(op, "requested"); break;
                case "nsd-adv": nsdAdvertise(mlock); break;
                case "nsd-browse": nsdBrowse(secs, mlock); break;
                case "ble-adv": bleAdvertise(); break;
                case "ble-scan": bleScan(secs); break;
                case "p2p": p2pDiscover(secs); break;
                case "stop": stopAll(); break;
                default: log(op, "unknown-op");
            }
        } catch (Throwable t) { log(op, "exception", "type", t.getClass().getSimpleName(), "msg", String.valueOf(t.getMessage()).replace(' ', '_')); }
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        for (int i = 0; i < perms.length; i++) log("perms", "result", "perm", perms[i], "granted", results[i] == PackageManager.PERMISSION_GRANTED);
    }

    private void state() {
        PackageManager pm = getPackageManager();
        for (String f : new String[]{PackageManager.FEATURE_BLUETOOTH, PackageManager.FEATURE_BLUETOOTH_LE, PackageManager.FEATURE_WIFI,
                PackageManager.FEATURE_WIFI_DIRECT, PackageManager.FEATURE_WIFI_AWARE, PackageManager.FEATURE_ETHERNET})
            log("state", "feature", "name", f, "present", pm.hasSystemFeature(f));
        for (String p : PERMS) log("state", "permission", "name", p, "granted", checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED);
        BluetoothAdapter a = getSystemService(BluetoothManager.class).getAdapter();
        if (a == null) { log("state", "bluetooth", "adapter", "none"); return; }
        log("state", "bluetooth", "enabled", a.isEnabled(), "leScanner", a.getBluetoothLeScanner() != null,
            "leAdvertiser", a.getBluetoothLeAdvertiser() != null, "multiAdv", a.isMultipleAdvertisementSupported(),
            "extAdv", a.isLeExtendedAdvertisingSupported());
    }

    private void multicast(boolean on) {
        if (!on) return;
        WifiManager w = getSystemService(WifiManager.class);
        if (w == null) { log("mlock", "no-wifi-manager"); return; }
        lock = w.createMulticastLock("awai-probe"); lock.setReferenceCounted(false); lock.acquire();
        log("mlock", "acquired");
    }

    private void nsdAdvertise(boolean mlock) throws Exception {
        multicast(mlock);
        nsd = getSystemService(NsdManager.class);
        server = new ServerSocket(0);
        final ServerSocket ss = server;
        Executors.newSingleThreadExecutor().execute(() -> {
            try { while (!ss.isClosed()) { Socket c = ss.accept(); log("nsd-adv", "tcp-accept", "from", c.getInetAddress().getHostAddress()); c.getOutputStream().write("awai-probe\n".getBytes()); c.close(); } }
            catch (Exception e) { log("nsd-adv", "tcp-closed"); }
        });
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName("Awai"); info.setServiceType(NSD_TYPE); info.setPort(server.getLocalPort());
        info.setAttribute("v", "1"); info.setAttribute("t", token(16));
        reg = new NsdManager.RegistrationListener() {
            public void onServiceRegistered(NsdServiceInfo i) { log("nsd-adv", "registered", "name", i.getServiceName(), "port", ss.getLocalPort()); }
            public void onRegistrationFailed(NsdServiceInfo i, int e) { log("nsd-adv", "register-failed", "code", e); }
            public void onServiceUnregistered(NsdServiceInfo i) { log("nsd-adv", "unregistered"); }
            public void onUnregistrationFailed(NsdServiceInfo i, int e) { log("nsd-adv", "unregister-failed", "code", e); }
        };
        nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, reg);
        log("nsd-adv", "requested", "port", server.getLocalPort());
    }

    private void nsdBrowse(int secs, boolean mlock) {
        multicast(mlock);
        nsd = getSystemService(NsdManager.class);
        disc = new NsdManager.DiscoveryListener() {
            public void onDiscoveryStarted(String t) { log("nsd-browse", "started", "type", t); }
            public void onDiscoveryStopped(String t) { log("nsd-browse", "stopped"); }
            public void onStartDiscoveryFailed(String t, int e) { log("nsd-browse", "start-failed", "code", e); }
            public void onStopDiscoveryFailed(String t, int e) { log("nsd-browse", "stop-failed", "code", e); }
            public void onServiceFound(NsdServiceInfo i) {
                log("nsd-browse", "found", "name", i.getServiceName().replace(' ', '_'), "type", i.getServiceType());
                nsd.registerServiceInfoCallback(i, Executors.newSingleThreadExecutor(), new NsdManager.ServiceInfoCallback() {
                    public void onServiceInfoCallbackRegistrationFailed(int e) { log("nsd-browse", "resolve-failed", "code", e); }
                    public void onServiceUpdated(NsdServiceInfo r) {
                        Map<String, String> txt = new HashMap<>();
                        for (Map.Entry<String, byte[]> e : r.getAttributes().entrySet()) txt.put(e.getKey(), e.getValue() == null ? "" : new String(e.getValue()));
                        log("nsd-browse", "resolved", "name", r.getServiceName().replace(' ', '_'), "hosts", r.getHostAddresses(), "port", r.getPort(), "txt", txt.toString().replace(' ', '_'));
                    }
                    public void onServiceLost() { log("nsd-browse", "info-lost"); }
                    public void onServiceInfoCallbackUnregistered() {}
                });
            }
            public void onServiceLost(NsdServiceInfo i) { log("nsd-browse", "lost", "name", i.getServiceName().replace(' ', '_')); }
        };
        nsd.discoverServices(NSD_TYPE, NsdManager.PROTOCOL_DNS_SD, disc);
        main.postDelayed(() -> { try { nsd.stopServiceDiscovery(disc); } catch (Exception e) { log("nsd-browse", "stop-exception"); } disc = null; }, secs * 1000L);
    }

    private void bleAdvertise() {
        BluetoothAdapter a = getSystemService(BluetoothManager.class).getAdapter();
        BluetoothLeAdvertiser l = a == null ? null : a.getBluetoothLeAdvertiser();
        if (l == null) { log("ble-adv", "unavailable", "adapter", a != null); return; }
        byte[] t = new byte[8]; new SecureRandom().nextBytes(t);
        // Legacy advertising has 31 bytes: flags (3) + 128-bit service data (2+16+9) = 30. A separate UUID list would not fit.
        AdvertiseData data = new AdvertiseData.Builder().addServiceData(BLE_UUID, new byte[]{1, t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7]}).setIncludeDeviceName(false).build();
        AdvertiseSettings set = new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setConnectable(true).setTimeout(0).build();
        adv = new AdvertiseCallback() {
            public void onStartSuccess(AdvertiseSettings s) { log("ble-adv", "started"); }
            public void onStartFailure(int e) { log("ble-adv", "start-failed", "code", e); }
        };
        l.startAdvertising(set, data, adv);
        log("ble-adv", "requested");
    }

    private void bleScan(int secs) {
        BluetoothAdapter a = getSystemService(BluetoothManager.class).getAdapter();
        final BluetoothLeScanner s = a == null ? null : a.getBluetoothLeScanner();
        if (s == null) { log("ble-scan", "unavailable", "adapter", a != null); return; }
        final int[] seen = {0};
        scan = new ScanCallback() {
            public void onScanResult(int type, ScanResult r) { seen[0]++; log("ble-scan", "result", "rssi", r.getRssi(), "data", r.getScanRecord() != null && r.getScanRecord().getServiceData(BLE_UUID) != null); }
            public void onScanFailed(int e) { log("ble-scan", "scan-failed", "code", e); }
        };
        List<ScanFilter> f = new ArrayList<>(); f.add(new ScanFilter.Builder().setServiceData(BLE_UUID, new byte[]{1}, new byte[]{(byte) 0xff}).build());
        s.startScan(f, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scan);
        log("ble-scan", "started", "secs", secs);
        main.postDelayed(() -> { try { s.stopScan(scan); } catch (Exception e) {} log("ble-scan", "done", "results", seen[0]); scan = null; }, secs * 1000L);
    }

    private void p2pDiscover(int secs) {
        p2p = getSystemService(WifiP2pManager.class);
        if (p2p == null) { log("p2p", "unavailable"); return; }
        channel = p2p.initialize(this, getMainLooper(), () -> log("p2p", "channel-lost"));
        Map<String, String> txt = new HashMap<>(); txt.put("v", "1"); txt.put("t", token(8));
        WifiP2pManager.ActionListener al = new WifiP2pManager.ActionListener() {
            public void onSuccess() {} public void onFailure(int r) { log("p2p", "action-failed", "reason", r); }
        };
        p2p.addLocalService(channel, WifiP2pDnsSdServiceInfo.newInstance("Awai", NSD_TYPE, txt), new WifiP2pManager.ActionListener() {
            public void onSuccess() { log("p2p", "local-service-added"); } public void onFailure(int r) { log("p2p", "local-service-failed", "reason", r); }
        });
        p2p.setDnsSdResponseListeners(channel,
            (name, type, dev) -> log("p2p", "service-found", "name", name, "type", type, "device", dev.deviceName.replace(' ', '_')),
            (domain, record, dev) -> log("p2p", "txt-found", "domain", domain, "txt", record.toString().replace(' ', '_')));
        p2p.addServiceRequest(channel, WifiP2pDnsSdServiceRequest.newInstance(NSD_TYPE), al);
        p2p.discoverServices(channel, new WifiP2pManager.ActionListener() {
            public void onSuccess() { log("p2p", "discover-started", "secs", secs); } public void onFailure(int r) { log("p2p", "discover-failed", "reason", r); }
        });
        main.postDelayed(() -> { p2p.clearServiceRequests(channel, al); p2p.clearLocalServices(channel, al); p2p.stopPeerDiscovery(channel, al); log("p2p", "done"); }, secs * 1000L);
    }

    private void stopAll() {
        try { if (reg != null) nsd.unregisterService(reg); } catch (Exception e) {}
        try { if (disc != null) nsd.stopServiceDiscovery(disc); } catch (Exception e) {}
        try { if (server != null) server.close(); } catch (Exception e) {}
        try { if (lock != null) lock.release(); } catch (Exception e) {}
        try { if (adv != null) getSystemService(BluetoothManager.class).getAdapter().getBluetoothLeAdvertiser().stopAdvertising(adv); } catch (Exception e) {}
        try { if (channel != null) { p2p.clearLocalServices(channel, null); p2p.clearServiceRequests(channel, null); } } catch (Exception e) {}
        reg = null; disc = null; server = null; lock = null; adv = null;
        log("stop", "done");
    }

    @Override protected void onDestroy() { stopAll(); super.onDestroy(); }
}
