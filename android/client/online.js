import { clientRuntimeProblems, createClientConsentHost, createClientOperationBroker, clientRuntimeConnectSrc } from './runtime.js';

export function validatePins(pins) {
  if (!pins || !/^[0-9a-f]{40}$/.test(pins.revision) || !pins.catalog || !pins.apk) throw Error('配信情報が未設定です。');
  for (const entry of [pins.catalog,pins.apk]) {
    const u=new URL(entry.url);
    if(u.origin!=='https://raw.githubusercontent.com'||u.search||u.hash||u.username||u.password||!u.pathname.startsWith(`/network-awai/awai-os/${pins.revision}/store/distribution/`)||!entry.sha256?.match(/^[0-9a-f]{64}$/)||!Number.isSafeInteger(entry.maxBytes)||entry.maxBytes<1||entry.maxBytes>20*1024*1024)throw Error('配信先の固定情報を確認できません。');
  }
  return pins;
}
export function onlineRuntime(base,pins) {
  validatePins(pins);
  return {...base,operations:[['catalog',pins.catalog],['apk',pins.apk]].map(([kind,pin])=>({
    capability:'store-download',service:'itonami-distribution',operation:`download-${kind}`,
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
    const pin=pins[kind];if(!pin)throw Error('未宣言の取得です。');
    const result=await broker.invoke({capability:'store-download',service:'itonami-distribution',operation:`download-${kind}`},{input:pin.url,init:{method:'GET'}});
    return new Uint8Array(await result.blob.arrayBuffer());
  }};
}
export async function authenticateCatalog(envelope,publicKey,domain,minimumRevision=1) {
  if(!envelope||typeof envelope.raw!=='string'||envelope.raw.length>131072||typeof envelope.signature!=='string'||envelope.signature.length>8192)throw Error('カタログの形式を確認できません。');
  const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('spki',bytes(publicKey),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(envelope.signature),new TextEncoder().encode(envelope.raw)))throw Error('カタログの署名を確認できません。');
  const value=JSON.parse(envelope.raw);
  if(!domain.validCatalog(envelope.raw,Math.floor(Date.now()/1000))||value.revision<minimumRevision)throw Error('有効期限またはカタログの巻き戻しを検出しました。');
  return value;
}
