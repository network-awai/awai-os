import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./main.css";

const POLL_MS = 3000;

// Both services listen on loopback only (desktop.nix). Nothing here leaves the VM.
async function zenohUp() {
  const response = await fetch("http://127.0.0.1:8000/@/*/router");
  if (!response.ok) return false;
  const body = await response.json();
  return Array.isArray(body) && body.length > 0;
}

function matterUp() {
  return new Promise((resolve) => {
    const socket = new WebSocket("ws://127.0.0.1:5580/ws");
    const finish = (up) => {
      socket.close();
      resolve(up);
    };
    socket.onmessage = (event) => {
      finish(typeof JSON.parse(event.data).sdk_version === "string");
    };
    socket.onerror = () => finish(false);
  });
}

function useService(check) {
  const [up, setUp] = useState(false);
  useEffect(() => {
    let live = true;
    const run = () =>
      check()
        .catch(() => false)
        .then((next) => live && setUp(next));
    run();
    const timer = setInterval(run, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [check]);
  return up;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Service({ name, role, up }) {
  return (
    <li className={up ? "service up" : "service down"}>
      <span className="name">{name}</span>
      <span className="role">{role}</span>
      <span className="state">{up ? "Running" : "Not reachable"}</span>
    </li>
  );
}

function Shell() {
  const now = useNow();
  const zenoh = useService(zenohUp);
  const matter = useService(matterUp);

  // The boot report reads this title, so the check proves that React rendered.
  useEffect(() => {
    document.title = `Awai Otehon zenoh=${zenoh ? 1 : 0} matter=${matter ? 1 : 0}`;
  }, [zenoh, matter]);

  return (
    <main>
      <header>
        <h1>Awai Otehon</h1>
        <time>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
      </header>
      <ul>
        <Service name="Zenoh" role="Data between nodes" up={zenoh} />
        <Service name="Matter" role="Home devices" up={matter} />
      </ul>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Shell />);
