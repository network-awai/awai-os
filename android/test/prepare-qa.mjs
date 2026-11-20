#!/usr/bin/env node
// Derive test-only packages without changing production app sources or auth semantics.
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,cp,symlink,stat,readlink} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const options=Object.fromEntries(process.argv.slice(2).map(a=>a.split('=')));
const abi=options['--target']||'x86_64';if(!['x86_64','aarch64'].includes(abi))throw Error('invalid-target');
const out=options['--resume']?path.resolve(options['--resume']):path.join(root,'.agent-output','isolated-qa-'+Date.now()),stage=path.join(out,'source');
if(!out.startsWith(path.join(root,'.agent-output/isolated-qa-')))throw Error('QA staging scope required');
await mkdir(stage,{recursive:true});
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
const revision=git('rev-parse','HEAD');
if(options['--resume']){const owner=JSON.parse(await readFile(path.join(out,'qa-stage-owner.json')));if(owner.root!==root||owner.revision!==revision)throw Error('unowned-stage');}
await writeFile(path.join(out,'qa-stage-owner.json'),JSON.stringify({root,revision}));
if(git('diff','HEAD','--name-only','apps','packages/awai-inference','otehon/shell'))throw Error('dirty-product-source');
const bundle=JSON.parse(await readFile(path.join(root,'apps/itonami/dist/itonami-bundle.json')));
if(bundle.shellTree!==git('rev-parse','HEAD:otehon/shell'))throw Error('stale-owning-shell');
for(const [rel,pin] of Object.entries(bundle.artifacts)){
 const hash=createHash('sha256').update(await readFile(path.join(root,'apps/itonami/dist',rel))).digest('hex');if(hash!==pin.sha256)throw Error('frontend-artifact-drift');
}
const files=git('ls-files','-z','apps/itonami','apps/murakumo','packages/awai-inference').split('\0').filter(Boolean);
for(const f of files){await mkdir(path.dirname(path.join(stage,f)),{recursive:true});await cp(path.join(root,f),path.join(stage,f));}
const changes=[];
async function edit(rel,fn){const p=path.join(stage,rel),before=await readFile(p,'utf8'),after=fn(before);if(before===after)throw Error('QA transform missed '+rel);await writeFile(p,after);changes.push({path:rel,sha256:createHash('sha256').update(after).digest('hex')});}
const permission='network.awai.qa.permission.LOCAL_INFERENCE';
for(const [app,namespace] of [['itonami','network.itonami.app'],['murakumo','network.awai.murakumo']]){
 const base=`apps/${app}`,android=base+'/src-tauri/gen/android/app';
 await cp(path.join(root,base,'dist'),path.join(stage,base,'dist'),{recursive:true});
 if(app==='murakumo')await cp(path.join(root,android,'src/main/assets'),path.join(stage,android,'src/main/assets'),{recursive:true});
 const nativeAbi=abi==='aarch64'?'arm64-v8a':'x86_64';const jni=path.join(root,android,'src/main/jniLibs',nativeAbi);try{await mkdir(path.join(stage,android,'src/main/jniLibs'),{recursive:true});await cp(jni,path.join(stage,android,'src/main/jniLibs',nativeAbi),{recursive:true});}catch(e){if(app==='murakumo')throw e;}
 // Tauri's Rust/JNI class namespace stays unchanged. Only Android application identity changes.
 await edit(android+'/build.gradle.kts',s=>s.replace(`applicationId = "${namespace}"`,`applicationId = "${namespace}.qa"`));
 await edit(android+'/src/main/res/values/strings.xml',s=>s.replaceAll('>\"'+(app==='itonami'?'Itonami':'Murakumo')+'\"<','>\"'+(app==='itonami'?'Itonami':'Murakumo')+' QA\"<'));
 await edit(base+'/src-tauri/tauri.conf.json',s=>{const c=JSON.parse(s);c.productName+=' QA';for(const w of c.app?.windows||[])w.title+=' QA';return JSON.stringify(c,null,2)+'\n'});
 try{await cp(path.join(root,base,'src-tauri/tauri.android.conf.json'),path.join(stage,base,'src-tauri/tauri.android.conf.json'));}catch{}
 await edit(android+'/src/main/AndroidManifest.xml',s=>s.replace('<application','<application android:testOnly="true"').replace(/\s*<uses-permission android:name="android.permission.INTERNET"\s*\/>/g,'').replaceAll('network.awai.permission.LOCAL_INFERENCE',permission).replaceAll('android:name=".MainActivity"',`android:name="${namespace}.MainActivity"`).replace('android:name=".InferenceStatusProvider"','android:name="network.awai.murakumo.InferenceStatusProvider"').replace('android:name=".InferenceRequestActivity"','android:name="network.awai.murakumo.InferenceRequestActivity"').replace('android:authorities="network.awai.murakumo.engine"','android:authorities="network.awai.murakumo.qa.engine"').replace('<package android:name="network.awai.murakumo"/>','<package android:name="network.awai.murakumo.qa"/>'));
 try{await symlink(path.join(root,base,'node_modules'),path.join(stage,base,'node_modules'),'dir');}catch(e){if(e.code!=='EEXIST'||await readlink(path.join(stage,base,'node_modules'))!==path.join(root,base,'node_modules'))throw e;}
}
await edit('packages/awai-inference/android/network/awai/inference/InferenceClientPlugin.kt',s=>s.replace('private val provider="network.awai.murakumo"','private val provider="network.awai.murakumo.qa"').replaceAll('network.awai.permission.LOCAL_INFERENCE',permission).replace('"$provider.MainActivity"','"network.awai.murakumo.MainActivity"').replace('"$provider.InferenceRequestActivity"','"network.awai.murakumo.InferenceRequestActivity"'));
await edit('apps/murakumo/src-tauri/gen/android/app/src/main/java/network/awai/murakumo/Models.kt',s=>s.replace(/val allowed=setOf\([^\n]+\)/,'val allowed=setOf("network.itonami.app.qa")'));
const receipt={schema:'awai.qa.derived-build.v1',revision,stage,abi,derivedChanges:changes,authenticationBypass:false,packages:{},recipeSha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),normalPackages:['network.itonami.app','network.awai.murakumo']};
const sdk=process.env.ANDROID_HOME||'/Users/junkawasaki/Library/Android/sdk';
for(const app of ['murakumo','itonami']){
 const a=path.join(stage,'apps',app),args=['run','tauri','--','android','build','--apk','--debug','--target',abi];
 const run=spawnSync('npm',args,{cwd:a,encoding:'utf8',maxBuffer:32*1024*1024,timeout:1200000});await writeFile(path.join(out,app+'-build.log'),(run.stdout||'')+(run.stderr||''));if(run.status!==0)throw Error('QA build failed; see '+out+'/'+app+'-build.log');
 const apk=path.join(a,'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk');
 const ns=app==='itonami'?'network.itonami.app':'network.awai.murakumo',pkg=ns+'.qa';
 const badging=execFileSync(path.join(sdk,'build-tools/36.1.0/aapt'),['dump','badging',apk],{encoding:'utf8'});
 const permissions=execFileSync(path.join(sdk,'build-tools/36.1.0/aapt'),['dump','permissions',apk],{encoding:'utf8'});
 const xml=execFileSync(path.join(sdk,'build-tools/36.1.0/aapt'),['dump','xmltree',apk,'AndroidManifest.xml'],{encoding:'utf8'});
 if(!badging.includes(`package: name='${pkg}'`)||!badging.includes('QA')||!xml.match(/testOnly[^\n]*0xffffffff/))throw Error('QA identity/test-only fence failed');
 if(permissions.includes('android.permission.INTERNET')||permissions.includes('network.awai.permission.LOCAL_INFERENCE'))throw Error('QA network/production-permission fence failed');
 receipt.packages[app]={id:pkg,activity:ns+'.MainActivity',apk,sha256:createHash('sha256').update(await readFile(apk)).digest('hex'),bytes:(await stat(apk)).size,testOnly:true,internet:false};console.log('Built isolated QA',pkg);
}
await writeFile(path.join(out,'manifest.json'),JSON.stringify(receipt,null,2)+'\n');execFileSync(process.execPath,[path.join(root,'android/test/sign-qa.mjs'),path.join(out,'manifest.json')],{stdio:'inherit'});console.log('QA_MANIFEST='+path.join(out,'manifest.json'));
