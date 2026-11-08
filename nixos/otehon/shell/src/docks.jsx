// Bottom docks of the Otehon shell (AWAI-231): the device dock on the left
// and the node dock on the right. They only display what this device knows
// from its own loopback services: the wallet, the trust score, the services
// it provides, Manimani activity, connected agents, live CPU and memory, and
// the reachability of the OS's own ports. Nothing is scanned and nothing
// leaves the machine.
import { useState } from "react";
import { STATUS_TEXT, useManimani } from "./manimani.jsx";
import { POINTS } from "./trust.js";
import {
  formatKiB,
  memUsedPercent,
  portRows,
  summarizeSystem,
  useHttpPorts,
  useSystem,
  useZenohRouters,
} from "./status.js";

const shortDid = (did) => (did.length > 26 ? `${did.slice(0, 14)}…${did.slice(-8)}` : did);

function manimaniStatus(state) {
  if (!state) return "stopped";
  return state.paused ? "paused" : state.status;
}

function DockButton({ active, label, value, toggle, panel }) {
  return (
    <button
      type="button"
      className={active ? "dock-button active" : "dock-button"}
      aria-expanded={active}
      data-dock-toggle={panel}
      onClick={toggle}
    >
      <span className="dock-label">{label}</span>
      {value ? <span className="dock-value">{value}</span> : null}
    </button>
  );
}

function Dock({ side, children }) {
  return (
    <div className={`dock-cluster dock-${side}`} data-dock={side}>
      {children}
    </div>
  );
}

function Panel({ name, title, onClose, children }) {
  return (
    <section className="dock-panel" aria-label={title} data-dock-panel={name}>
      <div className="dock-panel-head">
        <h2>{title}</h2>
        <button type="button" className="dock-close" aria-label="Close panel" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </section>
  );
}

function StateDot({ state }) {
  return <span className={`dot dot-${state}`} data-state={state} aria-hidden="true" />;
}

