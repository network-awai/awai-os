#!/usr/bin/env node
// PHI rule lint for the local inference path (karute passes medical text through it).
// The prompt and the output must not reach a log, a metric, a crash report or the network, so the
// files below may not call Android logging, console.*, stdout/stderr printing or any network API, and
// every error they hand on must be a fixed code listed in ErrorCodes.kt.
//
//   node apps/murakumo/scripts/phi-path-lint.mjs [--root DIR]    exit 1 and list violations
//
// DIR is the repository root (default: this checkout). test/phi-path.test.mjs runs it on the tree and,
// as the negative control, on copies with one violation injected per rule.
import {readFileSync,existsSync,readdirSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';

const K='apps/murakumo/src-tauri/gen/android/app/src/main/java/network/awai/murakumo/';
/** Every source file the prompt or the output passes through, from the consumer's page to the engine. */
export const FILES=[
 'packages/awai-inference/client.js',
 'packages/awai-inference/android/network/awai/inference/InferenceClientPlugin.kt',
 'apps/murakumo/src-tauri/src/lib.rs',
 K+'ErrorCodes.kt',K+'InferencePlugin.kt',K+'InferenceRequestActivity.kt',K+'InferenceStatusProvider.kt',
 K+'Models.kt',K+'ImageModels.kt',K+'Engine.java',K+'ImageEngine.java',K+'MainActivity.kt','apps/murakumo/src-tauri/src/main.rs',
 'apps/murakumo/native/engine.cpp','apps/murakumo/native/image/image.cpp'];
export const ERROR_CODES=K+'ErrorCodes.kt';
/** Source files under the scanned directories that are not on the Android inference path, each with why. */
export const NOT_ON_PATH={
 'apps/murakumo/native/image/macos/main.cpp':'macOS image helper (JUN-1424); a separate Mac executable, never in the Android APK',
};
/** Directories skipped by the completeness check, each with why. */
export const NOT_ON_PATH_DIRS={
 [K+'generated/']:'wry/Tauri WebView host written by the Tauri CLI at build time (gitignored). Its logging and devtools are gated by BuildConfig.DEBUG and debug_assertions; check-release.py proves a release APK has them off',
};
/** Every source file in these directories must be in FILES or NOT_ON_PATH, so a new file cannot skip the lint. */
export const DIRS=[K,'apps/murakumo/native/','packages/awai-inference/','apps/murakumo/src-tauri/src/'];
const SOURCE=/\.(?:kt|kts|java|c|cc|cpp|cxx|h|hpp|m|mm|js|mjs|cjs|ts|rs)$/;
function sources(root,dir){const out=[];const walk=d=>{if(!existsSync(path.join(root,d))||d in NOT_ON_PATH_DIRS)return;for(const e of readdirSync(path.join(root,d),{withFileTypes:true})){const rel=d+e.name;if(e.isDirectory())walk(rel+'/');else if(SOURCE.test(e.name))out.push(rel);}};walk(dir);return out;}

const jvm=[
 ['android-log',/\bandroid\.util\.Log\b|(?<![\w.])Log\.(?:v|d|i|w|e|wtf|println)\s*\(/],
 ['print',/printStackTrace|System\.(?:out|err)\b|(?<![\w.])print(?:ln)?\s*\(/],
 ['network',/\bjava\.net\.|\bjavax\.net\.|okhttp|HttpsURLConnection|HttpURLConnection|(?<![\w.])URL\s*\(|\bSocket\b|DatagramSocket|android\.net\.http|WebSocket|Retrofit|Volley|Cronet|io\.ktor|DownloadManager/i],
 ['exception-text',/\.message\b|localizedMessage|stackTraceToString|getStackTrace/]];
const native=[
 ['android-log',/__android_log|android\/log\.h/],
 ['print',/(?<![\w.])(?:f|s|vf|v)?printf\s*\((?!\s*\))|std::(?:cout|cerr|clog)|(?<![\w.])f?puts\s*\(|\bsyslog\b/],
 ['network',/sys\/socket\.h|netdb\.h|arpa\/inet\.h|(?<![\w.:])(?:socket|connect|getaddrinfo|gethostbyname|sendto|recvfrom)\s*\(|\bcurl\b|httplib/i],
 ['exception-text',/\.what\s*\(\s*\)/]];
const js=[
 ['console',/\bconsole\s*\.|\bdebugger\b/],
 ['network',/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|RTCPeerConnection|\.src\s*=/],
 ['exception-text',/\.message\b|\.stack\b/]];
const rust=[
 ['print',/\b(?:e?println|e?print|dbg)!|\blog::|\btracing::|\benv_logger\b/],
 ['network',/\bstd::net\b|reqwest|\bureq\b|\bhyper\b|TcpStream|UdpSocket/]];
const rulesFor=f=>f.endsWith('.kt')||f.endsWith('.java')?jvm:f.endsWith('.cpp')?native:f.endsWith('.js')?js:f.endsWith('.rs')?rust:null;

/** Fixed codes thrown, returned or rejected in the file, and error expressions that are not fixed codes. */
function errorUse(text){
 const codes=[];const loose=[];let m;
 const literal=/^"[a-z0-9-]+"$/,ternary=/^[\w.!()]+\s*\?\s*"[a-z0-9-]+"\s*:\s*"[a-z0-9-]+"$/;
 for(const re of [/\)\{"([^"]*)"\}/g,/finishWith\("([^"]*)"\)/g,/ErrorCodes\.of\(\s*e\s*,\s*"([^"]*)"\)/g,/invoke\.reject\("([^"]*)"\)/g])
  while((m=re.exec(text)))codes.push(m[1]);
 // Exception messages and native failure codes: a literal code (or a choice of two), nothing built from data.
 for(const re of [/\b\w*Exception\(([^()]*(?:\([^()]*\))?[^()]*)\)/g,/\bfail\(\s*(?:env|e)\s*,([^;]*?)\);/g]){
  while((m=re.exec(text))){const a=m[1].trim();if(a===''||a==='e')continue;
   if(/^ErrorCodes\.of\(\s*e\s*,\s*"[a-z0-9-]+"\s*\)$/.test(a))continue; // fixed code, its fallback is checked above
   if(literal.test(a)||ternary.test(a))codes.push(...[...a.matchAll(/"([^"]*)"/g)].map(x=>x[1]));else loose.push(a);}
 }
 for(const re of [/invoke\.reject\(([^)]*)\)/g,/finishWith\(([^)]*)\)/g])
  while((m=re.exec(text))){const a=m[1].trim();if(!literal.test(a)&&!a.startsWith('ErrorCodes.of(')&&a!=='code'&&a!=='code:String')loose.push(a);}
 return {codes,loose};
}

export function allowedCodes(root){
 const src=readFileSync(path.join(root,ERROR_CODES),'utf8').split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');const body=(src.match(/ALL:Set<String> = setOf\(([\s\S]*?)\)\s*\n/)||[,''])[1];
 return new Set([...body.matchAll(/"([a-z0-9-]+)"/g)].map(m=>m[1]));
}

/** Violations in the inference path under root: [{file,line,rule,text}]. */
export function scan(root){
 const out=[];const allowed=allowedCodes(root);
 for(const d of DIRS)for(const f of sources(root,d))if(!FILES.includes(f)&&!(f in NOT_ON_PATH))out.push({file:f,line:0,rule:'unlisted-source-file',text:'add it to FILES or, with a reason, to NOT_ON_PATH'});
 for(const f of FILES){
  const full=path.join(root,f);if(!existsSync(full)){out.push({file:f,line:0,rule:'missing-file',text:''});continue;}
  const text=readFileSync(full,'utf8');const lines=text.split('\n');const rules=rulesFor(f);
  lines.forEach((l,i)=>{for(const [rule,re] of rules){if(rule==='exception-text'&&f===ERROR_CODES)continue;if(re.test(l))out.push({file:f,line:i+1,rule,text:l.trim().slice(0,160)});}});
  // Codes are checked where Murakumo raises them; the consumer plugin's own codes stay in that plugin.
  if(f.startsWith('apps/murakumo/')&&!f.endsWith('.rs')){
   const {codes,loose}=errorUse(text);
   for(const c of codes)if(!allowed.has(c))out.push({file:f,line:0,rule:'unlisted-error-code',text:c});
   for(const a of loose)out.push({file:f,line:0,rule:'non-fixed-error',text:a});
  }
 }
 return out;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const i=process.argv.indexOf('--root');const root=i>0?path.resolve(process.argv[i+1]):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
 const v=scan(root);for(const x of v)console.log(`FAIL ${x.rule} ${x.file}:${x.line} ${x.text}`);
 console.log(v.length?`${v.length} violation(s) in the inference path`:`inference path clean: ${FILES.length} files, no logging, printing, network API or free-form error text`);
 process.exitCode=v.length?1:0;
}
