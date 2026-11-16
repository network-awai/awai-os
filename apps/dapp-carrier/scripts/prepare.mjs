// One shared Tauri3 carrier, independently identified per dapp. No deployment.
import {readFile,writeFile,mkdir,copyFile,readdir,lstat,rm} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const app=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(app,'../..');
const profiles=JSON.parse(await readFile(resolve(app,'profiles/apps.json'),'utf8'));
const sources=JSON.parse(await readFile(resolve(app,'profiles/web-sources.json'),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const args=process.argv.slice(2);const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const inputs={aozora:option('--aozora-web'),dougaka:option('--dougaka-web')};
const generated=resolve(app,'generated');await mkdir(generated,{recursive:true});await rm(resolve(generated,'prepared.json'),{force:true});
const pin=profiles.canonicalRuntime;
const response=await fetch(`https://raw.githubusercontent.com/kotoba-lang/kotoba/${pin.revision}/lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js`,{redirect:'error',signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Canonical runtime missing');const runtime=Buffer.from(await response.arrayBuffer());if(sha(runtime)!==pin.sha256)throw Error('Canonical runtime digest mismatch');
const logo=execFileSync('git',['show','c7f1008cf06f4eacb7817d3602f7a9c0373146c5:nixos/otehon/branding/awai-logo.png'],{cwd:repo,maxBuffer:16000000});await writeFile(resolve(generated,'awai-icon.png'),logo);
const members=[];
const commands=['awai_host_info','peer_notification_permission','peer_host_info','peer_info','peer_begin','peer_reserve','peer_execute','peer_snapshot_execute','peer_cancel','peer_sessions','peer_stop','peer_import_begin','peer_import_chunk','peer_import_finish','peer_import_cancel','read_drafts','write_drafts'];
for(const profile of profiles.apps){
 if(!/^[a-z][a-z0-9-]+$/.test(profile.key)||!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(profile.id)||!/^[a-f0-9]{40}$/.test(profile.revision))throw Error('Invalid pinned profile');
 const root=resolve(generated,profile.key),dist=resolve(root,'dist'),native=resolve(root,'src-tauri');await mkdir(dist,{recursive:true});await mkdir(native,{recursive:true});await mkdir(resolve(native,'src'),{recursive:true});await mkdir(resolve(native,'permissions'),{recursive:true});members.push(`${profile.key}/src-tauri`);
 if(profile.domainUi==='existing-static-artifact'){
  if(!inputs[profile.key])throw Error(`Explicit verified static artifact required: --${profile.key}-web`);
  const source=sources.apps[profile.key];if(!source)throw Error('Missing static artifact pin');
  const names=new Set(Object.keys(source.files));
  async function check(directory,prefix=''){for(const name of await readdir(directory)){const file=prefix+name;const stat=await lstat(resolve(directory,name));if(stat.isSymbolicLink())throw Error('Static symlink refused');if(stat.isDirectory())await check(resolve(directory,name),file+'/');else if(!names.has(file))throw Error('Undeclared static artifact: '+file);}}
  await check(resolve(inputs[profile.key]));
  for(const [file,hash] of Object.entries(source.files)){if(!/^[A-Za-z0-9._/-]+$/.test(file)||file.split('/').includes('..'))throw Error('Unsafe static path');const bytes=await readFile(resolve(inputs[profile.key],file));if(sha(bytes)!==hash)throw Error('Static digest drift: '+file);await mkdir(dirname(resolve(dist,file)),{recursive:true});await writeFile(resolve(dist,file),bytes);}
 }else{
  await writeFile(resolve(dist,'index.html'),`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${profile.name} · Awai</title></head><body class="awai-connectivity-preview"><main><h1>${profile.name}</h1><p>P2P connectivity preview</p></main></body></html>`);
 }
 let html=await readFile(resolve(dist,'index.html'),'utf8');
 html=html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi,'');
 if(html.includes('awai-peer-ui.js'))throw Error('Static entry is already transformed');
 html=html.replace('</head>','<link rel="stylesheet" href="./awai-peer-ui.css"></head>').replace('</body>','<script type="module" src="./awai-peer-ui.js"></script></body>');await writeFile(resolve(dist,'index.html'),html);
 await copyFile(resolve(app,'web/peer-ui.js'),resolve(dist,'awai-peer-ui.js'));await copyFile(resolve(app,'web/peer-ui.css'),resolve(dist,'awai-peer-ui.css'));await copyFile(resolve(repo,'packages/awai-shell/host.js'),resolve(dist,'host.js'));await writeFile(resolve(dist,'runtime.js'),runtime);
 const descriptor={schema:'itonami.dapp.carrier.v1',...profile,version:'0.1.0',channel:'development-preview',host:'awai.shell.host.v1',peerHost:'awai.shell.peer.v1',protocols:['/ipfs/bitswap/1.2.0','/awai/yataverse/1.0.0','/libp2p/circuit/relay/0.2.0'],consent:'canonical-each-operation',automaticReceive:false,canonicalRuntime:pin};await writeFile(resolve(dist,'dapp.json'),JSON.stringify(descriptor,null,2)+'\n');
 await writeFile(resolve(root,'package.json'),JSON.stringify({name:`@awai/${profile.key}-carrier`,private:true,type:'module',scripts:{tauri:'tauri'}}));
 const dependency=relative(native,resolve(repo,'packages/awai-shell-native')).replaceAll('\\','/');
 await writeFile(resolve(native,'Cargo.toml'),`[package]\nname="awai-dapp-${profile.key}"\nversion="0.1.0"\nedition="2021"\nrust-version="1.95"\n[lib]\nname="awai_dapp_${profile.key}"\ncrate-type=["staticlib","cdylib","rlib"]\n[build-dependencies]\ntauri-build={version="=3.0.0-alpha.4",features=[]}\n[dependencies]\nawai-shell-native={path="${dependency}"}\ntauri={version="=3.0.0-alpha.6",features=[]}\ntauri-runtime-wry="=3.0.0-alpha.6"\n[features]\ncustom-protocol=["tauri/custom-protocol"]\n`);
 await writeFile(resolve(native,'build.rs'),'fn main(){tauri_build::build()}\n');
 const jni=`#[cfg(target_os="android")]\n#[no_mangle]\npub extern "system" fn Java_network_awai_shell_PeerRuntime_cancel(env:awai_shell_native::jni::JNIEnv,class:awai_shell_native::jni::objects::JClass,id:awai_shell_native::jni::objects::JString){awai_shell_native::jni_cancel(env,class,id)}\n#[cfg(target_os="android")]\n#[no_mangle]\npub extern "system" fn Java_network_awai_shell_PeerRuntime_active(env:awai_shell_native::jni::JNIEnv,class:awai_shell_native::jni::objects::JClass,id:awai_shell_native::jni::objects::JString)->awai_shell_native::jni::sys::jboolean{awai_shell_native::jni_active(env,class,id)}\n`;
 await writeFile(resolve(native,'src/lib.rs'),`#[cfg_attr(mobile,tauri::mobile_entry_point)]\npub fn run(){tauri::Builder::default().runtime(tauri_runtime_wry::Wry::default()).plugin(awai_shell_native::android_plugin()).invoke_handler(awai_shell_native::commands()).run(tauri::generate_context!()).expect("Awai dapp initialization failed");}\n${jni}`);
 await writeFile(resolve(native,'src/main.rs'),`fn main(){awai_dapp_${profile.key}::run()}\n`);
 for(const command of commands)await writeFile(resolve(native,'permissions',command+'.toml'),`[[permission]]\nidentifier="allow-${command.replaceAll('_','-')}"\ndescription="Verified Awai host: bounded ${command}. Availability is not operation consent."\ncommands.allow=["${command}"]\n`);
 const origins=profile.key==='aozora'?['https://bsky.social','https://pds.aozora.app','https://public.api.bsky.app','https://appview.aozora.app']:profile.key==='dougaka'?['https://generation.murakumo.cloud']:[];
 const scriptPolicy=profile.key==='dougaka'?"'self' 'unsafe-inline' 'unsafe-eval'":"'self'";
 const csp=`default-src 'self'; script-src ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost ${origins.join(' ')}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
 await writeFile(resolve(native,'tauri.conf.json'),JSON.stringify({$schema:'https://schema.tauri.app/config/3',productName:profile.name,version:'0.1.0',identifier:profile.id,build:{frontendDist:'../dist'},app:{withGlobalTauri:true,windows:[{label:'main',title:profile.name,width:480,height:820,minWidth:320,minHeight:400}],security:{csp,capabilities:[{identifier:'awai-local-peer',windows:['main'],permissions:commands.map(c=>'allow-'+c.replaceAll('_','-'))}]}},bundle:{active:false,android:{minSdkVersion:26}}},null,2)+'\n');
 const files={};async function inventory(directory,prefix=''){for(const name of await readdir(directory)){const path=resolve(directory,name),stat=await lstat(path);if(stat.isDirectory())await inventory(path,prefix+name+'/');else files[prefix+name]=sha(await readFile(path));}}await inventory(dist);await writeFile(resolve(root,'artifact.json'),JSON.stringify({schema:'awai.dapp.web.artifact.v1',id:profile.id,domainUi:profile.domainUi,tauri:profiles.tauri,canonicalRuntime:pin,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),files},null,2)+'\n');
 console.log(`${profile.key}: verified static carrier prepared (${Object.keys(files).length} files; ${profile.domainUi})`);
}
await writeFile(resolve(generated,'Cargo.toml'),`[workspace]\nresolver="2"\nmembers=${JSON.stringify(members)}\n[profile.dev]\ndebug=0\n`);

await copyFile(resolve(app,'profiles/Cargo.lock'),resolve(generated,'Cargo.lock'));

const sourceFiles=['profiles/apps.json','profiles/web-sources.json','profiles/Cargo.lock','scripts/prepare.mjs','scripts/android.mjs','web/peer-ui.js','web/peer-ui.css'];
const sourceHashes={};for(const file of sourceFiles)sourceHashes[file]=sha(await readFile(resolve(app,file)));
sourceHashes['../../packages/awai-shell/host.js']=sha(await readFile(resolve(repo,'packages/awai-shell/host.js')));
await writeFile(resolve(generated,'prepared.json'),JSON.stringify({schema:'awai.dapp.prepared.v1',sourceHashes},null,2)+'\n');