// Left: this device. Wallet and trust first, then what the device provides,
// then what its resident bot has been doing.
export function DeviceDock({ account, score, proofs, capabilities, zenoh, matter, onAccount }) {
  const [open, setOpen] = useState(null);
  const [manimani] = useManimani();
  const toggle = (name) => setOpen((current) => (current === name ? null : name));
  const services = [
    { name: "Speech", up: capabilities.speech.length > 0 },
    { name: "Images", up: capabilities.image },
    { name: "Manimani", up: manimaniStatus(manimani) === "ready" },
    { name: "Zenoh", up: zenoh },
    { name: "Matter", up: matter },
  ];
  const provided = services.filter((service) => service.up).length;
  const activity = [...(manimani?.activity ?? [])].slice(-5).reverse();
  const address = /^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$/.exec(account.accountDid ?? "")?.[1] ?? null;

  return (
    <Dock side="left">
      {open === "wallet" ? (
        <Panel name="wallet" title="Wallet" onClose={() => setOpen(null)}>
          <p className="account-id" data-dock-wallet={account.accountDid}>
            {shortDid(account.accountDid)}
          </p>
          <dl className="dock-facts">
            <dt>Method</dt>
            <dd>{account.method === "wallet" ? "Web3 wallet" : "Passkey"}</dd>
            {address ? (
              <>
                <dt>Address</dt>
                <dd className="account-id">{address}</dd>
              </>
            ) : null}
            <dt>Link expires</dt>
            <dd>{new Date(account.expiresAt).toLocaleDateString()}</dd>
            <dt>Trust score</dt>
            <dd data-dock-trust={score}>
              {score} (sign-in +{POINTS.login}
              {proofs.passport?.account === account.accountDid ? `, passport +${POINTS.passport}` : ""}
              {proofs.worldId?.account === account.accountDid ? `, World ID +${POINTS.worldId}` : ""})
            </dd>
          </dl>
          <p className="muted">Balances need a chain read, which this image does not do.</p>
          <button type="button" className="secondary" onClick={onAccount}>
            Open Account
          </button>
        </Panel>
      ) : null}
      {open === "providing" ? (
        <Panel name="providing" title="Providing on this device" onClose={() => setOpen(null)}>
          <ul className="dock-list">
            {services.map((service) => (
              <li key={service.name}>
                <StateDot state={service.up ? "up" : "down"} />
                <span>{service.name}</span>
                <span className="muted">{service.up ? "Running" : "Not reachable"}</span>
              </li>
            ))}
          </ul>
          <p className="muted">Every service above listens on loopback only.</p>
        </Panel>
      ) : null}
      {open === "activity" ? (
        <Panel name="activity" title="Activity" onClose={() => setOpen(null)}>
          {activity.length === 0 ? <p className="muted">{STATUS_TEXT[manimaniStatus(manimani)]}</p> : null}
          <ul className="dock-list">
            {activity.map((item) => (
              <li key={`${item.at}-${item.kind}`}>
                <span className="muted">{new Date(item.at).toLocaleTimeString()}</span>
                <span>
                  {item.kind}
                  {item.detail ? `: ${item.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <div className="dock-buttons" data-dock-left>
        <DockButton active={open === "wallet"} label="Wallet" value={`Trust ${score}`} toggle={() => toggle("wallet")} panel="wallet" />
        <DockButton
          active={open === "providing"}
          label="Providing"
          value={`${provided}/${services.length}`}
          toggle={() => toggle("providing")}
          panel="providing"
        />
        <DockButton
          active={open === "activity"}
          label="Activity"
          value={manimani?.activity?.length ? String(manimani.activity.length) : null}
          toggle={() => toggle("activity")}
          panel="activity"
        />
      </div>
    </Dock>
  );
}

// Right: this node. Connected hosts first, then live resources, then the
// reachability of the OS's own ports.
export function NodeDock({ did, zenoh, matter }) {
  const [open, setOpen] = useState(null);
  const [manimani] = useManimani();
  const system = useSystem();
  const ports = useHttpPorts();
  const routers = useZenohRouters(zenoh);
  const toggle = (name) => setOpen((current) => (current === name ? null : name));
  const agents = manimani?.agents ?? [];
  const rows = portRows(ports, { zenoh, matter });
  const summary = summarizeSystem(system);
  const mem = system ? memUsedPercent(system) : null;

  return (
    <Dock side="right">
      {open === "hosts" ? (
        <Panel name="hosts" title="Connected hosts" onClose={() => setOpen(null)}>
          <ul className="dock-list">
            <li>
              <StateDot state="up" />
              <span>This device</span>
              <span className="muted" data-dock-device={did}>
                {shortDid(did)}
              </span>
            </li>
            {agents.map((agent) => (
              <li key={agent.id}>
                <StateDot state="up" />
                <span>{agent.name}</span>
                <span className="muted">{agent.approval === "auto" ? "Runs on its own" : "Asks first"}</span>
              </li>
            ))}
          </ul>
          {agents.length === 0 ? <p className="muted">No agents connected yet.</p> : null}
          <p className="muted">Zenoh routers seen: {routers ?? (zenoh ? "…" : "0")}</p>
        </Panel>
      ) : null}
      {open === "resources" ? (
        <Panel name="resources" title="Resources" onClose={() => setOpen(null)}>
          {summary ? (
            <dl className="dock-facts">
              <dt>CPU</dt>
              <dd data-dock-cpu={system.cpu_percent}>{summary.cpu}</dd>
              <dt>Memory</dt>
              <dd data-dock-mem={mem}>{summary.mem}</dd>
            </dl>
          ) : (
            <p className="muted">Usage is unavailable: the status service is not reachable.</p>
          )}
          <div className="meter" aria-hidden="true">
            <span style={{ width: `${mem ?? 0}%` }} />
          </div>
          <p className="muted">
            {system ? `${formatKiB(system.mem_available_kb)} available` : "Resident services stay on loopback."}
          </p>
        </Panel>
      ) : null}
      {open === "ports" ? (
        <Panel name="ports" title="Ports" onClose={() => setOpen(null)}>
          <ul className="dock-list">
            {rows.map((row) => (
              <li key={row.port} data-dock-port={row.port} data-port-state={row.state}>
                <StateDot state={row.state} />
                <span>{row.port}</span>
                <span>{row.service}</span>
                <span className="muted">
                  {row.state === "internal" ? "Internal" : row.state === "up" ? "Open on loopback" : "Not reachable"}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">The OS's own inventory. Nothing is scanned.</p>
        </Panel>
      ) : null}
      <div className="dock-buttons" data-dock-right>
        <DockButton
          active={open === "hosts"}
          label="Hosts"
          value={String(1 + agents.length)}
          toggle={() => toggle("hosts")}
          panel="hosts"
        />
        <DockButton
          active={open === "resources"}
          label="Resources"
          value={summary ? summary.cpu : null}
          toggle={() => toggle("resources")}
          panel="resources"
        />
        <DockButton active={open === "ports"} label="Ports" toggle={() => toggle("ports")} panel="ports" />
      </div>
    </Dock>
  );
}
