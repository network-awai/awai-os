import assert from "node:assert/strict";
import { test } from "node:test";
import { OS_PORTS, formatKiB, memUsedPercent, portRows, summarizeSystem } from "../src/status.js";

test("OS ports are the shell's own loopback inventory", () => {
  const kinds = new Set(["http", "service", "internal"]);
  const ports = OS_PORTS.map((entry) => entry.port);
  assert.equal(new Set(ports).size, ports.length, "ports must be unique");
  for (const entry of OS_PORTS) {
    assert.ok(Number.isInteger(entry.port) && entry.port > 0, "port must be a number");
    assert.ok(typeof entry.service === "string" && entry.service.length > 0, "service must be named");
    assert.ok(kinds.has(entry.kind), `unknown kind ${entry.kind}`);
    if (entry.kind === "service") assert.ok(entry.from === "zenoh" || entry.from === "matter", "service rows follow a shell check");
  }
});

test("port rows merge probes with service checks", () => {
  const rows = portRows({ 8770: true, 8771: false, 8774: true, 8000: true }, { zenoh: true, matter: false });
  const byPort = Object.fromEntries(rows.map((row) => [row.port, row.state]));
  assert.equal(byPort[8770], "up");
  assert.equal(byPort[8771], "down");
  assert.equal(byPort[8774], "up");
  assert.equal(byPort[8000], "up");
  assert.equal(byPort[7447], "up");
  assert.equal(byPort[5580], "down");
  assert.equal(byPort[9222], "internal");
});

test("memory formatting stays readable", () => {
  assert.equal(formatKiB(512), "512 KiB");
  assert.equal(formatKiB(2048), "2.0 MiB");
  assert.equal(formatKiB(8 * 1024 * 1024), "8.0 GiB");
  assert.equal(formatKiB(Number.NaN), "—");
});

test("system summary needs both CPU and memory", () => {
  const full = summarizeSystem({ cpu_percent: 12.34, mem_total_kb: 8 * 1024 * 1024, mem_available_kb: 6 * 1024 * 1024 });
  assert.equal(full.cpu, "12.3%");
  assert.equal(full.mem, "25% of 8.0 GiB");
  assert.equal(summarizeSystem(null), null);
  assert.equal(summarizeSystem({ cpu_percent: 1.0 }), null);
  assert.equal(memUsedPercent({ mem_total_kb: 100, mem_available_kb: 40 }), 60);
});
