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

test('an unloaded or absent model rejects at the JS caller boundary with inference-denied-or-unavailable, never a result',async()=>{
 // Caller-observable JS boundary (createInferenceClient -> InferenceClientPlugin.kt):
 // Murakumo's confirmation Activity ends provider-side refusals (text 'model-not-loaded', image
 // 'image-model-missing' / 'release-text-model-required') as RESULT_CANCELED + extra "error", and
 // InferenceClientPlugin.kt translates every non-RESULT_OK result other than "cancelled" into the
 // caller-observable rejection 'inference-denied-or-unavailable'. client.js re-throws it verbatim.
 // Readiness comes from info().status (loaded / image.imported). Android runtime and real-model
 // execution are not verified by this JS/source fixture.
 const plugin=fs.readFileSync(new URL('../../../packages/awai-inference/android/network/awai/inference/InferenceClientPlugin.kt',import.meta.url),'utf8');
 assert.match(plugin,/if\(result\.resultCode!=Activity\.RESULT_OK\|\|data==null\)\{invoke\.reject\(if\(data\?\.getStringExtra\("error"\)=="cancelled"\)"inference-cancelled" else "inference-denied-or-unavailable"\);return\}/,'Android plugin maps every non-OK Activity result other than cancelled to inference-denied-or-unavailable');
 assert.match(plugin,/info\.put\("status",st\)/,'Android plugin exposes provider readiness under info.status');
 const clientSrc=fs.readFileSync(new URL('../../../packages/awai-inference/client.js',import.meta.url),'utf8');
 assert.match(clientSrc,/if\(String\(e\)==='inference-cancelled'\)throw Error\('inference-cancelled'\);throw e;/,'client.js passes non-cancelled plugin rejections through verbatim');

 let loaded=false,imageImported=false;const actions=[],providerCodes=[];
 const imageOk=requestId=>({schema:'awai.inference.result.v1',requestId,modality:'image',engine:'stable-diffusion.cpp',imageId:requestId,modelSet:'qwen-image-2.1-turbo-uncensored-ad-q2-k',width:512,height:512,bytes:3,sha256:'a'.repeat(64),dataUrl:'data:image/png;base64,YWJj'});
 const c=createInferenceClient({uuid,invoke:async(cmd,{request})=>{
  assert.equal(cmd,'awai_local_inference');actions.push(request.action);
  if(request.action==='info')return{schema:'awai.inference.client.v1',installed:true,provider:'network.awai.murakumo',modalities:imageImported?['text','image']:['text'],remote:false,status:{schema:'awai.inference.local.v1',engine:'llama.cpp',loaded,loadedModel:loaded?'qwen3-0.6b-q8_0':null,remote:false,image:{imported:imageImported,loaded:false}}};
  if(request.action==='generate'){
   // Simulate InferenceRequestActivity RESULT_CANCELED -> InferenceClientPlugin.generated mapping.
   const refusal=request.modality==='image'?(loaded?'release-text-model-required':(!imageImported?'image-model-missing':null)):(!loaded?'model-not-loaded':null);
   if(refusal){providerCodes.push(refusal);throw refusal==='cancelled'?'inference-cancelled':'inference-denied-or-unavailable';}
   return request.modality==='image'?imageOk(request.requestId):{schema:'awai.inference.result.v1',requestId:request.requestId,modality:'text',engine:'llama.cpp',text:'ok',outputTokens:1};
  }
 }});

 const readiness=await c.info();
 assert.equal(readiness.schema,'awai.inference.client.v1');
 assert.equal(readiness.remote,false);
 assert.equal(readiness.status.loaded,false,'readiness reports no text model loaded');
 assert.equal(readiness.status.image.imported,false,'readiness reports no image model imported');
 assert.deepEqual(readiness.modalities,['text']);

 for(const args of [{prompt:'hi'},{modality:'image',prompt:'a cup'},{prompt:'hi'}])await assert.rejects(c.generate(args),e=>e==='inference-denied-or-unavailable');
 const pending=c.startGeneration({prompt:'hi'});await assert.rejects(pending.result,e=>e==='inference-denied-or-unavailable');
 assert.equal(actions.filter(a=>a==='generate').length,4,'every attempt reached the provider; none was answered with a result');
 assert.deepEqual(providerCodes,['model-not-loaded','image-model-missing','model-not-loaded','model-not-loaded'],'provider refusal codes stay distinct internally before the plugin collapses non-OK results');

 // Once a text model is loaded, text generation succeeds on the same client while image generation
 // still refuses until the text model is released (ImageModels.kt:44).
 loaded=true;
 assert.equal((await c.info()).status.loaded,true);
 assert.equal((await c.generate({prompt:'hi'})).text,'ok');
 imageImported=true;
 await assert.rejects(c.generate({modality:'image',prompt:'a cup'}),e=>e==='inference-denied-or-unavailable');
 assert.equal(providerCodes.at(-1),'release-text-model-required');

 // Releasing the text model with an imported image model set lets image generation succeed.
 loaded=false;
 const imageReady=await c.info();
 assert.equal(imageReady.status.loaded,false);
 assert.equal(imageReady.status.image.imported,true);
 assert.deepEqual(imageReady.modalities,['text','image']);
 assert.equal((await c.generate({modality:'image',prompt:'a cup'})).imageId,uuid());
});

