import { useEffect, useState } from "react";
import { AGENT_ORIGIN, MODEL_ORIGIN, agentKey, hasAgent } from "./agent.js";

const POLL_MS = 5000;

// The agent counts as connected only when it accepts the key and its model is up. Hermes alone
// would accept a message and then fail.
export function useAgentConnected() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let live = true;
    const read = async () => {
      let up = false;
      if (hasAgent()) {
        try {
          const [agent, model] = await Promise.all([
            fetch(`${AGENT_ORIGIN}/v1/models`, { headers: { authorization: `Bearer ${agentKey()}` } }),
            fetch(`${MODEL_ORIGIN}/health`),
          ]);
          up = agent.ok && model.ok;
        } catch {
          up = false;
        }
      }
      if (live) setConnected(up);
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return connected;
}
