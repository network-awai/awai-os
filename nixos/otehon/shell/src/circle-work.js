export async function decodeCircleWork(e,cryptoImpl=globalThis.crypto){
 if(e?.['schema']!=='itonami.circle-work-artifact.v1'||e['payload']?.['schema']!=='itonami.circle-work.v1'||!Array.isArray(e['payload']['circles'])||!Array.isArray(e['payload']['executions']))throw Error('invalid-circle-work');
 const hash=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(e['payload'])))),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==e['sha256'])throw Error('invalid-circle-work-hash');return e['payload'];
}
export function circleExecution(progress,botId,catalogSha,now=Date.now()){
 const fresh=at=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now&&now-Date.parse(at)<=45000;
 if(progress?.['catalogSha256']!==catalogSha||!fresh(progress?.['observedAt']))return null;
 return progress['executions'].find(e=>e['botId']===botId&&e['source']==='muse-process-heartbeat'&&e['phase']==='responding'&&e['invocationId']&&e['node']&&fresh(e['heartbeatAt'])&&Number.isFinite(Date.parse(e['startedAt']))&&Date.parse(e['startedAt'])<=Date.parse(e['heartbeatAt'])&&now-Date.parse(e['startedAt'])<=300000)??null;
}
