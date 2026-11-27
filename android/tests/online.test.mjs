import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,sign} from 'node:crypto';
import vm from 'node:vm';
const runtime=new URL('../../otehon/shell/vendor/kotoba-client-runtime.js',import.meta.url);
const text=readFileSync(new URL('../client/online.js',import.meta.url),'utf8').replace("'./runtime.js'",JSON.stringify(runtime.href)).replace("'./key-list.js'",JSON.stringify(new URL('../client/key-list.js',import.meta.url).href));
const {MAX_PINNED_APPS,MAX_PIN_BYTES,validatePins,disclosureFor,onlineRuntime,authenticateCatalog}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const {clientRuntimeProblems,clientDisclosureProblems,clientEndpointAllowsRequest}=await import(runtime.href);
const ctx=vm.createContext({window:{}});vm.runInContext(readFileSync(new URL('../client/generated/domain.js',import.meta.url),'utf8'),ctx);
const domain=ctx.window.ItonamiDomain, rev='a'.repeat(40);
const base=`https://raw.githubusercontent.com/network-awai/awai-os/${rev}/store/distribution/dev/`;
const pins={revision:rev,catalog:{url:base+'catalog-envelope.json',sha256:'b'.repeat(64),maxBytes:131072},apks:{'network.itonami.yotei':{url:base+'yotei.apk',sha256:'c'.repeat(64),maxBytes:2097152}}};
const yotei=pins.apks['network.itonami.yotei'];
// A root-signed key list (AWAI-3775) whose catalog key is the given public key.
const trustRoot=generateKeyPairSync('rsa',{modulusLength:2048}),trustPointer=generateKeyPairSync('rsa',{modulusLength:2048});
function trustFor(catalogPublicKey){const b=k=>k.export({type:'spki',format:'der'}).toString('base64');const now=Math.floor(Date.now()/1000);
 const list=`itonami.store.keys.v1\nsequence 1\nissued ${now-60}\nexpires ${now+86400}\nkey catalog ${b(catalogPublicKey)}\nkey pointer ${b(trustPointer.publicKey)}\n`;
 return {root:b(trustRoot.publicKey),raw:Buffer.from(list).toString('base64'),signature:sign('sha256',Buffer.from(list),trustRoot.privateKey).toString('base64')};}
