import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import vm from 'node:vm';
const runtime=new URL('../../otehon/shell/vendor/kotoba-client-runtime.js',import.meta.url);
const text=readFileSync(new URL('../client/online.js',import.meta.url),'utf8').replace("'./runtime.js'",JSON.stringify(runtime.href));
const {validatePins,onlineRuntime,authenticateCatalog}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const {clientRuntimeProblems,clientEndpointAllowsRequest}=await import(runtime.href);
const ctx=vm.createContext({window:{}});vm.runInContext(readFileSync(new URL('../client/generated/domain.js',import.meta.url),'utf8'),ctx);
const domain=ctx.window.ItonamiDomain, rev='a'.repeat(40);
const base=`https://raw.githubusercontent.com/network-awai/awai-os/${rev}/store/distribution/dev/`;
const pins={revision:rev,catalog:{url:base+'catalog-envelope.json',sha256:'b'.repeat(64),maxBytes:131072},apk:{url:base+'yotei.apk',sha256:'c'.repeat(64),maxBytes:2097152}};
test('online operations pin exact immutable HTTPS paths, digests and no query',()=>{
 const r=onlineRuntime(domain.descriptor,pins);assert.deepEqual(clientRuntimeProblems(r,['store-download'],'http://127.0.0.1:8791'),[]);
 const e=r.operations[0].endpoint;assert(clientEndpointAllowsRequest(e,pins.catalog.url));
 for(const u of [pins.catalog.url+'?token=x',base+'other.json',pins.catalog.url.replace(rev,'main')])assert(!clientEndpointAllowsRequest(e,u));
 for(const u of ['http://raw.githubusercontent.com/x','https://evil.test/a',pins.apk.url+'?x=1',pins.apk.url.replace(rev,'main')])assert.throws(()=>validatePins({...pins,apk:{...pins.apk,url:u}}));
});
test('catalog signature, expiry and highest accepted revision fail closed',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const key=publicKey.export({type:'spki',format:'der'}).toString('base64');
 const raw=JSON.stringify({schema:'itonami.store.bundled.v1',revision:100,expiresAt:Math.floor(Date.now()/1000)+60,apps:[]});
 const envelope={raw,signature:sign('sha256',Buffer.from(raw),privateKey).toString('base64')};
 assert.equal((await authenticateCatalog(envelope,key,domain,100)).revision,100);
 await assert.rejects(authenticateCatalog({...envelope,raw:raw+' '},key,domain));
 await assert.rejects(authenticateCatalog(envelope,key,domain,101));
 await assert.rejects(authenticateCatalog(envelope,key,domain,NaN));
 const old=JSON.stringify({...JSON.parse(raw),expiresAt:1});await assert.rejects(authenticateCatalog({raw:old,signature:sign('sha256',Buffer.from(old),privateKey).toString('base64')},key,domain));
});
test('two-app catalog authenticates and tampering with either entry fails closed',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const key=publicKey.export({type:'spki',format:'der'}).toString('base64');
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
