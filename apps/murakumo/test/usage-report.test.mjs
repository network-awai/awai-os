// AWAI-3377: signed node usage reports, pinned devices and the reporter's parsers.
import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {clientRuntimeProblems,clientRuntimeConnectSrc} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';
import {verifyReport,readReport,verifySignature,REPORT_SCHEMA,MAX_REPORT_BYTES} from '../client/usage-report.js';
import {verifyEd25519} from '../client/ed25519.js';
import {appRuntime,appCapabilities,devicesProblems,USAGE_CAPABILITY} from '../client/devices-contract.js';
const here=path.dirname(new URL(import.meta.url).pathname),APP='https://tauri.localhost';
const catalog=JSON.parse(fs.readFileSync(path.join(here,'../catalog.json')));
const pair=()=>{const k=crypto.generateKeyPairSync('ed25519');return {k,pub:k.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url')};};
const sign=(k,payload)=>crypto.sign(null,Buffer.from(`${REPORT_SCHEMA}\n${payload}`),k.privateKey).toString('base64url');
const usage={schema:'awai.murakumo.device-usage.v1',device:'benjamin',kind:'mac','observed-at-ms':1794960000000,ram:{total:17179869184,used:6687244288},'cpu-percent':5,'gpu-percent':12,disk:{free:1,total:2},loaded:null};
const owner=pair(),device={id:'benjamin',kind:'mac',origin:'https://benjamin.example.ts.net:8443',key:owner.pub};
const report=(u=usage,k=owner)=>{const payload=JSON.stringify(u);return {schema:REPORT_SCHEMA,payload,key:k.pub,signature:sign(k.k,payload)};};

test('a report signed by the pinned key verifies',async()=>{const r=await verifyReport(report(),device);assert.equal(r.ok,true);assert.deepEqual(r.usage,usage);});
test('a changed payload is refused',async()=>{const r=report();r.payload=r.payload.replace('"cpu-percent":5','"cpu-percent":6');assert.deepEqual(await verifyReport(r,device),{ok:false,reason:'signature'});});
test('a report signed by another key is refused, even when it names that key',async()=>{assert.deepEqual(await verifyReport(report(usage,pair()),device),{ok:false,reason:'key-not-pinned'});});
test('a signature from another key under the pinned key is refused',async()=>{const r=report();r.signature=sign(pair().k,r.payload);assert.deepEqual(await verifyReport(r,device),{ok:false,reason:'signature'});});
test('a report about another device is refused',async()=>{assert.deepEqual(await verifyReport(report({...usage,device:'jacob'}),device),{ok:false,reason:'device'});assert.deepEqual(await verifyReport(report({...usage,kind:'android'}),device),{ok:false,reason:'device'});});
test('wrong schema, extra fields and oversized payloads are refused',async()=>{
 assert.equal((await verifyReport({...report(),schema:'x'},device)).reason,'schema');
 assert.equal((await verifyReport({...report(),extra:1},device)).reason,'shape');
 assert.equal((await verifyReport(report({...usage,pad:'x'.repeat(MAX_REPORT_BYTES)}),device)).reason,'payload');});
test('the signature covers the schema line (domain separation)',async()=>{const r=report();const raw=crypto.sign(null,Buffer.from(r.payload),owner.k.privateKey).toString('base64url');assert.equal((await verifyReport({...r,signature:raw},device)).reason,'signature');});
test('a response body above the budget is refused',async()=>{await assert.rejects(readReport(new Response('x'.repeat(MAX_REPORT_BYTES+1))),/report-too-large/);await assert.rejects(readReport(new Response('{}',{status:500})),/report-http-500/);
 const r=report();assert.deepEqual(await readReport(new Response(JSON.stringify(r))),r);});

test('pinned devices validate and join the canonical descriptor',()=>{
 assert.deepEqual(devicesProblems([device]),[]);
 assert.deepEqual(devicesProblems([{...device,origin:'http://127.0.0.1:18790'}]),['devices/0/origin']);
 assert.deepEqual(devicesProblems([device,device]),['devices/1/duplicate']);
 assert.deepEqual(devicesProblems([{...device,key:'short'}]),['devices/0/key']);
 const runtime=appRuntime(catalog,[device]);assert.deepEqual(clientRuntimeProblems(runtime,appCapabilities([device]),APP),[]);
 const read=runtime.operations.find(o=>o.capability===USAGE_CAPABILITY);
 assert.deepEqual(read.endpoint,{origin:device.origin,method:'GET',path:'/v1/murakumo/usage'});assert.equal(read.consent,'each-operation');
 assert.equal(clientRuntimeConnectSrc(runtime,appCapabilities([device]),[],APP),'connect-src https://*.cdn.hf.co https://benjamin.example.ts.net:8443 https://huggingface.co');
 assert.deepEqual(appCapabilities([]),['awai.murakumo.model-download']);});
test('the committed devices.json is valid',()=>{assert.deepEqual(devicesProblems(JSON.parse(fs.readFileSync(path.join(here,'../devices.json')))),[]);});

const nbb=(()=>{try{execFileSync('nbb',['--version'],{stdio:'ignore'});return true;}catch{return false;}})();
const reporter=path.join(here,'../node/usage-reporter.cljs'),fx=f=>path.join(here,'fixtures/node',f);
test('reporter parsers read macOS tool output; missing values stay unknown',{skip:!nbb&&'nbb not installed'},()=>{
 const run=(...f)=>JSON.parse(execFileSync('nbb',[reporter,'selftest',...f.map(fx)],{encoding:'utf8'}));
 assert.deepEqual(run('vm_stat.txt','top.txt','ioreg.txt','df.txt'),{'ram-used':6687244288,cpu:5,gpu:12,disk:{free:161881120768,total:245107195904}});
 assert.deepEqual(run('top-none.txt','top-none.txt','ioreg-none.txt','top-none.txt'),{'ram-used':null,cpu:null,gpu:null,disk:null});});
test('a report signed by the nbb reporter verifies in the browser verifier',{skip:(!nbb||process.platform!=='darwin')&&'needs nbb on macOS'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'murakumo-reporter-'));try{
  const key=execFileSync('nbb',[reporter,'init',root,'benjamin'],{encoding:'utf8'}).trim();
  assert.equal(fs.statSync(path.join(root,'usage-key.pem')).mode&0o777,0o600);
  const r=JSON.parse(execFileSync('nbb',[reporter,'report',root],{encoding:'utf8'}));
  const v=await verifyReport(r,{id:'benjamin',kind:'mac',key});assert.equal(v.ok,true,v.reason);
  assert.equal(v.usage.engine,'not-configured');assert.equal(v.usage.loaded,null);assert.ok(v.usage.ram.total>0);
  assert.equal((await verifyReport(r,{id:'benjamin',kind:'mac',key:pair().pub})).reason,'key-not-pinned');
  assert.throws(()=>execFileSync('nbb',[reporter,'init',root,'benjamin','--upstream','http://10.0.0.2:18787'],{stdio:'ignore'}));
 }finally{fs.rmSync(root,{recursive:true,force:true});}});

