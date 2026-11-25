import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import{createInferenceClient}from'../../../packages/awai-inference/client.js';
const context={window:{},TextEncoder,console};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../dist/domain.js',import.meta.url),'utf8'),context);const admit=context.window.AwaiInference.admit;
test('actual compiled CLJC admits bounded UTF-8 text and fixed-set images',()=>{assert.equal(admit('text','hi',128),'accepted');assert.equal(admit('image','hi',128),'accepted');assert.equal(admit('text','あ'.repeat(3000),128),'prompt-limit');assert.equal(admit('text','hi',257),'token-limit');assert.equal(admit('text','hi',1.5),'token-limit');});
const uuid=()=> '11111111-1111-4111-a111-111111111111';
test('unsupported and oversized client requests never invoke a native app',async()=>{let calls=0;const c=createInferenceClient({uuid,invoke:()=>{calls++;}});for(const args of [{modality:'video',prompt:'x'},{prompt:'あ'.repeat(3000)},{prompt:'x',maxTokens:500},{prompt:'x',maxTokens:1.5}])await assert.rejects(c.generate(args));assert.equal(calls,0);});
test('app result binds request, engine and modality and propagates denial',async()=>{const good={schema:'awai.inference.result.v1',requestId:uuid(),modality:'text',engine:'llama.cpp',text:'result'};const c=createInferenceClient({uuid,invoke:async(cmd,{request})=>{assert.equal(cmd,'awai_local_inference');assert.equal(request.action,'generate');return good;}});assert.equal((await c.generate({prompt:'hi'})).text,'result');for(const patch of [{requestId:'wrong'},{engine:'remote'},{modality:'image'},{text:'x'.repeat(65537)}])await assert.rejects(createInferenceClient({uuid,invoke:async()=>({...good,...patch})}).generate({prompt:'hi'}));await assert.rejects(createInferenceClient({uuid,invoke:async()=>{throw Error('denied')}}).generate({prompt:'hi'}));});
test('a missing native provider fails without a network fallback',async()=>{await assert.rejects(createInferenceClient({uuid}).generate({prompt:'hi'}),/unavailable/);});

test('image output and save receipts bind actual request and fixed model set',async()=>{const good={schema:'awai.inference.result.v1',requestId:uuid(),modality:'image',engine:'stable-diffusion.cpp',imageId:uuid(),modelSet:'qwen-image-2.1-turbo-uncensored-ad-q2-k',width:512,height:512,bytes:3,sha256:'a'.repeat(64),dataUrl:'data:image/png;base64,YWJj'};assert.equal((await createInferenceClient({uuid,invoke:async()=>good}).generate({modality:'image',prompt:'a cup'})).imageId,uuid());for(const patch of [{engine:'remote'},{width:1024},{modelSet:'other'},{imageId:'wrong'},{dataUrl:'https://remote/image.png'},{sha256:'x'},{bytes:NaN}])await assert.rejects(createInferenceClient({uuid,invoke:async()=>({...good,...patch})}).generate({modality:'image',prompt:'a cup'}));let calls=0;await assert.rejects(createInferenceClient({uuid,invoke:async()=>{calls++}}).saveImage('../../file'));assert.equal(calls,0);await assert.rejects(createInferenceClient({uuid,invoke:async()=>({saved:true,readbackVerified:false})}).saveImage(uuid()));});
test('local image references are conversation scoped and digest bound',async()=>{const scope={botId:'profile:synthetic',sessionId:uuid()},imageId=uuid(),hash='a'.repeat(64);let calls=[];const result={schema:'awai.inference.result.v1',imageId,requestId:imageId,modality:'image',engine:'stable-diffusion.cpp',modelSet:'qwen-image-2.1-turbo-uncensored-ad-q2-k',width:512,height:512,bytes:3,sha256:hash,dataUrl:'data:image/png;base64,YWJj'};const c=createInferenceClient({uuid,invoke:async(_,a)=>{calls.push(a.request);return result}});await c.readImage(imageId,scope,hash);assert.deepEqual(calls[0],{action:'readImage',imageId,conversation:scope});await assert.rejects(c.readImage(imageId,scope,'b'.repeat(64)),/mismatch/);const n=calls.length;await assert.rejects(c.generate({modality:'image',prompt:'x',conversation:{botId:'profile:other',sessionId:'default'}}));assert.equal(calls.length,n);await assert.rejects(c.readImage('../../private',scope,hash));});
test('caller admission stays an allowlist plus signature match, and names Rodo and Karute',()=>{const src=fs.readFileSync(new URL('../src-tauri/gen/android/app/src/main/java/network/awai/murakumo/Models.kt',import.meta.url),'utf8');const line=src.split('\n').find((l)=>l.includes('val allowed=setOf('));assert.ok(line.includes('"network.itonami.rodo"'));assert.ok(line.includes('"network.itonami.karute"'));assert.match(src,/caller in allowed && c\.packageManager\.checkSignatures\(c\.packageName,caller!!\)==android\.content\.pm\.PackageManager\.SIGNATURE_MATCH/);});

