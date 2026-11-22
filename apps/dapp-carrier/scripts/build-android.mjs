// Each profile has an independent identity; dependency reuse must regenerate JNI package bindings.
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const app=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(app,'../..');
const profiles=JSON.parse(await readFile(resolve(app,'profiles/apps.json'),'utf8'));
const prepared=JSON.parse(await readFile(resolve(app,'generated/prepared.json'),'utf8'));
if(prepared.schema!=='awai.dapp.prepared.v1'||prepared.platform!=='android')throw Error('Carrier preparation required');
for(const [file,hash]of Object.entries(prepared.sourceHashes))if(createHash('sha256').update(await readFile(resolve(app,file))).digest('hex')!==hash)throw Error('Carrier source changed; prepare again: '+file);
const keys=process.argv.slice(2),selected=profiles.apps.filter(p=>!keys.length||keys.includes(p.key));
if(keys.length&&selected.length!==keys.length)throw Error('Unknown or duplicate profile');
const target=resolve(repo,'.agent-output/dapp-target');await mkdir(target,{recursive:true});
const env={...process.env,CARGO_TARGET_DIR:target};
function run(command,args,cwd){const result=spawnSync(command,args,{cwd,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} exited ${result.status}`);}
for(const profile of selected){
 // Tauri alpha writes package-specific Android sources/JNI from dependency build scripts.
 // Cargo does not track all of those external output directories. Retain dependencies,
 // but invalidate these three task-owned build outputs before changing app identity.
 run('cargo',['clean','-p','tauri','-p','wry','-p','tauri-runtime-wry'],resolve(app,'generated'));
 run('npm',['run','tauri','--','android','build','--target','aarch64','x86_64','--debug','--apk','--ci'],resolve(app,'generated',profile.key));
}
