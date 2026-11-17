import './core.js';
import{createClientConsentHost,createClientOperationBroker}from'./runtime.js';
import{runtimeFor,PACK_LIMIT}from'./sync-contract.js';import{syncOrigin}from'./sync-config.js';
const core=window.AwaiDriveEncrypted;
const b64=b=>{let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s);};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const invoke=(op,extra={})=>window.__TAURI__.core.invoke('drive_call',{request:{op,...extra}});
const runtime=runtimeFor(syncOrigin),selectors=runtime.operations.map(o=>[o.capability,o.service,o.operation]);
const broker=createClientOperationBroker({runtime,requestedCapabilities:['awai.drive.sync'],approvedOperations:runtime.operations,hostSupportedOperations:selectors,consentHost:createClientConsentHost()});
async function session(initialize=false){let s=await invoke('vaultSession',{initialize});if(!s.initialized)throw Error('recovery-required');const secret=unb64(s.secret);if(!s.record){const record=await core.newRecord(secret);await invoke('vaultRecord',{record});s={...s,record};}return {...s,secret};}
async function request(operation,id,bytes){if(!syncOrigin)throw Error('sync-not-configured');if(!/^[a-f0-9]{64}$/.test(id))throw Error('invalid-root');const method=operation==='upload'?'PUT':'GET';const response=await broker.invoke({capability:'awai.drive.sync',service:'awai.fs',operation},{input:syncOrigin+'/awai-drive/v1/packs/'+id,init:{method,...(bytes?{headers:{'Content-Type':'application/vnd.ipld.car'},body:bytes}:{})}});if(!response.ok)throw Error('sync-unavailable');return response;}
async function readResponse(response){const chunks=[];let size=0;const reader=response.body.getReader();try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>PACK_LIMIT)throw Error('pack-limit');chunks.push(value);}}finally{await reader.cancel();}const out=new Uint8Array(size);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;}
export const configured=Boolean(syncOrigin);
export async function sync(){const s=await session(true);try{
 const {entries}=await invoke('vaultInventory');const rows=[];
 for(const e of entries){if(e.directory)continue;const bytes=new Uint8Array(e.size);for(let at=0;at<e.size;at+=65531){const r=await invoke('vaultRead',{path:e.path,offset:at,length:Math.min(65531,e.size-at)});bytes.set(unb64(r.bytes),at);}if(await core.sha256(bytes)!==e.sha256)throw Error('source-size-changed');rows.push({path:e.path,bytes});}
 rows.directories=entries.filter(e=>e.directory).map(e=>e.path);const sealed=await core.sealSnapshot(s.record,s.secret,rows);const id=await core.sha256(sealed.bytes);const response=await request('upload',id,sealed.bytes);const receipt=await response.json();if(receipt.sha256!==id||receipt.bytes!==sealed.bytes.length)throw Error('receipt-mismatch');
 const verified=await readResponse(await request('download',id));if(verified.length!==sealed.bytes.length||await core.sha256(verified)!==id)throw Error('receipt-mismatch');
 await invoke('vaultCommit',{root:sealed.root,pack:id,entries});return {files:rows.length,root:sealed.root,pack:id};
 }finally{s.secret.fill(0);}}
export async function evict(){return invoke('vaultEvict');}
export async function restore(){const s=await session();try{if(!s.root||!s.pack)throw Error('recovery-required');const response=await request('download',s.pack);const bytes=await readResponse(response);if(await core.sha256(bytes)!==s.pack)throw Error('receipt-mismatch');const rows=await core.openSnapshot(s.record,s.secret,s.root,bytes);
 // Authenticate and validate all plaintext before staging or publishing output.
 await invoke('vaultRestoreBegin');for(const r of rows){if(r.bytes.length===0)await invoke('vaultRestoreWrite',{path:r.path,offset:0,bytes:''});for(let at=0;at<r.bytes.length;at+=65531)await invoke('vaultRestoreWrite',{path:r.path,offset:at,bytes:b64(r.bytes.subarray(at,at+65531))});r.bytes.fill(0);}await invoke('vaultRestorePublish');return {files:rows.length};
 }finally{s.secret.fill(0);}}
export async function state(){return {...await invoke('vaultStatus'),configured};}
