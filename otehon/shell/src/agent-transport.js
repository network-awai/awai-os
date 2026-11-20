// Native network adapter readiness only. No credentials, service approvals or broker replacement.
export async function ensureAgentTransport(invoke=globalThis.__TAURI_INTERNALS__?.invoke){
 if(typeof invoke!=='function')return;
 const state=await invoke('awai_agent_transport');
 if(state?.schema!=='awai.agent-transport-status.v1'||state.ready!==true||!['direct','managed-wired-tailnet'].includes(state.mode)||(state.mode==='managed-wired-tailnet'&&state.origin!=='https://21mbp.tail110d8b.ts.net:8443'))throw Error('agent-transport-unavailable');
}
