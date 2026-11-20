import {spawnSync,spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,open,lstat,realpath,rm,statfs,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {admitRelease} from './update-release.mjs';
import {runUpdate,finishTrial,policyRequest} from './update-controller.mjs';
import {decide} from './update-policy.mjs';
const STATE='/var/lib/aiueos-update', CONFIG='/var/lib/aiueos-update/config.json';
const run=(name,args,options={})=>{const r=spawnSync(name,args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,...options});if(r.status!==0)throw Error(`${name} failed: ${(r.stderr||'').slice(0,800)}`);return (r.stdout||'').trim();};
export async function atomicJSON(path,value){const file=await open(path+'.new','w',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}await rename(path+'.new',path);const dir=await open(join(path,'..'),'r');try{await dir.sync();}finally{await dir.close();}}
async function privateJSON(path){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))throw Error('unsafe private configuration');return JSON.parse(await readFile(path,'utf8'));}
async function readJournal(){try{return await privateJSON(STATE+'/journal.json');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function casJournal(old,next){const current=await readJournal();if(JSON.stringify(current)!==JSON.stringify(old))throw Error('journal CAS conflict');const value={...next,revision:(old?.revision||0)+1};await atomicJSON(STATE+'/journal.json',value);return value;}
// USB updates may advance the installed floor beyond earlier network admission.
export function releaseFloor(journal,config){
 const values=[journal?.highestSequence??0,journal?.highestAdmittedSequence??0,config.initialSequence??0];
 if(values.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('invalid release sequence floor');
 return Math.max(...values);
}
export function transportURL(base,name){const u=new URL(base);if(u.protocol==='file:')return new URL(name,u);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(u.hostname)))throw Error('transport must be HTTPS, local file or loopback');return new URL(name,u);}
async function bytesAt(url,max){if(url.protocol==='file:'){const s=await lstat(fileURLToPath(url));if(!s.isFile()||s.size>max)throw Error('invalid transport file');return readFile(url);}const r=await fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!r.ok)throw Error(`transport HTTP ${r.status}`);const chunks=[];let n=0;for await(const c of r.body){n+=c.length;if(n>max)throw Error('transport bound');chunks.push(c);}return Buffer.concat(chunks);}
export async function download(base,admitted,path){const r=admitted.release,url=transportURL(base,r.closureSha256+'.nar-export');let n=0;const hash=createHash('sha256');try{const source=url.protocol==='file:'?createReadStream(fileURLToPath(url)):Readable.fromWeb((await fetch(url,{signal:AbortSignal.timeout(1800000),redirect:'error'}).then(x=>{if(!x.ok)throw Error('closure HTTP '+x.status);return x;})).body);await pipeline(source,new Transform({transform(c,e,cb){n+=c.length;hash.update(c);cb(n>r.closureBytes?Error('oversized closure'):null,c);}}),createWriteStream(path+'.part',{mode:0o600}));if(n!==r.closureBytes||hash.digest('hex')!==r.closureSha256)throw Error('closure digest');const file=await open(path+'.part','r');try{await file.sync();}finally{await file.close();}}catch(e){await rm(path+'.part',{force:true});throw e;}await rename(path+'.part',path);return path;}
async function hashFile(path){const h=createHash('sha256');let length=0;for await(const c of createReadStream(path)){h.update(c);length+=c.length;}return {sha256:h.digest('hex'),length};}
const params=text=>text.trim().split(/\s+/).filter(x=>/^murakumo\.(root|boot)_uuid=/.test(x));
export function bootEntry(system,kernelParams,hostParams,tag){if(!/^\/nix\/store\/[a-z0-9]{32}-nixos-system-[A-Za-z0-9.+_-]+$/.test(system)||hostParams.length!==2||!hostParams.some(x=>/^murakumo.root_uuid=[a-f0-9-]{36}$/.test(x))||!hostParams.some(x=>/^murakumo.boot_uuid=[A-F0-9]{4}-[A-F0-9]{4}$/.test(x)))throw Error('invalid host boot binding');return `title NixOS · Awai Node ${tag}\nlinux /aiueos/${tag}/kernel\ninitrd /aiueos/${tag}/initrd\noptions init=${system}/init ${kernelParams.trim().split(/\s+/).filter(x=>!/^murakumo\.(root|boot)_uuid=/.test(x)).join(' ')} ${hostParams.join(' ')} panic=30\n`;}
async function ensureRoot(){if(process.getuid?.()!==0)throw Error('root required');await mkdir(STATE,{recursive:true,mode:0o700});const s=await lstat(STATE);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))throw Error('unsafe state directory');}
async function writeStatus(value){await atomicJSON(STATE+'/status.json',{...value,observedAt:Date.now()});}
async function localHealth(config,target){try{if(await realpath('/run/current-system')!==target)return false;await statfs('/');for(const service of config.healthServices||['NetworkManager.service'])if(run('systemctl',['is-active',service])!=='active')return false;return true;}catch{return false;}}
async function installEntry(system,tag,hostParams){await mkdir('/boot/aiueos/'+tag,{recursive:true});for(const name of ['kernel','initrd'])await copyFile(system+'/'+name,'/boot/aiueos/'+tag+'/'+name);const text=bootEntry(system,await readFile(system+'/kernel-params','utf8'),hostParams,tag);await writeFile('/boot/loader/entries/'+tag+'.conf.new',text);await rename('/boot/loader/entries/'+tag+'.conf.new','/boot/loader/entries/'+tag+'.conf');run('sync',['-f','/boot']);}
async function pin(system,label){await mkdir(STATE+'/roots',{recursive:true,mode:0o700});run('nix-store',['--add-root',STATE+'/roots/'+label,'--indirect','--realise',system,'--option','substituters','']);}
async function imported(admitted){try{const paths=run('nix-store',['--query','--requisites',admitted.release.systemPath]).split('\n');if(!paths.length)return false;run('nix-store',['--verify-path',...paths]);return true;}catch{return false;}}
async function workerEvidence(config){if(config.role==='standalone')return {drained:true,peers:0};throw Error('fleet coordinator provider required; standalone cannot update a fleet worker');}
async function admission(state){await atomicJSON(STATE+'/admission.json',state);}
async function prepare(config,admitted,journal){const system=admitted.release.systemPath,previous=await realpath('/run/current-system'),hostParams=params(await readFile('/proc/cmdline','utf8'));
 if(!await localHealth(config,previous))throw Error('current generation unhealthy');
 run('bootctl',['is-installed']);if(!config.watchdogQualified)throw Error('qualified reboot watchdog required');
 await lstat('/dev/watchdog0');await pin(previous,'previous');await pin(system,'trial');
 // Persist full recovery context before writing any boot configuration.
 journal=await casJournal(await readJournal(),{...journal,pending:{...journal.pending,system,previous,hostParams,preparedAt:Date.now(),fallback:'aiueos-previous',trial:'aiueos-trial'}});
 await installEntry(previous,'aiueos-previous',hostParams);run('bootctl',['set-default','aiueos-previous.conf']);
 await installEntry(system,'aiueos-trial',hostParams);
 run('bootctl',['set-oneshot','aiueos-trial.conf']);run('sync',[]);
}
async function restore(j){run('bootctl',['set-default','aiueos-previous.conf']);run('bootctl',['set-oneshot','']);await writeStatus({action:'rollback',reason:'local-health-failed',manifestHash:j.pending.manifestHash});run('sync',[]);run('systemctl',['reboot']);}
async function recover(config){let j=await readJournal();if(j?.pending?.phase!=='trial-prepared')return false;const p=j.pending,running=await realpath('/run/current-system');
 if(!p.system||!p.previous){await casJournal(j,{...j,pending:null,lastOutcome:'preparation-interrupted',blocked:[...(j.blocked||[]),p.manifestHash]});return true;}
 if(running===p.previous){run('bootctl',['set-oneshot','']);await casJournal(j,{...j,pending:null,lastOutcome:'rolled-back',blocked:[...new Set([...(j.blocked||[]),p.manifestHash])]});await writeStatus({action:'rolled-back',manifestHash:p.manifestHash});return true;}
 if(running!==p.system)throw Error('unexpected running generation; manual recovery required');
 const started=Date.now();let healthy=false;while(Date.now()-started<(config.trialTimeoutMs||120000)){if(await localHealth(config,p.system)){healthy=true;break;}await new Promise(r=>setTimeout(r,1000));}
 const provider={withLock:fn=>fn(),readJournal,casJournal,collectLocalHealth:async()=>({'local-health':healthy?'pass':'fail','elapsed-ms':Date.now()-started,'timeout-ms':config.trialTimeoutMs||120000,attempts:1,'max-attempts':2}),decideTrial:e=>decide({operation:'trial',evidence:e}),installedSequence:async()=>p.sequence,commitBoot:async()=>{run('nix-env',['-p','/nix/var/nix/profiles/system','--set',p.system]);run('bootctl',['set-default','aiueos-trial.conf']);await admission({acceptNewJobs:true});await writeStatus({action:'committed',sequence:p.sequence,system:p.system});},restorePreviousBoot:restore};
 await finishTrial({journal:j,providers:provider});return true;
}
export async function main(operation='check'){await ensureRoot();let config;try{config=await privateJSON(CONFIG);}catch(e){const journal=await readJournal();if(journal?.pending?.phase==='trial-prepared'&&journal.pending.previous){const running=await realpath('/run/current-system');if(running===journal.pending.previous){await recover({});return;}if(running===journal.pending.system){await restore(journal);return;}throw Error('unreadable configuration and unexpected running generation; manual recovery required');}throw e;}
 if(await recover(config))return;
 if(operation==='recover')return;
 if(process.platform!=='linux'||process.arch!=='x64')throw Error('unsupported host');
 if(config.schema!=='aiueos.update-config.v1'||config.enabled!==true)throw Error('updates disabled');if(!config.ownerPolicyAuthorized||config.role!=='standalone')throw Error('owner policy/fleet provider missing');
 const j=await readJournal(),running=await realpath('/run/current-system');
 const current={arch:'x86_64-linux',hostContract:'uuid-v1',highestSequence:releaseFloor(j,config),pendingManifestHash:j?.pending?.manifestHash};
 // A journal is required after provisioning; deleting it cannot reset replay protection.
 if(!j)throw Error('provisioned journal missing');
 let admitted,envelope,base;const errors=[];
 for(const location of config.sources||[]){try{const b=await bytesAt(transportURL(location,'manifest.json'),131072);const e=JSON.parse(b);const a=admitRelease(e,config.trust,current);admitted=a;envelope=e;base=location;break;}catch(e){errors.push(e.message);}}
 if(!admitted){await writeStatus({action:'hold',reason:'no-admitted-release',errors});return;}
 const archive=STATE+'/'+admitted.release.closureSha256+'.nar-export';
 const provider={withLock:fn=>fn(),readJournal,casJournal,notify:async a=>writeStatus({action:'notified',sequence:a.release.sequence,manifestHash:a.manifestHash}),collectEvidence:async()=>{const fs=await statfs(STATE),worker=await workerEvidence(config);let recovery=false;try{await lstat('/sys/firmware/efi');await lstat('/dev/watchdog0');run('bootctl',['is-installed']);recovery=config.watchdogQualified===true&&params(await readFile('/proc/cmdline','utf8')).length===2;}catch{}
 return {'owner-policy-current?':config.ownerPolicyAuthorized===true,'compatible?':true,'fresh?':true,'time-trusted?':run('timedatectl',['show','--property=NTPSynchronized','--value'])==='yes'||config.offlineTimeAuthorized===true,'rollout-admitted?':true,'installed-sequence':j?.highestSequence??config.initialSequence,'closure-verified?':await imported(admitted),'previous-preserved?':await localHealth(config,running),'boot-recovery-qualified?':recovery,'space-ok?':Number(fs.bavail)*Number(fs.bsize)>admitted.release.closureBytes*3,'owner-peers-updating':worker.peers,'drained?':worker.drained,'maintenance-window?':new Date().getHours()>=3&&new Date().getHours()<5,'apply-consent?':config.applyNow===true,'defer-until':config.deferUntil};},decide,fetchClosure:async()=>{const f=await statfs(STATE);if(Number(f.bavail)*Number(f.bsize)<admitted.release.closureBytes*3)throw Error('insufficient staging space');await download(base,admitted,archive);return {verifiedArchive:archive};},importVerifiedClosure:async(value)=>{if(value.verifiedArchive!==archive)throw Error('invalid archive');const h=await hashFile(archive);if(h.sha256!==admitted.release.closureSha256||h.length!==admitted.release.closureBytes)throw Error('changed archive');const input=await open(archive,'r');try{run('nix-store',['--import'],{stdio:[input.fd,'pipe','pipe'],timeout:1800000});}finally{await input.close();}if(!await imported(admitted))throw Error('incomplete or corrupted closure');await pin(admitted.release.systemPath,'staged');},restrictNewJobs:async a=>admission({acceptNewJobs:false,reason:'security-deadline',manifestHash:a.manifestHash}),drain:async()=>admission({acceptNewJobs:false,reason:'draining'}),acquireFleetLease:async()=>({id:'standalone-exclusive-flock'}),releaseFleetLease:async()=>{},recheckActivation:async(a,p,e)=>{const latest=await privateJSON(CONFIG);if(JSON.stringify(latest)!==JSON.stringify(config))return false;admitRelease(envelope,config.trust,current);const v=await decide(policyRequest(a,p,{...await provider.collectEvidence(),'noticed-at':e.pending.noticedAt},Date.now()));return v.action==='trial-boot';},prepareTrialBoot:(a,e)=>prepare(config,a,e),reboot:async()=>run('systemctl',['reboot'])};
 const verdict=await runUpdate({envelope,trust:config.trust,current,policy:config.policy||{},now:Date.now(),providers:provider});await writeStatus(verdict);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main(process.argv[2]).catch(async e=>{try{await writeStatus({action:'hold',reason:e.message});}catch{}console.error(e.message);process.exitCode=1;});
