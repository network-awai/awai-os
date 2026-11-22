// Local development distribution. No upload, install, publisher signing or catalog trust change.
import {readFile,writeFile,mkdir,copyFile,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const app=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(app,'../..');
const verifyOnly=process.argv.includes('--verify-only');
const output=resolve(repo,'.agent-output',`dapps-${Date.now()}`);if(!verifyOnly)await mkdir(resolve(output,'packages'),{recursive:true});
const profiles=JSON.parse(await readFile(resolve(app,'profiles/apps.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sdk=process.env.ANDROID_HOME||resolve(process.env.HOME,'Library/Android/sdk'),tools=resolve(sdk,'build-tools/36.1.0');
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const prepared=JSON.parse(await readFile(resolve(app,'generated/prepared.json'),'utf8'));if(prepared.platform!=='android')throw Error('Android preparation required for APK distribution');
for(const [file,digest]of Object.entries(prepared.sourceHashes))if(hash(await readFile(resolve(app,file)))!==digest)throw Error('Carrier preparation drift: '+file);
if(!Buffer.from(await readFile(resolve(app,'generated/Cargo.lock'))).equals(await readFile(resolve(app,'profiles/Cargo.lock'))))throw Error('Resolved Cargo.lock drift; review and prepare again');
const artifacts=[];
for(const profile of profiles.apps){
 const generated=resolve(app,'generated',profile.key),apk=resolve(generated,'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk');
 const web=JSON.parse(await readFile(resolve(generated,'artifact.json'),'utf8'));for(const [file,digest]of Object.entries(web.files))if(hash(await readFile(resolve(generated,'dist',file)))!==digest)throw Error('Static bundle drift: '+file);
 const signer=execFileSync(resolve(tools,'apksigner'),['verify','--print-certs',apk],{encoding:'utf8'}).match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/i)?.[1]?.toLowerCase();
 if(!signer||signer.length!==64)throw Error('APK signer cannot be verified');
 const badging=execFileSync(resolve(tools,'aapt2'),['dump','badging',apk],{encoding:'utf8'}),info=badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
 if(!info||info[1]!==profile.id||info[3]!==profiles.version)throw Error('APK identity mismatch: '+profile.key);
 const abis=badging.match(/^native-code: (.+)$/m)?.[1]?.match(/'([^']+)'/g)?.map(s=>s.slice(1,-1)).sort();
 if(JSON.stringify(abis)!==JSON.stringify(['arm64-v8a','x86_64']))throw Error('Both supported Android ABIs required');
 const bytes=await readFile(apk);if(bytes.length>268435456)throw Error('APK exceeds Store bound');
 if(verifyOnly){artifacts.push({id:profile.id,versionCode:Number(info[2]),versionName:info[3],abis,bytes:bytes.length,sha256:hash(bytes),signerSha256:signer});continue;}
 const asset=`packages/${profile.key}.apk`;await copyFile(apk,resolve(output,asset));
 const bundle=resolve(output,profile.key);await mkdir(bundle,{recursive:true});await cp(resolve(generated,'dist'),resolve(bundle,'web'),{recursive:true});
 const descriptor={schema:'awai.dapp.bundle.v1',key:profile.key,id:profile.id,entry:'web/index.html',channel:'development-preview',host:'awai.shell.host.v1',peerHost:'awai.shell.peer.v1',tauri:profiles.tauri,canonicalRuntime:profiles.canonicalRuntime,domainUi:profile.domainUi,sourceRevision:revision,android:{asset:'../'+asset,abis,bytes:bytes.length,sha256:hash(bytes),signerSha256:signer,versionCode:Number(info[2]),versionName:info[3]},peerNetwork:{transport:'libp2p',discovery:'explicit-literal-address',httpDnsDependency:false,automaticReceive:false},qualification:{productionStore:false,physicalX86Desktop:false,independentNetworkNat:false}};
 await writeFile(resolve(bundle,'bundle.json'),JSON.stringify(descriptor,null,2)+'\n');
 // Standalone static dapp bundle and separate installable APK share a pinned descriptor.
 const archive=resolve(output,profile.key+'.dapp.zip');execFileSync('zip',['-q','-r',archive,'bundle.json','web'],{cwd:bundle});
 artifacts.push({...profile,versionCode:Number(info[2]),versionName:info[3],asset,bytes:bytes.length,sha256:hash(bytes),signerSha256:signer,abis,bundle:{asset:profile.key+'.dapp.zip',sha256:hash(await readFile(archive))}});
}
if(verifyOnly){console.log(JSON.stringify({verified:true,sourceRevision:revision,artifacts},null,2));process.exit(0);}
const report={schema:'awai.dapp.distribution.v1',createdAt:new Date().toISOString(),sourceRevision:revision,tauri:profiles.tauri,signing:'local-android-debug-only',productionStore:false,canonicalRuntime:profiles.canonicalRuntime,artifacts};await writeFile(resolve(output,'distribution.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve(repo,'.agent-output/dapps-latest.json'),JSON.stringify({output,sourceRevision:revision},null,2)+'\n');console.log(JSON.stringify({output,artifacts:artifacts.map(a=>({id:a.id,bytes:a.bytes,abis:a.abis,domainUi:a.domainUi}))},null,2));
