// Owner-pinned devices and their usage reads as canonical client-runtime operations (AWAI-3377).
// Each pinned device answers one fixed GET over an authenticated tailnet HTTPS route; every read needs
// fresh consent. Nothing is sent but the request itself, and no read starts inference anywhere.
import {runtimeFor,DOWNLOAD_CAPABILITY} from './download-contract.js';
export const USAGE_CAPABILITY='awai.murakumo.device-usage';
export const USAGE_OPERATION='read-usage';
export const USAGE_PATH='/v1/murakumo/usage';
export const usageService=id=>`awai-node-${id}`;
const ID=/^[a-z0-9][a-z0-9-]{0,31}$/,KEY=/^[A-Za-z0-9_-]{43}$/;
/** Problems with devices.json: [{id, kind, origin, key}] — key is the raw Ed25519 public key, base64url. */
export function devicesProblems(devices){
 const problems=[];if(!Array.isArray(devices))return ['devices/not-a-list'];const seen=new Set();
 for(const [i,d] of devices.entries()){const at=`devices/${i}`;
  if(!d||typeof d!=='object'||Array.isArray(d)){problems.push(`${at}/shape`);continue;}
  if(!ID.test(d.id??''))problems.push(`${at}/id`);else if(seen.has(d.id))problems.push(`${at}/duplicate`);else seen.add(d.id);
  if(!['mac','android'].includes(d.kind))problems.push(`${at}/kind`);
  if(typeof d.origin!=='string'||!/^https:\/\//.test(d.origin))problems.push(`${at}/origin`);
  if(!KEY.test(d.key??''))problems.push(`${at}/key`);
  const extra=Object.keys(d).filter(k=>!['id','kind','origin','key','label'].includes(k));if(extra.length)problems.push(`${at}/unknown-field`);}
 return problems;}
/* AWAI-3842: the finding-9 disclosure for a usage read. The recipient is the owner's own pinned
   device on the tailnet (JP); only the usage request is sent, and the report is verified against
   the pinned key before it is shown (see usage-report.js). */
export const usageDisclosure=d=>({recipient:`pinned device ${d.id}`,country:'JP',
 data:['device usage read request'],'special-care':false,
 purpose:"read the pinned device's inference usage report",frequency:'one-time',
 withdrawal:'decline the prompt; a read stores nothing',
 note:'Only the usage request is sent. The report is verified against the pinned key before it is shown.'});
export const usageOperations=devices=>devices.map(d=>({capability:USAGE_CAPABILITY,service:usageService(d.id),operation:USAGE_OPERATION,consent:'each-operation',
 'data-categories':['device-usage-report'],endpoint:{origin:d.origin,method:'GET',path:USAGE_PATH},disclosure:usageDisclosure(d)}));
/** The app's whole descriptor: catalog downloads plus pinned-device usage reads. */
export function appRuntime(catalog,devices){const r=runtimeFor(catalog);return {...r,operations:[...r.operations,...usageOperations(devices)]};}
export const appCapabilities=devices=>devices.length?[DOWNLOAD_CAPABILITY,USAGE_CAPABILITY]:[DOWNLOAD_CAPABILITY];
