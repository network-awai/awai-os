// Wi-Fi and Bluetooth screens of the Otehon shell (AWAI-168). They drive the
// loopback otehon-net service and show honest empty states when an adapter is
// absent, as in the check VM.
import { useState } from "react";
import {
  forgetWifi,
  joinWifi,
  macError,
  nameError,
  pairBluetooth,
  pskError,
  setBluetoothPower,
  ssidError,
  useBluetoothDevices,
  useNetStatus,
  useWifiKnown,
  useWifiNetworks,
} from "./net.js";

const ERROR_TEXT = {
  "bad-ssid": "The network name is empty or too long.",
  "bad-psk": "The key is 8 to 63 characters, or 64 hex digits.",
  "bad-name": "That saved connection cannot be named here.",
  "bad-mac": "That is not a device address like AA:BB:CC:DD:EE:FF.",
  "bad-json": "The request was not understood.",
  "no-adapter": "This device has no such adapter.",
  "no-network": "No network with that name answered.",
  "auth-failed": "The key was refused.",
  "join-failed": "Joining failed. Check the name and try again.",
  "unknown-connection": "That saved connection is already gone.",
  "power-failed": "The adapter did not switch.",
  "pair-failed": "Pairing failed. Keep the device close and discoverable.",
  "scan-failed": "Scanning failed. Try again.",
  unreachable: "The network service is not reachable.",
};

function problem(error) {
  return <p className="net-error">{ERROR_TEXT[error] ?? "Something went wrong."}</p>;
}

function Dot({ up }) {
  return <span className={up ? "net-dot net-up" : "net-dot net-down"} aria-hidden="true" />;
}

export function WifiPanel() {
  const status = useNetStatus();
  const wifi = status?.wifi;
  const networks = useWifiNetworks(Boolean(wifi?.available));
  const known = useWifiKnown(Boolean(wifi?.available));
  const [ssid, setSsid] = useState("");
  const [psk, setPsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const invalid = ssidError(ssid) ?? pskError(psk);

  const join = async (event) => {
    event.preventDefault();
    if (invalid || busy) return;
    setBusy(true);
    setResult(null);
    const done = await joinWifi(ssid.trim(), psk || undefined);
    setBusy(false);
    setResult(done);
  };

  const forget = async (name) => {
    if (nameError(name)) return;
    setResult(await forgetWifi(name));
  };

  return (
    <main className="chat net-view" data-net="wifi">
      <div className="net-body">
        <h1>Wi-Fi</h1>
        <p className="muted" data-net-link={status?.link ?? "unknown"}>
          <Dot up={status?.link === "up"} />{" "}
          {!status ? "Checking…" : status.error ? "Unknown" : status.link === "up" ? "Connected" : "Not connected"}
        </p>
        {!status ? <p className="muted">Checking…</p> : null}
        {status?.error ? problem(status.error) : null}
        {status && !status.error && !wifi?.available ? (
          <p className="muted">This device has no Wi-Fi adapter. Saved networks stay saved.</p>
        ) : null}
        {wifi?.available ? (
          <>
            <h2>Networks</h2>
            {networks?.error ? problem(networks.error) : null}
            {networks && !networks.error && networks.networks.length === 0 ? (
              <p className="muted">No networks found.</p>
            ) : null}
            <ul className="net-list">
              {(networks?.networks ?? []).map((item) => (
                <li key={item.ssid}>
                  <Dot up />
                  <span>{item.ssid}</span>
                  <span className="muted">{item.signal}%{item.security ? ` · ${item.security}` : ""}</span>
                  <button type="button" onClick={() => setSsid(item.ssid)}>
                    Join
                  </button>
                </li>
              ))}
            </ul>
            <h2>Join a network</h2>
            <form className="net-form" onSubmit={join}>
              <label>
                Network name
                <input aria-label="Network name" value={ssid} onChange={(event) => setSsid(event.target.value)} />
              </label>
              <label>
                Key, when the network needs one
                <input
                  aria-label="Network key"
                  type="password"
                  autoComplete="off"
                  value={psk}
                  onChange={(event) => setPsk(event.target.value)}
                />
              </label>
              <button type="submit" className="primary" disabled={invalid !== null || busy}>
                {busy ? "Joining…" : "Join"}
              </button>
            </form>
            {result && !result.ok ? problem(result.error) : null}
            {result?.ok ? <p data-net-joined={result.connected}>Joined {result.connected}.</p> : null}
            <h2>Saved networks</h2>
            {known?.error ? problem(known.error) : null}
            {(known?.known ?? []).length === 0 && !known?.error ? <p className="muted">None saved.</p> : null}
            <ul className="net-list">
              {(known?.known ?? []).map((item) => (
                <li key={item.name}>
                  <span>{item.name}</span>
                  <button type="button" onClick={() => forget(item.name)}>
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </main>
  );
}

export function BluetoothPanel() {
  const status = useNetStatus();
  const bluetooth = status?.bluetooth;
  const devices = useBluetoothDevices(Boolean(bluetooth?.available));
  const [mac, setMac] = useState("");
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);

  const power = async (on) => {
    setBusy("power");
    setResult(null);
    const done = await setBluetoothPower(on);
    setBusy(null);
    setResult(done.ok ? null : done);
  };

  const pair = async (address) => {
    if (macError(address) || busy) return;
    setBusy(address);
    setResult(null);
    const done = await pairBluetooth(address);
    setBusy(null);
    setResult(done.ok ? { ok: true, paired: done.paired } : done);
  };

  return (
    <main className="chat net-view" data-net="bluetooth">
      <div className="net-body">
        <h1>Bluetooth</h1>
        {!status ? <p className="muted">Checking…</p> : null}
        {status?.error ? problem(status.error) : null}
        {status && !status.error && !bluetooth?.available ? (
          <p className="muted">This device has no Bluetooth adapter.</p>
        ) : null}
        {bluetooth?.available ? (
          <>
            <p>
              <Dot up={bluetooth.powered} /> {bluetooth.powered ? "On" : "Off"}{" "}
              <button type="button" onClick={() => power(!bluetooth.powered)} disabled={busy === "power"}>
                Turn {bluetooth.powered ? "off" : "on"}
              </button>
            </p>
            {bluetooth.powered ? (
              <>
                <h2>Devices</h2>
                {devices?.error ? problem(devices.error) : null}
                {(devices?.devices ?? []).length === 0 && !devices?.error ? (
                  <p className="muted">Nothing nearby. Keep the device discoverable.</p>
                ) : null}
                <ul className="net-list">
                  {(devices?.devices ?? []).map((item) => (
                    <li key={item.mac}>
                      <Dot up={item.connected} />
                      <span>{item.name}</span>
                      <span className="muted">
                        {item.mac}
                        {item.paired ? " · paired" : ""}
                      </span>
                      {!item.paired ? (
                        <button type="button" disabled={busy === item.mac} onClick={() => pair(item.mac)}>
                          {busy === item.mac ? "Pairing…" : "Pair"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <h2>Pair by address</h2>
                <form
                  className="net-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    pair(mac.trim());
                  }}
                >
                  <label>
                    Device address
                    <input aria-label="Device address" value={mac} onChange={(event) => setMac(event.target.value)} />
                  </label>
                  <button type="submit" className="primary" disabled={macError(mac) !== null || busy !== null}>
                    Pair
                  </button>
                </form>
              </>
            ) : null}
            {result && !result.ok ? problem(result.error) : null}
            {result?.ok ? <p data-net-paired={result.paired}>Paired {result.paired}.</p> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
