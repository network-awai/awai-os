/** Awai Shell host v1. Local storage is app-scoped; no remote or OS command authority. */
export const API = 'awai.shell.host.v1';
const limit = 131072;
export class HostError extends Error { constructor(code){super(code);this.code=code;} }
const fail = code => { throw new HostError(code); };
function bounded(value){let raw;try{raw=JSON.stringify(value);}catch{fail('invalid-data');}if(typeof raw!=='string'||new TextEncoder().encode(raw).length>limit)fail('data-too-large');return raw;}
function envelope(raw){let v;try{v=JSON.parse(raw);}catch{fail('unreadable-state');}if(v?.schema!==API||!Number.isSafeInteger(v.revision)||v.revision<1||!Object.hasOwn(v,'data'))fail('unreadable-state');bounded(v);return v;}
export function createHost({appId,storage=globalThis.localStorage,locks=globalThis.navigator?.locks,native=globalThis.__TAURI__?.core}={}){
  if(!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(appId||''))fail('invalid-app-id');
  const key=API+':'+appId, lock='awai-state:'+appId;let agendaProjection=false,peerSnapshots=false;
  async function read(){let raw;try{raw=storage.getItem(key);}catch{fail('storage-unavailable');}return raw===null?{schema:API,revision:0,data:null}:envelope(raw);}
  return Object.freeze({
    info:()=>Object.freeze({schema:API,appId,runtime:native?'tauri-v3':'web',capabilities:Object.freeze({localState:true,atomicWrite:!!locks?.request,agendaProjection,peerSnapshots,notifications:false,sync:false,install:false})}),
    read,
    async initialize(){if(native){const info=await native.invoke('awai_host_info');if(info?.schema!==API)fail('host-version-mismatch');agendaProjection=info.agendaProjection===true;peerSnapshots=info.peerHost==='awai.shell.peer.v1';}} ,
    async write({expectedRevision,data}){
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('invalid-revision');
      bounded(data);if(!locks?.request)fail('atomic-write-unavailable');
      return locks.request(lock,async()=>{
        const current=await read();if(current.revision!==expectedRevision)fail('state-conflict');
        if(expectedRevision>=Number.MAX_SAFE_INTEGER)fail('revision-exhausted');
        const next={schema:API,revision:expectedRevision+1,data};const raw=bounded(next);
        try{storage.setItem(key,raw);}catch{fail('storage-unavailable');}return next;
      });
    },
    async legacyAgenda(){if(!native)return null;return native.invoke('awai_legacy_agenda');},
    async projectAgenda(events){if(!native)return;bounded(events);return native.invoke('awai_project_agenda',{events});},
    async perform(){fail('unsupported-operation');}
  });
}
