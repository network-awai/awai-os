// PHI rule checks for the local inference path (synthetic data only; no device, model or network).
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {FILES,NET_FILES,ERROR_CODES,NOT_ON_PATH,scan,allowedCodes} from '../scripts/phi-path-lint.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const lint=path.join(root,'apps/murakumo/scripts/phi-path-lint.mjs');
const K='apps/murakumo/src-tauri/gen/android/app/src/main/java/network/awai/murakumo/';
const copy=()=>{const d=mkdtempSync(path.join(tmpdir(),'phi-lint-'));for(const f of [...FILES,...NET_FILES]){mkdirSync(path.dirname(path.join(d,f)),{recursive:true});copyFileSync(path.join(root,f),path.join(d,f));}return d;};
const inject=(d,file,line)=>{const p=path.join(d,file);writeFileSync(p,readFileSync(p,'utf8')+'\n'+line+'\n');};

test('the inference path has no logging, printing, network API or free-form error text',()=>{
 assert.deepEqual(scan(root),[]);
 const run=spawnSync(process.execPath,[lint],{encoding:'utf8'});assert.equal(run.status,0,run.stdout);
});

// Negative control: each rule must fail the real CLI on a copy of the tree with one violation added.
const NK='apps/murakumo-net/src-tauri/gen/android/app/src/main/java/network/awai/murakumo/net/';
const violations=[
 ['android-log',NK+'NetPlugin.kt',' fun leak(u:String){android.util.Log.d("Net",u)}'],
 ['exception-text',NK+'NetPlugin.kt',' fun leak(i:Invoke,e:Exception){i.reject(e.message?:"busy")}'],
 ['unlisted-error-code',NK+'NetPlugin.kt',' fun leak(invoke:Invoke){invoke.reject("url-https-example-invalid")}'],
 ['print','apps/murakumo-net/src-tauri/src/lib.rs','fn leak(u:&str){eprintln!("{u}");}'],
 ['android-log',K+'InferenceRequestActivity.kt','  android.util.Log.d("Awai",prompt)'],
 ['android-log',K+'Models.kt',' fun leak(p:String){Log.i("Awai",p)}'],
 ['print',K+'InferencePlugin.kt',' fun leak(e:Exception){e.printStackTrace()}'],
 ['print',K+'Models.kt',' fun leak(p:String){println(p)}'],
 ['network',K+'Models.kt','import java.net.URL'],
 ['network',K+'ImageModels.kt',' val client=okhttp3.OkHttpClient()'],
 ['network','packages/awai-inference/android/network/awai/inference/InferenceClientPlugin.kt',' val s=java.net.Socket("example.invalid",443)'],
 ['exception-text',K+'InferencePlugin.kt',' fun leak(i:Invoke,e:Exception){i.reject(e.message?:"inference-failed")}'],
 ['non-fixed-error',K+'Models.kt',' fun leak(p:String):Nothing=throw IllegalStateException("bad-"+p)'],
 ['unlisted-error-code',K+'Models.kt',' fun leak(){check(false){"not-a-listed-code"}}'],
 ['android-log','apps/murakumo/native/engine.cpp','#include <android/log.h>'],
 ['android-log','apps/murakumo/native/engine.cpp','void leak(const char*p){__android_log_print(4,"Awai","%s",p);}'],
 ['print','apps/murakumo/native/engine.cpp','void leak(const char*p){fprintf(stderr,"%s",p);}'],
 ['network','apps/murakumo/native/image/image.cpp','#include <sys/socket.h>'],
 ['network','apps/murakumo/native/engine.cpp','int leak(){return socket(2,1,0);}'],
 ['non-fixed-error','apps/murakumo/native/engine.cpp','void leak(JNIEnv*env,std::string p){fail(env,p.c_str());}'],
 ['console','packages/awai-inference/client.js','console.log("synthetic prompt");'],
 ['network','packages/awai-inference/client.js','fetch("https://example.invalid",{method:"POST",body:"synthetic"});'],
 ['network','packages/awai-inference/client.js','navigator.sendBeacon("https://example.invalid","synthetic");'],
 ['print','apps/murakumo/src-tauri/src/lib.rs','fn leak(p:&str){println!("{p}");}'],
 ['network','apps/murakumo/src-tauri/src/lib.rs','fn leak(){let _=std::net::TcpStream::connect("example.invalid:443");}'],
];
for(const [rule,file,line] of violations)test(`negative control: ${rule} in ${path.basename(file)} fails the lint`,()=>{
 const d=copy();try{inject(d,file,line);
  const found=scan(d);assert.ok(found.some(v=>v.rule===rule&&v.file===file),JSON.stringify(found));
  const run=spawnSync(process.execPath,[lint,'--root',d],{encoding:'utf8'});assert.equal(run.status,1,run.stdout);assert.match(run.stdout,new RegExp('FAIL '+rule));
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('a missing inference file fails the lint instead of passing silently',()=>{
 const d=copy();try{rmSync(path.join(d,K+'Models.kt'));assert.ok(scan(d).some(v=>v.rule==='missing-file'));}finally{rmSync(d,{recursive:true,force:true});}
});

test('the allowlist holds only short fixed codes, and ErrorCodes.of never returns the message itself',()=>{
 const codes=allowedCodes(root);assert.ok(codes.size>30);for(const c of codes)assert.match(c,/^[a-z0-9-]{1,60}$/);
 for(const c of ['busy','cancelled','timeout','context-limit','inference-failed','image-generation-failed','caller-denied'])assert.ok(codes.has(c),c);
 const src=readFileSync(path.join(root,ERROR_CODES),'utf8');assert.match(src,/return ALL\.firstOrNull\{it==message\}\?:fallback/);assert.match(src,/check\(fallback in ALL\)/);
});

test('the confirmation Activity keeps every window out of screenshots and Recents',()=>{
 const src=readFileSync(path.join(root,K+'InferenceRequestActivity.kt'),'utf8');
 assert.match(src,/super\.onCreate\(saved\)\n\s*secure\(window\);setRecentsScreenshotEnabled\(false\)/,'activity window secured before any content');
 assert.match(src,/\.create\(\)\.apply\{secure\(window!!\)\}\.show\(\)/,'the dialog has its own window, secured before show');
 assert.match(src,/FLAG_SECURE,WindowManager\.LayoutParams\.FLAG_SECURE/);
 assert.doesNotMatch(src,/\.show\(\)[\s\S]*\.show\(\)/,'no second, unsecured dialog');
});

test('negative control: a new source file on the path that is not listed fails the lint',()=>{
 for(const f of [K+'PhiExport.kt','apps/murakumo/native/extra.cpp','packages/awai-inference/android/network/awai/inference/Upload.kt','apps/murakumo-net/src-tauri/gen/android/app/src/main/java/network/awai/murakumo/net/Uploader.kt']){
  const d=copy();try{mkdirSync(path.dirname(path.join(d,f)),{recursive:true});writeFileSync(path.join(d,f),'// synthetic\n');
   assert.ok(scan(d).some(v=>v.rule==='unlisted-source-file'&&v.file===f),f);
   const run=spawnSync(process.execPath,[lint,'--root',d],{encoding:'utf8'});assert.equal(run.status,1,run.stdout);
  }finally{rmSync(d,{recursive:true,force:true});}
 }
 for(const [f,why] of Object.entries(NOT_ON_PATH))assert.ok(why.length>20,f);
});

test('PHI callers get no prompt text on screen and no image modality',()=>{
 const models=readFileSync(path.join(root,K+'Models.kt'),'utf8');assert.match(models,/val phiCallers=setOf\("network\.itonami\.karute"\)/);
 const src=readFileSync(path.join(root,K+'InferenceRequestActivity.kt'),'utf8');
 assert.match(src,/val phi=caller in Models\.phiCallers\n\s*if\(phi&&modality!="text"\)\{finishWith\("unsupported-modality"\);return\}/,'image refused for PHI callers before any dialog');
 assert.match(src,/\(if\(phi\)"健康の情報を含む \$\{[^}]+\} 文字のテキスト（内容はこの画面に出しません）" else prompt\.take\(240\)\)/,'PHI callers see length and category only');
 assert.ok(src.indexOf('if(phi&&modality')<src.indexOf('AlertDialog.Builder'),'refusal precedes the dialog');
});

// Dev review #430: what another app (Murakumo Net holds INTERNET) reads must not show when a PHI job runs.
const USAGE_STRINGS=new Set(['awai.murakumo.device-usage.v1','this-device','android','schema','device','kind','model-name','observed-at-ms','ram','total','used',
 'cpu-percent','app-cpu-percent','gpu-percent','disk','free','loaded','model','context','state','since-ms','busy','idle','unknown','loading']);
function usageProblems(src){
 const i=src.indexOf('@Synchronized fun usage(');if(i<0)return ['no usage function'];const body=src.slice(i,src.indexOf('\n\n',i)>0?src.indexOf('\n\n',i):undefined);
 const p=[];for(const m of body.matchAll(/"([^"]*)"/g))if(!USAGE_STRINGS.has(m[1]))p.push('string outside the fixed schema: '+m[1]);
 for(const [what,re] of [['used RAM',/put\("used",if\(forOtherApp\)JSONObject\.NULL/],['app CPU',/put\("app-cpu-percent",if\(forOtherApp\)JSONObject\.NULL/],['job state',/put\("state",if\(forOtherApp\)"unknown"/],['load time',/put\("since-ms",coarse\(/]])
  if(!re.test(body))p.push(what+' is not withheld for other apps');
 return p;
}
test('usage for another app is fixed-schema numbers and enums, with no live job state',()=>{
 const src=readFileSync(path.join(root,K+'Models.kt'),'utf8');assert.deepEqual(usageProblems(src),[]);
 assert.match(src,/put\("busy",if\(forOtherApp\)JSONObject\.NULL else busy\.get\(\)\)/,'status hides busy from other apps');
 assert.match(src,/ImageModels\.status\(c\)\.apply\{if\(forOtherApp\)put\("progress",JSONObject\.NULL\)\}/,'status hides image progress from other apps');
 const provider=readFileSync(path.join(root,K+'InferenceStatusProvider.kt'),'utf8');
 assert.match(provider,/Models\.status\(c,forOtherApp=!self\)/);assert.match(provider,/Models\.usage\(c,forOtherApp=true\)/);assert.doesNotMatch(provider,/Models\.(?:status|usage)\(c\)/);
});
test('negative control: a new field, a live state or an unwithheld value in usage fails',()=>{
 const src=readFileSync(path.join(root,K+'Models.kt'),'utf8');
 for(const [what,from,to] of [['new field','.put("loaded",loadedJson','.put("lastPrompt",lastPrompt).put("loaded",loadedJson'],
   ['live state','put("state",if(forOtherApp)"unknown" else','put("state",if(forOtherApp&&false)"unknown" else'],
   ['used RAM','put("used",if(forOtherApp)JSONObject.NULL else','put("used",if(false)JSONObject.NULL else']]){
  assert.ok(src.includes(from),what);assert.ok(usageProblems(src.replace(from,to)).length>0,what);
 }
});
