import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import{mkdir,copyFile,readFile,writeFile}from'node:fs/promises';import{existsSync}from'node:fs';import{execFileSync}from'node:child_process';import path from'node:path';import{fileURLToPath}from'node:url';
// Two apps share this page (client/app.js reads role.js):
//   node scripts/build.mjs          murakumo: network.awai.murakumo, inference, no INTERNET, no network operation
//   node scripts/build.mjs --net    net: network.awai.murakumo.net (apps/murakumo-net), downloads and All devices
const ROLE=process.argv.includes('--net')?'net':'murakumo';
const app=fileURLToPath(new URL('..',import.meta.url)),root=path.resolve(app,'../..'),host=ROLE==='net'?path.join(root,'apps/murakumo-net'):app,dist=path.join(host,'dist');await mkdir(dist,{recursive:true});
const assets=path.join(host,'src-tauri/gen/android/app/src/main/assets');await mkdir(assets,{recursive:true});
for(const file of ['index.html','app.css','app.js','download-contract.js','devices-contract.js','usage-report.js','ed25519.js'])await copyFile(path.join(app,'client',file),path.join(dist,file));
await writeFile(path.join(dist,'role.js'),`export default ${JSON.stringify(ROLE)};\n`);
// AWAI-3307: the canonical broker, byte-exact against the shared pin, and the descriptor it enforces.
{const {createHash}=await import('node:crypto');const hash=b=>createHash('sha256').update(b).digest('hex');const vendor=path.join(root,'otehon/shell/vendor');const pinsFile=JSON.parse(await readFile(path.join(vendor,'PINS.json'),'utf8'));
 for(const [src,dest] of [['kotoba-client-runtime.js','runtime.js'],['kotoba-client-consent.css','consent.css']]){const b=await readFile(path.join(vendor,src));if(hash(b)!==pinsFile.files[src])throw Error('canonical runtime pin drift');await writeFile(path.join(dist,dest),b);}
 // AWAI-3377: owner-pinned devices (devices.json) add one consented usage read each. They ship as a module: the CSP has no 'self' in connect-src.
 const {appRuntime,appCapabilities,devicesProblems}=await import('../client/devices-contract.js');const {runtimeFor}=await import('../client/download-contract.js');
 const devices=JSON.parse(await readFile(path.join(app,'devices.json'),'utf8'));
 const deviceProblems=devicesProblems(devices);if(deviceProblems.length)throw Error('invalid devices.json: '+JSON.stringify(deviceProblems));
 const catalog=JSON.parse(await readFile(path.join(app,'catalog.json'),'utf8'));
 const {clientRuntimeProblems,clientRuntimeConnectSrc}=await import(path.join(vendor,'kotoba-client-runtime.js'));
 let descriptor,capabilities,connect,disclosures={};
 if(ROLE==='murakumo'){
  // No network operation at all: this app has no INTERNET permission (PHI rule).
  descriptor={...runtimeFor({models:[]}),operations:[]};capabilities=[];connect='connect-src ipc: http://ipc.localhost';
  await writeFile(path.join(dist,'devices.js'),'export default [];\n');
 }else{
  // Every operation's consent screen shows a disclosure (KOTOBA-159 finding 9): recipient, country,
  // data, purpose … per capability, written by Legal in apps/murakumo-net/disclosures.json. Without it
  // the build stops; nothing is invented here.
  const file=path.join(host,'disclosures.json');if(!existsSync(file))throw Error('disclosure-pending: apps/murakumo-net/disclosures.json is missing (Legal writes the disclosure for each capability)');
  disclosures=JSON.parse(await readFile(file,'utf8'));
  const r=appRuntime(catalog,devices);descriptor={...r,operations:r.operations.map(o=>({...o,disclosure:disclosures[o.capability]}))};capabilities=appCapabilities(devices);
  await writeFile(path.join(dist,'devices.js'),'export default '+JSON.stringify(devices)+';\n');
 }
 const problems=clientRuntimeProblems(descriptor,capabilities,'https://tauri.localhost');if(problems.length)throw Error('invalid client descriptor: '+JSON.stringify(problems));
 if(ROLE==='net')connect=clientRuntimeConnectSrc(descriptor,capabilities,[],'https://tauri.localhost')+' ipc: http://ipc.localhost';
 await writeFile(path.join(dist,'disclosures.js'),'export default '+JSON.stringify(disclosures)+';\n');
 const tauriFile=path.join(host,'src-tauri/tauri.conf.json'),config=JSON.parse(await readFile(tauriFile,'utf8'));
 config.app.security.csp="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; "+connect+"; object-src 'none'; base-uri 'none'; form-action 'none'";
 await writeFile(tauriFile,JSON.stringify(config,null,2)+'\n');await writeFile(path.join(dist,'descriptor.json'),JSON.stringify(descriptor,null,2));}
await copyFile(path.join(root,'android/client/assets/setup-noto-jp.woff2'),path.join(dist,'noto-jp.woff2'));await copyFile(path.join(root,'android/client/assets/setup-font-OFL.txt'),path.join(dist,'OFL.txt'));
await copyFile(path.join(app,'catalog.json'),path.join(assets,'catalog.json'));
if(ROLE==='murakumo')await copyFile(path.join(app,'pins.json'),path.join(assets,'pins.json'));
const raw=execFileSync('bb',['--classpath',path.join(app,'contracts/src'),'-e',"(require '[awai.inference.contract :as c]) (prn c/contract)"],{encoding:'utf8'});await writeFile(path.join(dist,'source-contract.edn'),raw);
execFileSync('clojure',['-Sdeps',`{:paths ["${path.join(app,'contracts/src')}"] :deps {org.clojure/clojure {:mvn/version "1.12.1"} org.clojure/clojurescript {:mvn/version "1.12.145"}}}`,'-M','-m','cljs.main','-co',`{:output-to "${path.join(dist,'domain.js')}" :output-dir "${path.join(root,'.agent-output/murakumo-cljs')}" :optimizations :advanced}`,'-c','awai.inference.browser'],{cwd:root,stdio:'inherit'});
await writeFile(path.join(dist,'contract.js'),"import './domain.js';export const requestAdmission=window.AwaiInference.admit;\n");
console.log(`Built the ${ROLE==='net'?'Murakumo Net':'Murakumo'} static UI and pinned model contract`);

await distributeUi(dist);

if(ROLE==='murakumo')await copyFile(path.join(app,'image-pins.json'),path.join(assets,'image-pins.json'));
