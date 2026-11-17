import {test} from 'node:test';import assert from 'node:assert/strict';
import worker from '../../../distribution/worker.mjs';
import {transportURL} from '../update-linux.mjs';
test('Node channel-relative archive URL resolves to the global R2 object',async()=>{
 const name='a'.repeat(64)+'.nar-export';
 for(const channel of ['stable','canary']){
  const url=transportURL(`https://release.example/${channel}/`,name);
  const response=await worker.fetch(new Request(url),{RELEASES:{get:async key=>{assert.equal(key,name);return object();}}});
  assert.equal(response.status,200);assert.equal(await response.text(),'data');
 }
});
const object=(extra={})=>({size:4,httpEtag:'"fixture"',body:'data',writeHttpMetadata:h=>h.set('Content-Type','unsafe/type'),...extra});
test('release transport accepts only read-only manifest/content-addressed paths',async()=>{let reads=0;const env={RELEASES:{get:async()=>{reads++;return object();}}};for(const [method,path,status] of [['POST','/stable/manifest.json',405],['GET','/config.json',404],['GET','/stable/manifest.json',200],['HEAD','/'+'a'.repeat(64)+'.iso',200]]){const r=await worker.fetch(new Request('https://release.example'+path,{method}),env);assert.equal(r.status,status);if(method==='HEAD')assert.equal(await r.text(),'');if(path.endsWith('manifest.json')&&method==='GET'){assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('content-type'),'application/json');}}assert.equal(reads,2);});
test('immutable archive streams ranged content and missing artifacts stay unavailable',async()=>{const path='/'+'a'.repeat(64)+'.nar-export';const r=await worker.fetch(new Request('https://release.example'+path,{headers:{Range:'bytes=1-2'}}),{RELEASES:{get:async(key,options)=>{assert.equal(options.range.get('range'),'bytes=1-2');return object({body:'at',range:{offset:1,length:2}});}}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 1-2/4');assert.equal(r.headers.get('content-length'),'2');assert.match(r.headers.get('cache-control'),/immutable/);assert.equal(await r.text(),'at');assert.equal((await worker.fetch(new Request('https://release.example'+path),{RELEASES:{get:async()=>null}})).status,404);});
test('R2 full-object range metadata does not turn ordinary GET or HEAD into partial responses',async()=>{for(const method of ['GET','HEAD']){const r=await worker.fetch(new Request('https://release.example/stable/'+'a'.repeat(64)+'.iso',{method}),{RELEASES:{get:async()=>object({range:{offset:0,length:4}})}});assert.equal(r.status,200);assert.equal(r.headers.get('content-length'),'4');assert.equal(r.headers.get('content-range'),null);}});
