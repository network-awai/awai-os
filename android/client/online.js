import { clientRuntimeProblems, createClientConsentHost, createClientOperationBroker, clientRuntimeConnectSrc } from './runtime.js';

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
export async function authenticateCatalog(envelope,publicKey,domain,minimumRevision=1) {
  if(!Number.isSafeInteger(minimumRevision)||minimumRevision<1)throw Error('保存済みのカタログ履歴を確認できません。');
  if(!envelope||typeof envelope.raw!=='string'||envelope.raw.length>131072||typeof envelope.signature!=='string'||envelope.signature.length>8192)throw Error('カタログの形式を確認できません。');
  const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('spki',bytes(publicKey),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(envelope.signature),new TextEncoder().encode(envelope.raw)))throw Error('カタログの署名を確認できません。');
  const value=JSON.parse(envelope.raw);
  if(!domain.validCatalog(envelope.raw,Math.floor(Date.now()/1000))||value.revision<minimumRevision)throw Error('有効期限またはカタログの巻き戻しを検出しました。');
  return value;
}
