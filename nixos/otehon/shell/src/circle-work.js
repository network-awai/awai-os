export async function decodeCircleWork(e,cryptoImpl=globalThis.crypto){
 if(e?.['schema']!=='itonami.circle-work-artifact.v1'||e['payload']?.['schema']!=='itonami.circle-work.v1'||!Array.isArray(e['payload']['circles'])||!Array.isArray(e['payload']['executions']))throw Error('invalid-circle-work');
 const hash=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(e['payload'])))),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==e['sha256'])throw Error('invalid-circle-work-hash');return e['payload'];
}
export function circleExecution(progress,botId,catalogSha,now=Date.now()){
 const fresh=at=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now&&now-Date.parse(at)<=45000;
 if(progress?.['catalogSha256']!==catalogSha||!fresh(progress?.['observedAt']))return null;
 return progress['executions'].find(e=>e['botId']===botId&&e['source']==='muse-process-heartbeat'&&e['phase']==='responding'&&e['invocationId']&&e['node']&&fresh(e['heartbeatAt'])&&Number.isFinite(Date.parse(e['startedAt']))&&Date.parse(e['startedAt'])<=Date.parse(e['heartbeatAt'])&&now-Date.parse(e['startedAt'])<=300000)??null;
}
export function goalEdges(progress,nodes,catalogSha,now=Date.now()){
 if(progress?.['catalogSha256']!==catalogSha)return [];
 const known=new Set(nodes.map(n=>n['id'])),edges=[];
 for(const c of progress['circles']??[]){const receipts=c['contributions']??[];for(const r of receipts){if(r['state']!=='completed'||!r['storeReadback']||!r['linearConfirmed']||!known.has(r['botId']))continue;for(const p of r['peerInputs']??[]){const prior=receipts.find(x=>x['botId']===p['botId']&&x['artifactCid']===p['cid']&&x['storeReadback']&&x['linearConfirmed']);if(!prior||p['botId']===r['botId']||!known.has(p['botId']))continue;edges.push({'id':r['runId']+':'+p['botId'],'from':p['botId'],'to':r['botId'],'live':false});}}
 for(const e of progress['executions']??[]){if(e['circleId']!==c['id']||!circleExecution(progress,e['botId'],catalogSha,now)||!known.has(e['botId']))continue;for(const p of e['peerInputs']??[]){if(receipts.some(r=>r['botId']===p['botId']&&r['artifactCid']===p['cid']&&r['storeReadback']&&r['linearConfirmed'])&&known.has(p['botId'])&&p['botId']!==e['botId'])edges.push({'id':e['runId']+':'+p['botId'],'from':p['botId'],'to':e['botId'],'live':true});}}
 }return edges;
}