test('online operations pin exact immutable HTTPS paths, digests and no query',()=>{
 const r=onlineRuntime(domain.descriptor,pins);assert.deepEqual(clientRuntimeProblems(r,['store-download'],'http://127.0.0.1:8791'),[]);
 const e=r.operations[0].endpoint;assert(clientEndpointAllowsRequest(e,pins.catalog.url));
 for(const u of [pins.catalog.url+'?token=x',base+'other.json',pins.catalog.url.replace(rev,'main')])assert(!clientEndpointAllowsRequest(e,u));
 for(const u of ['http://raw.githubusercontent.com/x','https://evil.test/a',yotei.url+'?x=1',yotei.url.replace(rev,'main')])assert.throws(()=>validatePins({...pins,apks:{'network.itonami.yotei':{...yotei,url:u}}}));
});
test('catalog signature, expiry and highest accepted revision fail closed',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const key=trustFor(publicKey);
 const raw=JSON.stringify({schema:'itonami.store.bundled.v1',revision:100,expiresAt:Math.floor(Date.now()/1000)+60,apps:[]});
 const envelope={raw,signature:sign('sha256',Buffer.from(raw),privateKey).toString('base64')};
 assert.equal((await authenticateCatalog(envelope,key,domain,100)).revision,100);
 await assert.rejects(authenticateCatalog({...envelope,raw:raw+' '},key,domain));
 await assert.rejects(authenticateCatalog(envelope,key,domain,101));
 await assert.rejects(authenticateCatalog(envelope,key,domain,NaN));
 const old=JSON.stringify({...JSON.parse(raw),expiresAt:1});await assert.rejects(authenticateCatalog({raw:old,signature:sign('sha256',Buffer.from(old),privateKey).toString('base64')},key,domain));
});
test('two-app catalog authenticates and tampering with either entry fails closed',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const key=trustFor(publicKey);
 const apk=(id,asset,bytes)=>({id,name:id,versionName:'0.1.0',versionCode:2,publisher:'Awai Otehon 開発版',artifacts:[{platform:'android',runtime:'android',kind:'apk',asset,bytes,sha256:'a'.repeat(64),signerSha256:'b'.repeat(64)}]});
 const two=JSON.stringify({schema:'itonami.store.bundled.v1',revision:101,expiresAt:Math.floor(Date.now()/1000)+60,
  apps:[apk('network.itonami.yotei','packages/yotei.apk',1621048),apk('network.itonami.app','packages/itonami.apk',32644749)]});
 const envelope={raw:two,signature:sign('sha256',Buffer.from(two),privateKey).toString('base64')};
 assert.deepEqual((await authenticateCatalog(envelope,key,domain,101)).apps.map(a=>a.id),['network.itonami.yotei','network.itonami.app']);
 const cut=JSON.stringify({...JSON.parse(two),apps:JSON.parse(two).apps.slice(0,1)});
 await assert.rejects(authenticateCatalog({...envelope,raw:cut},key,domain));
 const swapped=two.replace('packages/itonami.apk','packages/evil.apk');
 await assert.rejects(authenticateCatalog({...envelope,raw:swapped},key,domain));
});
test('one pinned download operation per app; ids, budgets and the legacy single pin are checked',()=>{
 const bot={url:base+'torihiki-bot.apk',sha256:'d'.repeat(64),maxBytes:29506324};
 const two={...pins,apks:{...pins.apks,'network.itonami.torihiki.bot':bot}};
 const r=onlineRuntime(domain.descriptor,two);assert.deepEqual(clientRuntimeProblems(r,['store-download'],'http://127.0.0.1:8791'),[]);
 assert.deepEqual(r.operations.map(o=>o.operation),['download-catalog','download-apk-network.itonami.yotei','download-apk-network.itonami.torihiki.bot']);
 const ops=Object.fromEntries(r.operations.map(o=>[o.operation,o]));
 assert(clientEndpointAllowsRequest(ops['download-apk-network.itonami.torihiki.bot'].endpoint,bot.url));
 assert(!clientEndpointAllowsRequest(ops['download-apk-network.itonami.torihiki.bot'].endpoint,yotei.url));
 assert.equal(ops['download-apk-network.itonami.torihiki.bot'].artifact['max-bytes'],29506324);
 for(const bad of [{...pins,apks:{}},{...pins,apks:[yotei]},{...pins,apks:{'../x':yotei}},{...pins,apks:{'__proto__':yotei}},
   {...pins,apks:{'network.itonami.torihiki.bot':{...bot,maxBytes:64*1024*1024+1}}},{...pins,catalog:{...pins.catalog,maxBytes:131073}},
   {revision:rev,catalog:pins.catalog,apk:yotei}])assert.throws(()=>validatePins(bad),JSON.stringify(Object.keys(bad.apks||{})));
});
test('the checked-in development pins use the per-app shape',()=>{
 const dev=JSON.parse(readFileSync(new URL('../online-pins.dev.json',import.meta.url),'utf8'));
 validatePins(dev);assert(Object.keys(dev.apks).length>=1);
});

test('catalog signature through the root-signed key list (AWAI-3775)',async()=>{
 const rsa=()=>generateKeyPairSync('rsa',{modulusLength:2048});const root=rsa(),cat=rsa(),ptr=rsa();
 const b64=k=>k.publicKey.export({type:'spki',format:'der'}).toString('base64');const now=Math.floor(Date.now()/1000);
 const list=`itonami.store.keys.v1\nsequence 2\nissued ${now-60}\nexpires ${now+86400}\nkey catalog ${b64(cat)}\nkey pointer ${b64(ptr)}\n`;
 const trust={root:b64(root),raw:Buffer.from(list).toString('base64'),signature:sign('sha256',Buffer.from(list),root.privateKey).toString('base64')};
 const raw=JSON.stringify({schema:'itonami.store.bundled.v1',revision:100,expiresAt:now+60,apps:[]});
 const by=k=>({raw,signature:sign('sha256',Buffer.from(raw),k.privateKey).toString('base64')});
 assert.equal((await authenticateCatalog(by(cat),trust,domain,100)).revision,100);
 await assert.rejects(authenticateCatalog(by(ptr),trust,domain),/署名/,'pointer key cannot sign a catalog');
 await assert.rejects(authenticateCatalog(by(root),trust,domain),/署名/,'root cannot sign a catalog');
 await assert.rejects(authenticateCatalog(by(cat),{...trust,root:b64(rsa())},domain),/keys-signature/,'list from another root');
 await assert.rejects(authenticateCatalog(by(cat),{...trust,signature:sign('sha256',Buffer.from(list),cat.privateKey).toString('base64')},domain),/keys-signature/,'list not signed by the root');
 await assert.rejects(authenticateCatalog(by(cat),undefined,domain),/鍵の一覧/,'no trust at all');
});

