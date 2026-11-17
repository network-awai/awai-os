import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import{mkdir,copyFile,readFile,writeFile}from'node:fs/promises';import{execFileSync}from'node:child_process';import path from'node:path';import{fileURLToPath}from'node:url';
const app=fileURLToPath(new URL('..',import.meta.url)),root=path.resolve(app,'../..'),dist=path.join(app,'dist');await mkdir(dist,{recursive:true});
for(const file of ['index.html','app.css','app.js'])await copyFile(path.join(app,'client',file),path.join(dist,file));
await copyFile(path.join(root,'android/client/assets/setup-noto-jp.woff2'),path.join(dist,'noto-jp.woff2'));await copyFile(path.join(root,'android/client/assets/setup-font-OFL.txt'),path.join(dist,'OFL.txt'));
const pins=JSON.parse(await readFile(path.join(app,'pins.json'),'utf8'));await mkdir(path.join(app,'src-tauri/gen/android/app/src/main/assets'),{recursive:true});await copyFile(path.join(app,'pins.json'),path.join(app,'src-tauri/gen/android/app/src/main/assets/pins.json'));
const raw=execFileSync('bb',['--classpath',path.join(app,'contracts/src'),'-e',"(require '[awai.inference.contract :as c]) (prn c/contract)"],{encoding:'utf8'});await writeFile(path.join(dist,'source-contract.edn'),raw);
execFileSync('clojure',['-Sdeps',`{:paths ["${path.join(app,'contracts/src')}"] :deps {org.clojure/clojure {:mvn/version "1.12.1"} org.clojure/clojurescript {:mvn/version "1.12.145"}}}`,'-M','-m','cljs.main','-co',`{:output-to "${path.join(dist,'domain.js')}" :output-dir "${path.join(root,'.agent-output/murakumo-cljs')}" :optimizations :advanced}`,'-c','awai.inference.browser'],{cwd:root,stdio:'inherit'});
await writeFile(path.join(dist,'contract.js'),"import './domain.js';export const requestAdmission=window.AwaiInference.admit;\n");
console.log('Built Murakumo static UI and pinned model contract');

await distributeUi(dist);

await copyFile(path.join(app,'image-pins.json'),path.join(app,'src-tauri/gen/android/app/src/main/assets/image-pins.json'));
