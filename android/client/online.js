import { clientRuntimeProblems, createClientConsentHost, createClientOperationBroker, clientRuntimeConnectSrc } from './runtime.js';
import { verifyKeyList, authentic, base64Bytes, CATALOG } from './key-list.js';

// Pins: one catalog envelope plus one APK pin per app id. Each pin is an exact immutable URL under
// this repository's pinned revision; per-app byte budgets are enforced again by the host Catalog.
// Shared upper bounds with OnlinePins.MAX_APPS / OnlinePins.MAX_BYTES / LatestPointer.MAX_APPS / HostActivity.MAX_ONLINE_PIN_APPS (AWAI-3729).
export const MAX_PINNED_APPS = 64;
export const MAX_PIN_BYTES = 32768;
const APP_ID=/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,5}$/;
function validPin(entry,revision,ceiling){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.url!=='string')throw Error('配信先の固定情報を確認できません。');
  const prefix=`https://raw.githubusercontent.com/network-awai/awai-os/${revision}/store/distribution/`;
  if(!entry.url.startsWith(prefix)||entry.url.length<=prefix.length||entry.url.endsWith('/')||/\/\.{1,2}(?:\/|$)|%|\\/.test(entry.url))throw Error('配信先の固定情報を確認できません。');
  const u=new URL(entry.url);
  if(u.origin!=='https://raw.githubusercontent.com'||u.port||u.search||u.hash||u.username||u.password||u.href!==entry.url||!entry.sha256?.match(/^[0-9a-f]{64}$/)||!Number.isSafeInteger(entry.maxBytes)||entry.maxBytes<1||entry.maxBytes>ceiling)throw Error('配信先の固定情報を確認できません。');
}
export function validatePins(pins) {
  if (!pins || !/^[0-9a-f]{40}$/.test(pins.revision) || !pins.catalog || !pins.apks || typeof pins.apks!=='object' || Array.isArray(pins.apks)) throw Error('配信情報が未設定です。');
  const ids=Object.keys(pins.apks);
  if(ids.length<1||ids.length>MAX_PINNED_APPS||!ids.every(id=>APP_ID.test(id)))throw Error('配信先の固定情報を確認できません。');
  validPin(pins.catalog,pins.revision,131072);
  for(const id of ids)validPin(pins.apks[id],pins.revision,64*1024*1024);
  if(new TextEncoder().encode(JSON.stringify(pins)).length>MAX_PIN_BYTES)throw Error('配信先の固定情報を確認できません。');
  return pins;
}
const pinFor=(pins,kind)=>kind==='catalog'?pins.catalog:Object.hasOwn(pins.apks,kind)?pins.apks[kind]:null;
const operationFor=kind=>kind==='catalog'?'download-catalog':`download-apk-${kind}`;
// AWAI-3881 / AWAI-3729: every operation needs its finding-9 disclosure, in the same shape as
// apps/murakumo/client/download-contract.js (AWAI-3842). The catalog and every pinned
// APK are fetched from raw.githubusercontent.com; nothing but the pinned request leaves.
// Locale defaults to 'ja' matching otehon/shell/vendor/kotoba-client-runtime.js, with 'en' fallback.
const DOWNLOAD_DISCLOSURE=Object.freeze({
  ja:Object.freeze({
    countryName:'アメリカ合衆国',
    withdrawal:'取得が終わる前に中止する',
    note:'固定されたファイルの取得要求だけを送信します。HTTPS 通信には端末の IP アドレスも含まれます。',
    catalogData:Object.freeze(['要求元の IP アドレス','アプリの版','Store カタログの取得要求']),
    apkData:Object.freeze(['要求元の IP アドレス','アプリの版','固定されたアプリ配布物の取得要求']),
    catalogPurpose:'固定された Store カタログを取得する',
    apkPurpose:'Store カタログに固定されたアプリ配布物を取得する',
  }),
  en:Object.freeze({
    countryName:'United States',
    withdrawal:'cancel before it finishes',
    note:'Only the pinned file request is sent. Any HTTPS request also carries your IP address.',
    catalogData:Object.freeze(['request IP address','app version','store catalog request']),
    apkData:Object.freeze(['request IP address','app version','pinned app package request']),
    catalogPurpose:'download the pinned store catalog',
    apkPurpose:'download a pinned app package from the store catalog',
  }),
});
function resolveLocale(locale){
  return typeof locale==='string'&&locale.toLowerCase().startsWith('en')?'en':'ja';
}
export function disclosureFor(kind,locale='ja'){
  const copy=DOWNLOAD_DISCLOSURE[resolveLocale(locale)];
  const isCatalog=kind==='catalog';
  return {
    recipient:'GitHub, Inc.',country:'US','country-name':copy.countryName,
    'foreign-info-url':'https://github.com/','special-care':false,frequency:'one-time',
    withdrawal:copy.withdrawal,note:copy.note,
    data:isCatalog?[...copy.catalogData]:[...copy.apkData],
    purpose:isCatalog?copy.catalogPurpose:copy.apkPurpose,
  };
}
export function onlineRuntime(base,pins,locale='ja') {
  validatePins(pins);
  const lang=resolveLocale(locale);
  return {...base,operations:[['catalog',pins.catalog],...Object.entries(pins.apks)].map(([kind,pin])=>({
    capability:'store-download',service:'itonami-distribution',operation:operationFor(kind),
    consent:'each-operation','data-categories':['request-ip','app-version'],
    endpoint:{origin:new URL(pin.url).origin,routes:[{method:'GET',path:new URL(pin.url).pathname,'query-params':[]}]},
    artifact:{revision:pins.revision,sha256:pin.sha256,'max-bytes':pin.maxBytes},
    disclosure:disclosureFor(kind,lang),
  }))};
}
export function createOnline(base,pins,locale='ja') {
  const lang=resolveLocale(locale);
  const runtime=onlineRuntime(base,pins,lang);
  if(clientRuntimeProblems(runtime,['store-download'],location.origin).length)throw Error('配信操作の宣言を確認できません。');
  const broker=createClientOperationBroker({runtime,requestedCapabilities:['store-download'],approvedOperations:runtime.operations,
    hostSupportedOperations:runtime.operations.map(o=>[o.capability,o.service,o.operation]),consentHost:createClientConsentHost({locale:lang})});
  // Eligibility is a ceiling. Every invoke still requires the canonical trusted user choice.
  return {runtime,connectSrc:clientRuntimeConnectSrc(runtime,['store-download'],[],location.origin),async download(kind){
    const pin=pinFor(pins,kind);if(!pin)throw Error('未宣言の取得です。');
    const result=await broker.invoke({capability:'store-download',service:'itonami-distribution',operation:operationFor(kind)},{input:pin.url,init:{method:'GET'}});
    return new Uint8Array(await result.blob.arrayBuffer());
  }};
}
// trust: {root, raw, signature} (base64): the root public key and the root-signed key list (AWAI-3775).
export async function catalogSigned(trust,data,signature,now=Math.floor(Date.now()/1000)) {
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