test('pin APK limit boundaries and alignment across online.js, OnlinePins.java, HostActivity.java, LatestPointer.java, and dev pins (AWAI-3729)',()=>{
 const makePins=count=>{
  const apks={};
  for(let i=0;i<count;i++)apks[`network.itonami.app${i}`]={url:`${base}app${i}.apk`,sha256:'c'.repeat(64),maxBytes:1048576};
  return {revision:rev,catalog:pins.catalog,apks};
 };
 assert.equal(MAX_PINNED_APPS,64);
 assert.throws(()=>validatePins(makePins(0)),'0 APKs rejected');
 assert.doesNotThrow(()=>validatePins(makePins(MAX_PINNED_APPS)),'exact max APKs accepted');
 assert.throws(()=>validatePins(makePins(MAX_PINNED_APPS+1)),'max + 1 APKs rejected');

 const dev=JSON.parse(readFileSync(new URL('../online-pins.dev.json',import.meta.url),'utf8'));
 const devCount=Object.keys(dev.apks).length;
 assert(devCount>=17&&devCount<=MAX_PINNED_APPS,`dev pins count ${devCount} within [17, ${MAX_PINNED_APPS}]`);

 const onlinePinsJava=readFileSync(new URL('../shared/src/network/awai/platform/OnlinePins.java',import.meta.url),'utf8');
 const hostJava=readFileSync(new URL('../shared/src/network/awai/platform/HostActivity.java',import.meta.url),'utf8');
 const pointerJava=readFileSync(new URL('../shared/src/network/awai/platform/LatestPointer.java',import.meta.url),'utf8');
 const m=onlinePinsJava.match(/public\s+static\s+final\s+int\s+MAX_APPS\s*=\s*(\d+)/);
 assert(m,'OnlinePins.MAX_APPS declared');
 assert.equal(Number(m[1]),MAX_PINNED_APPS,'OnlinePins.MAX_APPS matches online.js MAX_PINNED_APPS');
 assert(hostJava.includes('OnlinePins.MAX_APPS')&&hostJava.includes('OnlinePins.loadAllowlist'),'HostActivity delegates to OnlinePins');
 assert(!hostJava.includes('apks.length()>16'),'HostActivity no longer hardcodes 16-app limit');
 assert(pointerJava.includes('MAX_APPS = OnlinePins.MAX_APPS'),'LatestPointer.MAX_APPS stays aligned with OnlinePins.MAX_APPS');
});

test('download disclosures localize to Japanese by default and support English fallback (AWAI-3729)',()=>{
 const jaRuntime=onlineRuntime(domain.descriptor,pins);
 assert.deepEqual(clientRuntimeProblems(jaRuntime,['store-download'],'http://127.0.0.1:8791'),[]);
 const jaCat=jaRuntime.operations.find(o=>o.operation==='download-catalog').disclosure;
 const jaApk=jaRuntime.operations.find(o=>o.operation==='download-apk-network.itonami.yotei').disclosure;
 assert.deepEqual(clientDisclosureProblems(jaCat),[]);
 assert.deepEqual(clientDisclosureProblems(jaApk),[]);
 assert.equal(jaCat.recipient,'GitHub, Inc.');
 assert.equal(jaCat.country,'US');
 assert.equal(jaCat['country-name'],'アメリカ合衆国');
 assert.equal(jaCat.frequency,'one-time');
 assert.equal(jaCat['special-care'],false);
 assert.match(jaCat.purpose,/カタログ/);
 assert.match(jaApk.purpose,/アプリ配布物/);
 assert(jaCat.data.every(d=>/[^\x00-\x7f]/.test(d)),'Japanese catalog data entries are localized');
 assert(jaApk.data.every(d=>/[^\x00-\x7f]/.test(d)),'Japanese APK data entries are localized');
 assert.match(jaCat.note,/IP アドレス/);
 assert.match(jaCat.withdrawal,/中止/);

 // Explicit 'en' and BCP-47 'en-US' produce valid English disclosures.
 for(const loc of ['en','en-US']){
  const enRuntime=onlineRuntime(domain.descriptor,pins,loc);
  assert.deepEqual(clientRuntimeProblems(enRuntime,['store-download'],'http://127.0.0.1:8791'),[]);
  const enCat=enRuntime.operations.find(o=>o.operation==='download-catalog').disclosure;
  const enApk=enRuntime.operations.find(o=>o.operation==='download-apk-network.itonami.yotei').disclosure;
  assert.deepEqual(clientDisclosureProblems(enCat),[]);
  assert.deepEqual(clientDisclosureProblems(enApk),[]);
  assert.equal(enCat['country-name'],'United States');
  assert.equal(enCat.purpose,'download the pinned store catalog');
  assert.equal(enApk.purpose,'download a pinned app package from the store catalog');
  assert.deepEqual(enCat.data,['request IP address','app version','store catalog request']);
  assert.deepEqual(enApk.data,['request IP address','app version','pinned app package request']);
 }

 // Unknown/empty locales default safely to Japanese (matching kotoba-client-runtime.js).
 assert.deepEqual(disclosureFor('catalog','fr'),jaCat);
 assert.deepEqual(disclosureFor('catalog',undefined),jaCat);
});

