import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import{mkdir,copyFile,readFile,writeFile}from'node:fs/promises';import{execFileSync}from'node:child_process';import path from'node:path';import{fileURLToPath}from'node:url';
const app=fileURLToPath(new URL('..',import.meta.url)),root=path.resolve(app,'../..'),dist=path.join(app,'dist');await mkdir(dist,{recursive:true});
for(const file of ['index.html','app.css','app.js','download-contract.js'])await copyFile(path.join(app,'client',file),path.join(dist,file));
// AWAI-3307: the canonical broker, byte-exact against the shared pin, and the download descriptor it enforces.
{const {createHash}=await import('node:crypto');const hash=b=>createHash('sha256').update(b).digest('hex');const vendor=path.join(root,'otehon/shell/vendor');const pinsFile=JSON.parse(await readFile(path.join(vendor,'PINS.json'),'utf8'));
 for(const [src,dest] of [['kotoba-client-runtime.js','runtime.js'],['kotoba-client-consent.css','consent.css']]){const b=await readFile(path.join(vendor,src));if(hash(b)!==pinsFile.files[src])throw Error('canonical runtime pin drift');await writeFile(path.join(dist,dest),b);}
 const {runtimeFor,DOWNLOAD_CAPABILITY}=await import('../client/download-contract.js');const descriptor=runtimeFor(JSON.parse(await readFile(path.join(app,'catalog.json'),'utf8')));
 const {clientRuntimeProblems,clientRuntimeConnectSrc}=await import(path.join(vendor,'kotoba-client-runtime.js'));
 const problems=clientRuntimeProblems(descriptor,[DOWNLOAD_CAPABILITY],'http://tauri.localhost');if(problems.length)throw Error('invalid download descriptor: '+JSON.stringify(problems));
 const tauriFile=path.join(app,'src-tauri/tauri.conf.json'),config=JSON.parse(await readFile(tauriFile,'utf8'));
 config.app.security.csp="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; "+clientRuntimeConnectSrc(descriptor,[DOWNLOAD_CAPABILITY],[],'http://tauri.localhost')+" ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'";
 await writeFile(tauriFile,JSON.stringify(config,null,2)+'\n');await writeFile(path.join(dist,'descriptor.json'),JSON.stringify(descriptor,null,2));}
await copyFile(path.join(root,'android/client/assets/setup-noto-jp.woff2'),path.join(dist,'noto-jp.woff2'));await copyFile(path.join(root,'android/client/assets/setup-font-OFL.txt'),path.join(dist,'OFL.txt'));
const pins=JSON.parse(await readFile(path.join(app,'pins.json'),'utf8'));await mkdir(path.join(app,'src-tauri/gen/android/app/src/main/assets'),{recursive:true});await copyFile(path.join(app,'pins.json'),path.join(app,'src-tauri/gen/android/app/src/main/assets/pins.json'));await copyFile(path.join(app,'catalog.json'),path.join(app,'src-tauri/gen/android/app/src/main/assets/catalog.json'));
const raw=execFileSync('bb',['--classpath',path.join(app,'contracts/src'),'-e',"(require '[awai.inference.contract :as c]) (prn c/contract)"],{encoding:'utf8'});await writeFile(path.join(dist,'source-contract.edn'),raw);
execFileSync('clojure',['-Sdeps',`{:paths ["${path.join(app,'contracts/src')}"] :deps {org.clojure/clojure {:mvn/version "1.12.1"} org.clojure/clojurescript {:mvn/version "1.12.145"}}}`,'-M','-m','cljs.main','-co',`{:output-to "${path.join(dist,'domain.js')}" :output-dir "${path.join(root,'.agent-output/murakumo-cljs')}" :optimizations :advanced}`,'-c','awai.inference.browser'],{cwd:root,stdio:'inherit'});
await writeFile(path.join(dist,'contract.js'),"import './domain.js';export const requestAdmission=window.AwaiInference.admit;\n");
console.log('Built Murakumo static UI and pinned model contract');

await distributeUi(dist);

await copyFile(path.join(app,'image-pins.json'),path.join(app,'src-tauri/gen/android/app/src/main/assets/image-pins.json'));
