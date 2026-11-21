import { clientRuntimeProblems, createClientConsentHost, createClientOperationBroker, clientRuntimeConnectSrc } from './runtime.js';
import { verifyKeyList, authentic, base64Bytes, CATALOG } from './key-list.js';

// Pins: one catalog envelope plus one APK pin per app id. Each pin is an exact immutable URL under
// this repository's pinned revision; per-app byte budgets are enforced again by the host Catalog.
const APP_ID=/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,5}$/;
function validPin(entry,revision,ceiling){
  const u=new URL(entry.url);
  if(u.origin!=='https://raw.githubusercontent.com'||u.search||u.hash||u.username||u.password||!u.pathname.startsWith(`/network-awai/awai-os/${revision}/store/distribution/`)||!entry.sha256?.match(/^[0-9a-f]{64}$/)||!Number.isSafeInteger(entry.maxBytes)||entry.maxBytes<1||entry.maxBytes>ceiling)throw Error('配信先の固定情報を確認できません。');
}
export function validatePins(pins) {
  if (!pins || !/^[0-9a-f]{40}$/.test(pins.revision) || !pins.catalog || !pins.apks || typeof pins.apks!=='object' || Array.isArray(pins.apks)) throw Error('配信情報が未設定です。');
  const ids=Object.keys(pins.apks);
  if(ids.length<1||ids.length>16||!ids.every(id=>APP_ID.test(id)))throw Error('配信先の固定情報を確認できません。');
  validPin(pins.catalog,pins.revision,131072);
  for(const id of ids)validPin(pins.apks[id],pins.revision,64*1024*1024);
  return pins;
}
const pinFor=(pins,kind)=>kind==='catalog'?pins.catalog:Object.hasOwn(pins.apks,kind)?pins.apks[kind]:null;
const operationFor=kind=>kind==='catalog'?'download-catalog':`download-apk-${kind}`;
export function onlineRuntime(base,pins) {
  validatePins(pins);
  return {...base,operations:[['catalog',pins.catalog],...Object.entries(pins.apks)].map(([kind,pin])=>({
    capability:'store-download',service:'itonami-distribution',operation:operationFor(kind),
    consent:'each-operation','data-categories':['request-ip','app-version'],
    endpoint:{origin:new URL(pin.url).origin,routes:[{method:'GET',path:new URL(pin.url).pathname,'query-params':[]}]},
    artifact:{revision:pins.revision,sha256:pin.sha256,'max-bytes':pin.maxBytes},
  }))};
}
export function createOnline(base,pins) {
  const runtime=onlineRuntime(base,pins);
  if(clientRuntimeProblems(runtime,['store-download'],location.origin).length)throw Error('配信操作の宣言を確認できません。');
  const broker=createClientOperationBroker({runtime,requestedCapabilities:['store-download'],approvedOperations:runtime.operations,
    hostSupportedOperations:runtime.operations.map(o=>[o.capability,o.service,o.operation]),consentHost:createClientConsentHost()});
  // Eligibility is a ceiling. Every invoke still requires the canonical trusted user choice.
  return {runtime,connectSrc:clientRuntimeConnectSrc(runtime,['store-download'],[],location.origin),async download(kind){
    const pin=pinFor(pins,kind);if(!pin)throw Error('未宣言の取得です。');
    const result=await broker.invoke({capability:'store-download',service:'itonami-distribution',operation:operationFor(kind)},{input:pin.url,init:{method:'GET'}});
    return new Uint8Array(await result.blob.arrayBuffer());
  }};
}
// trust: {root, raw, signature} (base64; the root public key and the root-signed key list, AWAI-3775), or, for a
// package built before it bundled a list, the single pinned public key as a base64 string.
export async function catalogSigned(trust,data,signature,now=Math.floor(Date.now()/1000)) {
  if(typeof trust==='string'){
    const key=await crypto.subtle.importKey('spki',base64Bytes(trust),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,data);
  }
  if(!trust||typeof trust.root!=='string'||typeof trust.raw!=='string'||typeof trust.signature!=='string')throw Error('署名の鍵の一覧がありません。');
  let list;
  try{list=await verifyKeyList(base64Bytes(trust.raw),base64Bytes(trust.signature),base64Bytes(trust.root),now,0);}
  catch(e){throw Error(`署名の鍵の一覧を確認できません（${e.message}）。`);}
  return authentic(list,CATALOG,data,signature);
}
export async function authenticateCatalog(envelope,trust,domain,minimumRevision=1) {
  if(!Number.isSafeInteger(minimumRevision)||minimumRevision<1)throw Error('保存済みのカタログ履歴を確認できません。');
  if(!envelope||typeof envelope.raw!=='string'||envelope.raw.length>131072||typeof envelope.signature!=='string'||envelope.signature.length>8192)throw Error('カタログの形式を確認できません。');
  if(!await catalogSigned(trust,new TextEncoder().encode(envelope.raw),base64Bytes(envelope.signature)))throw Error('カタログの署名を確認できません。');
  const value=JSON.parse(envelope.raw);
  if(!domain.validCatalog(envelope.raw,Math.floor(Date.now()/1000))||value.revision<minimumRevision)throw Error('有効期限またはカタログの巻き戻しを検出しました。');
  return value;
}
