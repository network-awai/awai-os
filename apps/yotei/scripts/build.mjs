import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';import {createHash} from 'node:crypto';
const app=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(app,'../..'),out=resolve(app,'dist');await mkdir(out,{recursive:true});
for(const name of ['index.html','style.css','app.js','model.js'])await copyFile(resolve(app,'src',name),resolve(out,name));
await copyFile(resolve(repo,'android/client/generated/domain.js'),resolve(out,'domain.js'));
await copyFile(resolve(repo,'packages/awai-shell/host.js'),resolve(out,'host.js'));
await copyFile(resolve(repo,'android/client/assets/android-v2-icon-calendar.svg'),resolve(out,'calendar.svg'));
const pins=JSON.parse(await readFile(resolve(repo,'otehon/shell/vendor/PINS.json'),'utf8'));
for(const [input,output]of [['kotoba-client-runtime.js','runtime.js'],['kotoba-client-consent.css','runtime-consent.css']]){const bytes=await readFile(resolve(repo,'otehon/shell/vendor',input));if(createHash('sha256').update(bytes).digest('hex')!==pins.files[input])throw Error('canonical runtime pin drift');await writeFile(resolve(out,output),bytes);}
const descriptor={schema:'kotoba.app.client-runtime.v1',target:'browser',profile:'trusted-page-v1',entry:'index.html','local-state':{adapter:'localstorage',schema:'itonami.yotei.state.v1',version:1},workers:[],operations:[]};await writeFile(resolve(out,'descriptor.json'),JSON.stringify(descriptor,null,2)+'\n');
const files={};for(const name of ['index.html','style.css','app.js','model.js','domain.js','host.js','calendar.svg','runtime.js','runtime-consent.css','descriptor.json'])files[name]=createHash('sha256').update(await readFile(resolve(out,name))).digest('hex');await writeFile(resolve(out,'release.json'),JSON.stringify({schema:'awai.app.artifact.v1',id:'network.itonami.yotei',version:'0.2.0',host:'awai.shell.host.v1',tauri:'3.0.0-alpha.6',sharedCore:{source:'android/contracts/src/itonami/store/domain.cljc',sha256:createHash('sha256').update(await readFile(resolve(repo,'android/contracts/src/itonami/store/domain.cljc'))).digest('hex')},files},null,2)+'\n');console.log('Yotei static build: '+Object.keys(files).length+' pinned files');

await distributeUi(out);
const {readdir}=await import('node:fs/promises');
async function uiFiles(dir,rel=''){let result=[];for(const e of await readdir(resolve(dir,rel),{withFileTypes:true})){const n=rel?rel+'/'+e.name:e.name;if(e.isDirectory())result.push(...await uiFiles(dir,n));else if(e.isFile())result.push(n);}return result;}
const releasePath=resolve(out,'release.json'),updated=JSON.parse(await readFile(releasePath,'utf8'));
for(const n of await uiFiles(resolve(out,'awai-ui')))updated.files['awai-ui/'+n]=createHash('sha256').update(await readFile(resolve(out,'awai-ui',n))).digest('hex');
await writeFile(releasePath,JSON.stringify(updated,null,2)+'\n');