test('provider-side text and image refusal conditions map to RESULT_CANCELED with fixed error codes',()=>{
 // Provider-side refusal boundaries (source-pinned separately from the JS plugin boundary):
 // - Text: Models.generate checks loaded ("model-not-loaded") before Engine.generate, and
 //   native/engine.cpp refuses a null model ("invalid-request").
 // - Image: ImageModels.generate checks !Models.loaded ("release-text-model-required"),
 //   present(c) ("image-model-missing"), and ImageEngine.prepare() ("image-engine-unavailable")
 //   before ImageEngine.generate, and native/image/image.cpp refuses failed context/model load
 //   ("image-model-load-failed") before sd_generate_image.
 // - Activity: InferenceRequestActivity routes both modalities through runCatching -> ErrorCodes.of
 //   -> finishWith (RESULT_CANCELED + fixed error code); RESULT_OK exists only in finishOk.
 // Android runtime and real-model execution are not verified here.
 const K=n=>fs.readFileSync(new URL('../src-tauri/gen/android/app/src/main/java/network/awai/murakumo/'+n,import.meta.url),'utf8');

 // Text provider boundary
 const textGen=K('Models.kt').split('\n').find(l=>l.includes('fun generate('));
 const textNotLoadedAt=textGen.indexOf('check(loaded){"model-not-loaded"}');
 assert.ok(textNotLoadedAt>=0&&textNotLoadedAt<textGen.indexOf('Engine.generate'),'Models.generate refuses model-not-loaded before the text engine runs');
 assert.match(fs.readFileSync(new URL('../native/engine.cpp',import.meta.url),'utf8'),/if\(!model\|\|bytes<1\|\|bytes>8192\|\|count<1\|\|count>256\)\{fail\(env,"invalid-request"\);return nullptr;\}/,'native/engine.cpp refuses when no text model is loaded');

 // Image provider boundary
 const imageModels=K('ImageModels.kt');
 assert.match(imageModels,/fun present\(c:Context\):Boolean=[\s\S]*?f\.isFile&&f\.length\(\)==p\.getLong\("bytes"\)/,'ImageModels.present verifies all pinned image model files exist with exact byte lengths');
 const imageGen=imageModels.slice(imageModels.indexOf('fun generate('));
 const releaseReqAt=imageGen.indexOf('check(!Models.loaded){"release-text-model-required"}');
 const imageMissingAt=imageGen.indexOf('check(present(c)){"image-model-missing"}');
 const imagePrepAt=imageGen.indexOf('try{ImageEngine.prepare()}catch(e:LinkageError){throw IllegalStateException("image-engine-unavailable")}');
 const imageRunAt=imageGen.indexOf('ImageEngine.generate(');
 assert.ok(releaseReqAt>=0&&imageMissingAt>releaseReqAt&&imagePrepAt>imageMissingAt&&imageRunAt>imagePrepAt,'ImageModels.generate enforces text-model release, pinned image-model presence, and engine availability before ImageEngine.generate');
 const imageNative=fs.readFileSync(new URL('../native/image/image.cpp',import.meta.url),'utf8');
 const loadFailAt=imageNative.indexOf('if(!ok(loadStatus)){fail(e,"image-model-load-failed");return nullptr;}');
 assert.ok(loadFailAt>=0&&loadFailAt<imageNative.indexOf('sd_generate_image('),'native/image/image.cpp refuses failed model load before sd_generate_image');

 // Fixed error-code allowlist covers both text and image refusal codes
 const errorCodes=K('ErrorCodes.kt');
 for(const code of ['model-not-loaded','invalid-request','release-text-model-required','image-model-missing','image-engine-unavailable','image-model-load-failed'])assert.ok(errorCodes.includes(`"${code}"`),`ErrorCodes.ALL lists ${code}`);

 // Confirmation Activity routes both modalities through ErrorCodes.of -> finishWith (RESULT_CANCELED)
 const activity=K('InferenceRequestActivity.kt');
 assert.match(activity,/if\(imageJob\)\{\s*val image=ImageModels\.generate\(this,requestId,prompt\)/,'InferenceRequestActivity dispatches image requests to ImageModels.generate');
 assert.match(activity,/\}else\{\s*val text=Models\.generate\(prompt,tokens\)/,'InferenceRequestActivity dispatches text requests to Models.generate');
 assert.match(activity,/onFailure=\{finishWith\(ErrorCodes\.of\(it,"inference-unavailable"\)\)\}/,'failed text and image jobs map through ErrorCodes.of into finishWith');
 assert.match(activity,/private fun finishWith\(code:String\)\{[^}]*check\(code in ErrorCodes\.ALL\);setResult\(RESULT_CANCELED,Intent\(\)\.putExtra\("error",code\)\)/,'finishWith always checks ErrorCodes.ALL and returns RESULT_CANCELED with the fixed error code');
 assert.equal(activity.match(/setResult\(RESULT_OK/g).length,1,'RESULT_OK is set only by finishOk');
 assert.match(activity,/private fun finishOk\(result:Intent\)\{[^}]*setResult\(RESULT_OK,result\)/,'only finishOk emits RESULT_OK');
});
