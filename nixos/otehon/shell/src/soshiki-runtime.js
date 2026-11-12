// Observation only: never changes fleet grants, owner, schedules or admission.
export const RUNTIME_KEY = 'otehon.soshiki.runtime.v1';
const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export function validateObservation(value) {
  if(value?.schema !== 'awai.bot-fleet-observation.v1'
    ||value.scope !== 'host-prerequisites-only'||value.continuousMonitoring!==false
    || !/^[a-f0-9]{40}$/.test(value.registryRevision)||!hash(value.catalogSha256)
    ||!Number.isFinite(Date.parse(value.observedAt))
    ||!Array.isArray(value.nodes)||value.nodes.length>64||!Array.isArray(value.runs)||value.runs.length!==0
    ||new Set(value.nodes.map(n=>n.node)).size!==value.nodes.length) throw Error('unsupported-observation');
  for(const n of value.nodes) {
    if(!/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(n.node)||!['observed','unobserved'].includes(n.status))throw Error('bad-node');
    if(n.status==='observed'&&(!n.tools||!['bb','muse','itonami','itonami-agent'].every(k=>typeof n.tools[k]==='boolean')
      ||!Number.isSafeInteger(n.unattributedProcessCount)||n.unattributedProcessCount<0))throw Error('bad-node');
  }
  return value;
}
export function runtimeView(state, observation, now=Date.now(), circleId='all') {
  const fleet=state.bots.filter(b=>b.fleet);
  const selected=fleet.filter(b=>circleId==='all'||b.circleIds.includes(circleId));
  let valid=false;
  try { validateObservation(observation); valid=true; } catch {}
  const future=valid && Date.parse(observation.observedAt)>now;
  const same=valid && fleet.length>0 && fleet.every(b=>b.fleet.registryRevision===observation.registryRevision);
  const usable=valid && same && !future;
  return {registered:fleet.length,selected:selected.length,
    observedRunning:null,unknown:selected.length,completed:null,failed:null,
    observedAt:valid?observation.observedAt:null,
    ageSeconds:valid&&!future?Math.floor((now-Date.parse(observation.observedAt))/1000):null,
    status:!valid?'no-observation':future?'future-observation':!same?'catalog-mismatch':'prerequisites-only',
    nodes:usable?observation.nodes:[],
    bots:selected.map(b=>({id:b.id,name:b.name,state:'unobserved',
      project:b.fleet.linear?.project?.name??null,
      issue:b.fleet.linear?.issues?.find(i=>!['Done','Canceled','Cancelled','Duplicate'].includes(i.status))?.id??null,
      node:null,model:null,lastRun:null,persistence:null}))};
}
