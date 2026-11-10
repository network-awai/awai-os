// Runs inside the restricted Saifu frame. The host owns transport and consent.
export function installSaifuGuestBridge(win) {
  let port = null;
  let counter = 0;
  let closed = false;
  const pending = new Map();
  const selector = Object.freeze({ capability: "awai-wallet", service: "optimism-public-rpc", operation: "read-eth-balance" });

  function receive(event) {
    const data = event.data;
    if (!data || typeof data.id !== "string") return;
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    if (data.ok !== true || !Number.isInteger(data.status) || data.status < 200 || data.status >= 300 || typeof data.content !== "string") {
      item.reject(new Error("saifu-host-refused"));
      return;
    }
    try {
      const body = JSON.parse(data.content);
      if (!body || body.jsonrpc !== "2.0" || body.id !== 1 || typeof body.result !== "string"
          || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(body.result)) throw Error();
      item.resolve(body);
    } catch { item.reject(new Error("saifu-invalid-response")); }
  }

  function connect(event) {
    if (closed || port || event.source !== win.parent || event.data?.protocol !== "kotoba.client.host.v1"
        || event.ports?.length !== 1) return;
    port = event.ports[0];
    port.onmessage = receive;
    port.start();
  }

  function close() {
    closed = true;
    win.removeEventListener("message", connect);
    port?.close();
    for (const item of pending.values()) item.reject(new Error("saifu-host-closed"));
    pending.clear();
  }

  win.addEventListener("message", connect);
  win.addEventListener("pagehide", close, { once: true });
  win.saifuHost = Object.freeze({
    readChainState(request) {
      if (closed || !port) return Promise.reject(new Error("saifu-host-unavailable"));
      if (!request || request.jsonrpc !== "2.0" || request.id !== 1 || request.method !== "eth_getBalance"
          || !Array.isArray(request.params) || request.params.length !== 2 || request.params[1] !== "latest"
          || typeof request.params[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(request.params[0])) {
        return Promise.reject(new Error("saifu-operation-not-supported"));
      }
      const id = `saifu-${++counter}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { port.postMessage({ protocol: "kotoba.client.operation.v1", id, selector, payload: { address: request.params[0] } }); }
        catch (error) { pending.delete(id); reject(error); }
      });
    },
  });
  return Object.freeze({ close });
}
