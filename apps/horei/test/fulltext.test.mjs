import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {cidFromSha256,requestUrl,createFullText,lawText,runtimeDescriptor,OPERATION,SELECTOR} from '../src/fulltext.js';
import {clientRuntimeProblems,clientRuntimeConnectSrc,clientEndpointAllowsRequest} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';
// 婦人補導院法 as served by e-Gov API v2 on 2026-11-18; its sha256 equals the corpus record.
const fixture=new Uint8Array(readFileSync(new URL('./fixtures/333AC0000000017.json',import.meta.url)));
const law={localId:'333AC0000000017',textSha256:'4e4db3afb8eb3277f1e27dfc7aff96b8499581edc68c914e9fb897d72c9de3b7',textBytes:27749};
// From `yataverse cid` (kotoba-lang/yataverse c875a39) on the same file.
const CID='bafkreicojwz27ohlgj37dyt57r5p7fvyjgkyd3ogrsiu5h5ys7lszhpdw4';
import {awaiFsCache} from '../src/fulltext.js';
function memoryCache(){const m=new Map();return {m,get:async c=>m.get(c)??null,put:async(c,b)=>{m.set(c,b);},delete:async c=>{m.delete(c);}};}
function gateway(body){const calls=[];return {calls,invoke:async(selector,payload)=>{calls.push({selector,payload});return new Response(body,{status:200});}};}

test('the CID is derived from the recorded sha256 and matches yataverse',()=>{
  assert.equal(cidFromSha256(law.textSha256),CID);
  assert.throws(()=>cidFromSha256('XYZ'),/invalid-sha256/);
});
test('the descriptor declares one GET to the gateway, consent for each operation, and a bounded redirect family',()=>{
  const d=runtimeDescriptor();
  assert.deepEqual(clientRuntimeProblems(d,[SELECTOR.capability],'https://tauri.localhost'),[]);
  assert.equal(d.operations.length,1);assert.equal(OPERATION.consent,'each-operation');
  const csp=clientRuntimeConnectSrc(d,[SELECTOR.capability],[],'https://tauri.localhost');
  assert.equal(csp,'connect-src https://yataverse.com');assert.equal(OPERATION.service,'awai.fs');assert.equal(OPERATION['redirect-origins'],undefined);
  assert.ok(clientEndpointAllowsRequest(OPERATION.endpoint,requestUrl(CID),'GET'));
  assert.ok(!clientEndpointAllowsRequest(OPERATION.endpoint,requestUrl(CID),'PUT'),'no write');
  assert.ok(!clientEndpointAllowsRequest(OPERATION.endpoint,`https://yataverse.com/ipfs/${CID}?format=car`,'GET'),'fixed query value');
  assert.ok(!clientEndpointAllowsRequest(OPERATION.endpoint,`https://yataverse.com/awai-drive/v1/packs/${'0'.repeat(64)}`,'GET'),'only /ipfs/');
});
test('denying consent sends no request and caches nothing',async()=>{
  const cache=memoryCache();let fetched=0;
  const ft=createFullText({cache,invoke:async()=>{throw Error('client operation denied');}});
  const realFetch=globalThis.fetch;globalThis.fetch=async()=>{fetched++;throw Error('unexpected');};
  try{await assert.rejects(ft.fetch(law),/denied/);}finally{globalThis.fetch=realFetch;}
  assert.equal(fetched,0);assert.equal(cache.m.size,0);
});
test('approved: one request, verified, cached; the second open makes no request',async()=>{
  const cache=memoryCache(),g=gateway(fixture),ft=createFullText({cache,invoke:g.invoke});
  const first=await ft.fetch(law);
  assert.equal(first.source,'network');assert.equal(first.cid,CID);assert.equal(g.calls.length,1);
  assert.deepEqual(g.calls[0].selector,SELECTOR);assert.equal(g.calls[0].payload.input,requestUrl(CID));
  assert.ok(cache.m.has(CID));
  const second=await ft.fetch(law);
  assert.equal(second.source,'cache');assert.equal(g.calls.length,1,'offline second open');
  assert.equal((await ft.cached(law)).source,'cache');
});
test('negative control: altered, short or oversized bytes are refused and never cached',async()=>{
  const altered=fixture.slice();altered[100]^=1;
  for(const body of [altered,fixture.slice(0,-1),new Uint8Array([...fixture,32])]){
    const cache=memoryCache(),ft=createFullText({cache,invoke:gateway(body).invoke});
    await assert.rejects(ft.fetch(law),/mismatch/);assert.equal(cache.m.size,0);
  }
});
test('a corrupted cache entry is discarded and fetched again',async()=>{
  const cache=memoryCache(),bad=fixture.slice();bad[0]^=1;cache.m.set(CID,bad);
  const g=gateway(fixture),ft=createFullText({cache,invoke:g.invoke});
  assert.equal(await ft.cached(law),null);assert.equal(cache.m.size,0);
  assert.equal((await ft.fetch(law)).source,'network');assert.equal(g.calls.length,1);
});
test('a missing block or gateway error is reported and not cached',async()=>{
  for(const [status,error] of [[404,/absent/],[502,/unavailable/]]){
    const cache=memoryCache(),ft=createFullText({cache,invoke:async()=>new Response('x',{status})});
    await assert.rejects(ft.fetch(law),error);assert.equal(cache.m.size,0);
  }
});
test('the law text is flattened from the e-Gov element tree as plain text',()=>{
  const text=lawText(fixture);
  assert.ok(text.startsWith('昭和三十三年法律第十七号\n婦人補導院法\n'));
  assert.match(text,/第一条　婦人補導院は、/);assert.match(text,/\n２　婦人補導院は、国立とする。/);
  assert.throws(()=>lawText(new TextEncoder().encode('{"x":1}')),/format/);
  assert.throws(()=>lawText(new Uint8Array([0xff])),/format/);
});
test('a request that never answers is aborted and reported as unavailable',async()=>{
  const cache=memoryCache();let aborted=false;
  const ft=createFullText({cache,timeoutMs:20,invoke:(sel,payload,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('client operation cancelled'));}))});
  await assert.rejects(ft.fetch(law),/unavailable/);assert.ok(aborted);assert.equal(cache.m.size,0);
});
test('the Awai FS cache talks to the host commands: raw bytes with the CID header, empty body means absent',async()=>{
  const calls=[];const host={};
  const invoke=async(cmd,args,opts)=>{calls.push([cmd,args,opts]);if(cmd==='awai_fs_get')return (host[args.cid]??new Uint8Array()).buffer;if(cmd==='awai_fs_put'){host[opts.headers['x-awai-cid']]=args;return null;}if(cmd==='awai_fs_delete'){delete host[args.cid];return null;}};
  const cache=awaiFsCache(invoke),g=gateway(fixture),ft=createFullText({cache,invoke:g.invoke});
  assert.equal(await cache.get(CID),null);
  assert.equal((await ft.fetch(law)).source,'network');
  const put=calls.find(c=>c[0]==='awai_fs_put');assert.ok(put[1] instanceof Uint8Array);assert.deepEqual(put[2],{headers:{'x-awai-cid':CID}});
  assert.equal((await ft.fetch(law)).source,'cache');assert.equal(g.calls.length,1);
});
