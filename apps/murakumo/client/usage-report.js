// Verifies a signed node usage report (awai.murakumo.device-usage-report.v1, AWAI-3377) against the
// owner-pinned key. The signature covers "<schema>\n<payload>" exactly as received; the payload is parsed
// only after it verifies. An unverifiable report is never shown as the device's state.
export const REPORT_SCHEMA='awai.murakumo.device-usage-report.v1';
export const MAX_REPORT_BYTES=16384;
import {verifyEd25519} from './ed25519.js';
/** WebCrypto Ed25519 where the WebView has it (Chrome 137+), else the RFC 8032 BigInt check. */
export async function verifySignature(key,sig,message,{webCrypto=true}={}){
 if(webCrypto){let publicKey=null;try{publicKey=await crypto.subtle.importKey('raw',key,{name:'Ed25519'},false,['verify']);}catch{}
  if(publicKey)return crypto.subtle.verify({name:'Ed25519'},publicKey,sig,message);}
 return verifyEd25519(key,sig,message);}
const bytes=s=>{if(typeof s!=='string'||!/^[A-Za-z0-9_-]*$/.test(s))return null;const b=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));return Uint8Array.from(b,c=>c.charCodeAt(0));};
export async function verifyReport(report,device){
 if(!report||typeof report!=='object'||Array.isArray(report))return {ok:false,reason:'shape'};
 const extra=Object.keys(report).filter(k=>!['schema','payload','key','signature'].includes(k));if(extra.length)return {ok:false,reason:'shape'};
 if(report.schema!==REPORT_SCHEMA)return {ok:false,reason:'schema'};
 if(report.key!==device.key)return {ok:false,reason:'key-not-pinned'};
 if(typeof report.payload!=='string'||report.payload.length>MAX_REPORT_BYTES)return {ok:false,reason:'payload'};
 const key=bytes(device.key),sig=bytes(report.signature);if(key?.length!==32||sig?.length!==64)return {ok:false,reason:'encoding'};
 const message=new TextEncoder().encode(`${REPORT_SCHEMA}\n${report.payload}`);
 if(!await verifySignature(key,sig,message))return {ok:false,reason:'signature'};
 let usage;try{usage=JSON.parse(report.payload);}catch{return {ok:false,reason:'payload'};}
 if(!usage||typeof usage!=='object'||usage.device!==device.id||usage.kind!==device.kind)return {ok:false,reason:'device'};
 return {ok:true,usage};}
/** Reads at most MAX_REPORT_BYTES of a response body as JSON. */
export async function readReport(response){
 if(!response.ok)throw Error(`report-http-${response.status}`);
 const reader=response.body.getReader();const parts=[];let n=0;
 for(;;){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>MAX_REPORT_BYTES){await reader.cancel();throw Error('report-too-large');}parts.push(value);}
 const all=new Uint8Array(n);let o=0;for(const p of parts){all.set(p,o);o+=p.byteLength;}
 return JSON.parse(new TextDecoder().decode(all));}