test('cancel carries exactly the requestId and accepts only the two documented answers',async()=>{
 const calls=[];const c=createInferenceClient({uuid,invoke:async(cmd,a)=>{calls.push(a.request);return{cancelled:true};}});
 assert.deepEqual(await c.cancel(uuid()),{cancelled:true});
 assert.deepEqual(calls,[{action:'cancel',requestId:uuid()}]);
 const n=calls.length;await assert.rejects(c.cancel('not-a-uuid'),/invalid-request-id/);assert.equal(calls.length,n,'an invalid requestId never reaches the native app');
 const idle=createInferenceClient({uuid,invoke:async()=>({cancelled:false,reason:'not-running'})});
 assert.deepEqual(await idle.cancel(uuid()),{cancelled:false,reason:'not-running'});
 for(const bad of [{cancelled:false},{cancelled:true,reason:'not-running'},{cancelled:false,reason:'busy'},{}])await assert.rejects(createInferenceClient({uuid,invoke:async()=>bad}).cancel(uuid()),/invalid-cancel-result/);
});

test('a cancelled generate rejects with the fixed code, a denial keeps its own',async()=>{
 const cancelled=createInferenceClient({uuid,invoke:async()=>{throw'inference-cancelled';}});
 await assert.rejects(cancelled.generate({prompt:'hi'}),e=>e.message==='inference-cancelled');
 await assert.rejects(cancelled.generate({modality:'image',prompt:'a cup'}),e=>e.message==='inference-cancelled');
 const denied=createInferenceClient({uuid,invoke:async()=>{throw'inference-denied-or-unavailable';}});
 await assert.rejects(denied.generate({prompt:'hi'}),e=>String(e).includes('inference-denied-or-unavailable'));
});

test('a public generation handle can cancel a pending result on the same client', async () => {
 const ids = [uuid(), '22222222-2222-4222-a222-222222222222', '33333333-3333-4333-a333-333333333333'];
 const [activeId, rejectedId, nextId] = ids;
 let rejectActive;
 const client = createInferenceClient({
  uuid: () => ids.shift(),
  invoke: async (command, {request}) => {
   assert.equal(command, 'awai_local_inference');
   if (request.action === 'cancel') {
    if (request.requestId !== activeId || !rejectActive) return {cancelled:false, reason:'not-running'};
    rejectActive('inference-cancelled');
    rejectActive = undefined;
    return {cancelled:true};
   }
   if (request.requestId === activeId) return new Promise((_, reject) => { rejectActive = reject; });
   if (rejectActive) throw 'busy';
   return {schema:'awai.inference.result.v1', requestId:request.requestId, modality:'text', engine:'llama.cpp', text:'next'};
  }
 });

 const active = client.startGeneration({prompt:'pending'});
 assert.equal(active.requestId, activeId);
 let settled = false;
 const rejected = assert.rejects(active.result, {message:'inference-cancelled'}).then(() => { settled = true; });
 const refused = client.startGeneration({prompt:'while busy'});
 assert.equal(refused.requestId, rejectedId);
 await assert.rejects(refused.result, error => error === 'busy');
 assert.deepEqual(await client.cancel(refused.requestId), {cancelled:false, reason:'not-running'});
 assert.equal(settled, false);
 assert.deepEqual(await client.cancel(active.requestId), {cancelled:true});
 await rejected;
 assert.deepEqual(await client.cancel(active.requestId), {cancelled:false, reason:'not-running'});
 const next = await client.generate({prompt:'next'});
 assert.equal(next.requestId, nextId);
 assert.equal(next.text, 'next');
});