test('client.js non-Android bootstrap uses catalogTrust() and has no stale ItonamiPublicKey reference (AWAI-3729)',()=>{
 const clientSrc=readFileSync(new URL('../client/client.js',import.meta.url),'utf8');
 assert(!clientSrc.includes('ItonamiPublicKey'),'removed global window.ItonamiPublicKey must not appear in client.js');
 assert(clientSrc.includes('authenticateCatalog(envelope,catalogTrust(),domain,floor)'),'non-Android bootstrap uses catalogTrust()');
});

test('online-csp.mjs and validatePins enforce OnlinePins.java parity: exact integer maxBytes, 32768-byte cap, strict URLs, and Catalog admission (AWAI-3729)',()=>{
 assert.equal(MAX_PIN_BYTES,32768);
 const onlinePinsJava=readFileSync(new URL('../shared/src/network/awai/platform/OnlinePins.java',import.meta.url),'utf8');
 const buildPy=readFileSync(new URL('../build.py',import.meta.url),'utf8');
 const cspScript=fileURLToPath(new URL('../online-csp.mjs',import.meta.url));
 const cspSrc=readFileSync(cspScript,'utf8');
 assert.equal(Number(onlinePinsJava.match(/MAX_BYTES\s*=\s*(\d+)/)[1]),MAX_PIN_BYTES);
 assert.equal(Number(buildPy.match(/MAX_ONLINE_PIN_BYTES\s*=(\s*)(\d+)/)[2]),MAX_PIN_BYTES);
 assert.equal(Number(cspSrc.match(/MAX_PIN_BYTES\s*=\s*(\d+)/)[1]),MAX_PIN_BYTES);

 const makeSizedPins=(count,targetBytes)=>{
  const apks={};
  for(let i=0;i<count;i++)apks[`network.itonami.app${i}`]={url:`${base}app${i}.apk`,sha256:'c'.repeat(64),maxBytes:1048576};
  const doc={revision:rev,catalog:pins.catalog,apks};
  const current=Buffer.byteLength(JSON.stringify(doc),'utf8');
  if(targetBytes!==undefined){
   const extra=targetBytes-current;
   assert(extra>=0,`targetBytes ${targetBytes} >= base ${current}`);
   const basePad=Math.floor(extra/count), rem=extra%count;
   for(let i=0;i<count;i++){
    const add=basePad+(i<rem?1:0);
    if(add>0)apks[`network.itonami.app${i}`].url=`${base}app${i}-${'p'.repeat(add-1)}.apk`;
   }
  }
  return doc;
 };

 // validatePins enforces 32,768-byte cap and strict URL rules (explicit :443, traversal, % encoding).
 const exact64=makeSizedPins(MAX_PINNED_APPS,MAX_PIN_BYTES);
 assert.equal(Buffer.byteLength(JSON.stringify(exact64),'utf8'),MAX_PIN_BYTES);
 assert.doesNotThrow(()=>validatePins(exact64),'64 APKs at exact 32768 bytes accepted');
 const over64=makeSizedPins(MAX_PINNED_APPS,MAX_PIN_BYTES+1);
 assert.equal(Buffer.byteLength(JSON.stringify(over64),'utf8'),MAX_PIN_BYTES+1);
 assert.throws(()=>validatePins(over64),'64 APKs at 32769 bytes rejected');
 for(const badUrl of [
  yotei.url.replace('https://raw.githubusercontent.com/','https://raw.githubusercontent.com:443/'),
  `${base}../evil.apk`, `${base}dir/..`, `${base}%2e%2e/evil.apk`, `${base}dir/`
 ]){
  assert.throws(()=>validatePins({...pins,apks:{'network.itonami.yotei':{...yotei,url:badUrl}}}),`bad URL rejected: ${badUrl}`);
 }

 // Stage minimal assets dir so online-csp.mjs imports online.js + runtime.js cleanly.
 const stage=mkdtempSync(path.join(tmpdir(),'awai-csp-test-'));
 try{
  copyFileSync(fileURLToPath(new URL('../client/online.js',import.meta.url)),path.join(stage,'online.js'));
  copyFileSync(fileURLToPath(new URL('../client/key-list.js',import.meta.url)),path.join(stage,'key-list.js'));
  copyFileSync(fileURLToPath(runtime),path.join(stage,'runtime.js'));
  const runCsp=rawStdin=>spawnSync(process.execPath,[cspScript],{input:rawStdin,encoding:'utf8'});
  const payloadStr=pinsJsonText=>`{"assets":${JSON.stringify(stage)},"pins":${pinsJsonText},"descriptor":${JSON.stringify(domain.descriptor)}}`;

  // Valid fixtures: real online-pins.dev.json and exact 32,768-byte 64-APK document pass.
  const devRaw=readFileSync(new URL('../online-pins.dev.json',import.meta.url),'utf8');
  const devRes=runCsp(payloadStr(devRaw));
  assert.equal(devRes.status,0,`dev pins accepted: ${devRes.stderr}`);
  assert.equal(devRes.stdout.trim(),'connect-src https://raw.githubusercontent.com');

  const exactRes=runCsp(payloadStr(JSON.stringify(exact64)));
  assert.equal(exactRes.status,0,`exact 32768-byte 64-APK pins accepted: ${exactRes.stderr}`);
  assert.equal(exactRes.stdout.trim(),'connect-src https://raw.githubusercontent.com');

  // Kougi P1 #1: decimal / exponent / boolean / string / out-of-range maxBytes must be rejected.
  const goodSingle=JSON.stringify(pins);
  for(const [label,mutated] of [
   ['decimal 1024.0', goodSingle.replace('2097152','1024.0')],
   ['catalog decimal 1024.0', goodSingle.replace('131072','1024.0')],
   ['exponent 1e3', goodSingle.replace('2097152','1e3')],
   ['boolean true', goodSingle.replace('2097152','true')],
   ['string "1024"', goodSingle.replace('2097152','"1024"')],
   ['zero maxBytes', goodSingle.replace('2097152','0')],
   ['over APK budget', goodSingle.replace('2097152',String(64*1024*1024+1))],
   ['duplicate APK key', goodSingle.replace('}}}',`},"network.itonami.yotei":${JSON.stringify(yotei)}}}`)],
   ['offline-only preview app', JSON.stringify({...pins,apks:{'network.itonami.client.preview':yotei}})],
   ['unadmitted app id', JSON.stringify({...pins,apks:{'network.other.evil':yotei}})],
   ['explicit :443 port', goodSingle.replace('https://raw.githubusercontent.com/','https://raw.githubusercontent.com:443/')],
   ['trailing /..', goodSingle.replace('yotei.apk','dir/..')],
  ]){
   const r=runCsp(payloadStr(mutated));
   assert.notEqual(r.status,0,`online-csp.mjs must reject ${label}`);
  }

  // Kougi P1 #2: 64-APK pin JSON exceeding 32,768 bytes must be rejected.
  const overRes=runCsp(payloadStr(JSON.stringify(over64)));
  assert.notEqual(overRes.status,0,'online-csp.mjs must reject 32769-byte 64-APK pins');
  assert.match(overRes.stderr,/size-limit/);
 }finally{
  rmSync(stage,{recursive:true,force:true});
 }
});