// The BigInt fallback (WebViews before Chrome 137) must agree with node's Ed25519 everywhere.
const hex=h=>Uint8Array.from(Buffer.from(h,'hex'));
test('the RFC 8032 fallback accepts the RFC 8032 test vectors',async()=>{
 for(const [pk,msg,sig] of [
  ['d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','','e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'],
  ['3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c','72','92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'],
  ['fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025','af82','6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a']])
  assert.equal(await verifyEd25519(hex(pk),hex(sig),hex(msg)),true);});
test('the fallback agrees with node on random keys, messages and tampering',async()=>{
 for(let i=0;i<40;i++){const {k,pub}=pair();const key=Buffer.from(pub,'base64url'),msg=crypto.randomBytes(i*7);const sig=new Uint8Array(crypto.sign(null,msg,k.privateKey));
  assert.equal(await verifyEd25519(key,sig,msg),true);
  const bad=Uint8Array.from(sig);bad[i%64]^=1<<(i%8);assert.equal(await verifyEd25519(key,bad,msg),crypto.verify(null,msg,k.publicKey,bad));
  if(msg.length){const m2=Uint8Array.from(msg);m2[0]^=1;assert.equal(await verifyEd25519(key,sig,m2),false);}
  assert.equal(await verifyEd25519(Buffer.from(pair().pub,'base64url'),sig,msg),false);}
 const {k,pub}=pair();const msg=Buffer.from('x');const sig=new Uint8Array(crypto.sign(null,msg,k.privateKey));
 const big=Uint8Array.from(sig);big.set(Buffer.from('edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010','hex'),32);
 assert.equal(await verifyEd25519(Buffer.from(pub,'base64url'),big,msg),false,'S >= L is refused');});
test('a report verifies through the fallback path too',async()=>{const r=report();const msg=new TextEncoder().encode(`${REPORT_SCHEMA}\n${r.payload}`);
 assert.equal(await verifySignature(Buffer.from(owner.pub,'base64url'),Buffer.from(r.signature,'base64url'),msg,{webCrypto:false}),true);});
