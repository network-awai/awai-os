import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import{resolve}from'node:path';import{createHash}from'node:crypto';
const app=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(app,'../..'),out=resolve(app,'dist'),hash=b=>createHash('sha256').update(b).digest('hex');await mkdir(out,{recursive:true});
for(const n of ['index.html','style.css','app.js','i18n.js','sync.js','sync-contract.js','bounded-response.js'])await copyFile(resolve(app,'src',n),resolve(out,n));
await copyFile(resolve(app,'generated/core.js'),resolve(out,'core.js'));await copyFile(resolve(app,'generated/receipt.js'),resolve(out,'receipt.js'));await copyFile(resolve(repo,'packages/awai-shell/host.js'),resolve(out,'host.js'));await copyFile(resolve(repo,'android/client/assets/setup-noto-jp.woff2'),resolve(out,'noto-jp.woff2'));
const vendor=resolve(repo,'otehon/shell/vendor'),pins=JSON.parse(await readFile(resolve(vendor,'PINS.json'),'utf8'));
for(const [src,dest]of [['kotoba-client-runtime.js','runtime.js']]){const b=await readFile(resolve(vendor,src));if(hash(b)!==pins.files[src])throw Error('canonical runtime pin drift');await writeFile(resolve(out,dest),b);}
const {runtimeFor}=await import('../src/sync-contract.js');const origin=process.env.AWAI_DRIVE_SYNC_ORIGIN||'';
const descriptor=runtimeFor(origin);
// Receipt keys are pinned per origin in receipt-trust.json (AWAI-3314). An origin listed there must return a
// receipt signed by one of these keys; rotating the service key needs a rebuild. Other origins get none.
const trust=JSON.parse(await readFile(resolve(app,'receipt-trust.json'),'utf8')),receiptKeys=origin&&Object.hasOwn(trust,origin)?trust[origin]:null;
if(receiptKeys&&!(Array.isArray(receiptKeys.keys)&&receiptKeys.keys.length))throw Error('empty receipt key set');
await writeFile(resolve(out,'sync-config.js'),`export const syncOrigin=${JSON.stringify(origin)};export const receiptKeys=${JSON.stringify(receiptKeys)};`);
const {clientRuntimeProblems,clientRuntimeConnectSrc}=await import('../../../otehon/shell/vendor/kotoba-client-runtime.js');
if(clientRuntimeProblems(descriptor,['awai.drive.sync'],'http://tauri.localhost').length)throw Error('invalid sync descriptor');
const tauriFile=resolve(app,'src-tauri/tauri.conf.json'),config=JSON.parse(await readFile(tauriFile));
config.app.security.csp="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; "+clientRuntimeConnectSrc(descriptor,['awai.drive.sync'],[],'http://tauri.localhost').replace("'none'",'')+" ipc: http://ipc.localhost; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
await writeFile(tauriFile,JSON.stringify(config,null,2)+'\n');
await writeFile(resolve(out,'descriptor.json'),JSON.stringify(descriptor,null,2));
const names=['index.html','style.css','app.js','i18n.js','sync.js','sync-contract.js','bounded-response.js','sync.js','sync-contract.js','bounded-response.js','sync-config.js','core.js','receipt.js','host.js','noto-jp.woff2','runtime.js','descriptor.json'],files={};for(const n of names)files[n]=hash(await readFile(resolve(out,n)));
await writeFile(resolve(out,'release.json'),JSON.stringify({schema:'awai.app.artifact.v1',id:'network.awai.drive',version:'0.1.0',tauri:'3.0.0-alpha.6',runtimeWry:'3.0.0-alpha.6',sharedCore:{source:'core/awai/drive/domain.cljc',sha256:hash(await readFile(resolve(app,'core/awai/drive/domain.cljc')))},profile:'Bounded owner-store object-v2/CAR snapshot; Android device custody; explicit HTTPS sync',files},null,2));console.log('Drive static artifact built with pinned canonical runtime');

await distributeUi(out);
const {readdir}=await import('node:fs/promises');
async function uiFiles(dir,rel=''){let result=[];for(const e of await readdir(resolve(dir,rel),{withFileTypes:true})){const n=rel?rel+'/'+e.name:e.name;if(e.isDirectory())result.push(...await uiFiles(dir,n));else if(e.isFile())result.push(n);}return result;}
const releasePath=resolve(out,'release.json'),updated=JSON.parse(await readFile(releasePath,'utf8'));
for(const n of await uiFiles(resolve(out,'awai-ui')))updated.files['awai-ui/'+n]=hash(await readFile(resolve(out,'awai-ui',n)));
await writeFile(releasePath,JSON.stringify(updated,null,2)+'\n');
