// AWAI-2987. Explicit operator migration of public CI artifacts, not a codec.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

export const REPO='network-awai/awai-os', PART=8*1024*1024;
const MAX_ARTIFACT=32*1024**3, MAX_COLD=2*1024**3;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=(v,m)=>{if(!v)throw Error(m);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function installedFingerprint(app){
 const rows=[];let total=0;
 function visit(dir){for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name),s=fs.lstatSync(p);check(!s.isSymbolicLink(),'source symlink refused');if(s.isDirectory())visit(p);else if(/\.(cljc|cjs|mjs|js)$/.test(name)){total+=s.size;check(rows.length<10000&&total<=128*1024**2,'source fingerprint bound');rows.push([path.relative(app,p),hash(fs.readFileSync(p))]);}}}
 for(const name of fs.readdirSync(app).filter(n=>/\.(cljc|cjs|mjs|js)$/.test(n)).sort()){const p=path.join(app,name);check(fs.lstatSync(p).isFile()&&!fs.lstatSync(p).isSymbolicLink(),'source file refused');rows.push([name,hash(fs.readFileSync(p))]);}visit(path.join(app,'src'));return hash(Buffer.from(JSON.stringify(rows)));
}
export function admitArtifact(a){
 check(Number.isSafeInteger(a.id)&&a.id>0&&!a.expired&&/^sha256:[a-f0-9]{64}$/.test(a.digest),'unqualified artifact identity');
 check(Number.isSafeInteger(a.size_in_bytes)&&a.size_in_bytes>=0&&a.size_in_bytes<=MAX_ARTIFACT,'artifact bound');
 check(Number.isSafeInteger(a.workflow_run?.id),'missing source run');return a;
}
export function admitRedirect(raw){
 const u=new URL(raw);check(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
  (u.hostname.endsWith('.blob.core.windows.net')||u.hostname.endsWith('.actions.githubusercontent.com')||u.hostname.endsWith('.githubusercontent.com')),'download redirect outside artifact CDN');return u;
}
export async function* split(stream,size=PART){
 check(Number.isInteger(size)&&size>0&&size<=PART,'part bound');let b=Buffer.alloc(size),n=0;
 for await(const item of stream){const c=Buffer.from(item);let i=0;while(i<c.length){const take=Math.min(c.length-i,size-n);c.copy(b,n,i,i+take);n+=take;i+=take;if(n===size){yield b;b=Buffer.alloc(size);n=0;}}}
 if(n)yield b.subarray(0,n);
}
export async function verifyColdTranscript(stream,parts,onBytes=()=>{},onComplete=()=>{}){
 let i=0,seen=0,h=crypto.createHash('sha256');
 for await(const item of stream){let offset=0;while(offset<item.length){const p=parts[i];check(p&&p.bytes>0&&p.bytes<=PART,'unexpected cold proof bytes');const n=Math.min(p.bytes-seen,item.length-offset),b=item.subarray(offset,offset+n);h.update(b);onBytes(p,b);offset+=n;seen+=n;if(seen===p.bytes){check(h.digest('hex')===p.sha256,'cold transcript SHA256');onComplete(p);i++;seen=0;h=crypto.createHash('sha256');}}}
 check(i===parts.length&&seen===0,'cold transcript truncated');
}
export function readLegacyPart(root,fm,expected,onBytes=()=>{}){
 check(fm&&fm['file-size']===expected.bytes&&expected.bytes<=PART&&Array.isArray(fm.entries),'cold file size');
 const whole=crypto.createHash('sha256');let total=0;
 for(const e of fm.entries){
  check(e.offset===total&&Number.isSafeInteger(e.length)&&e.length>0&&e.length<=PART&&Number.isSafeInteger(e.pack)&&e.pack>=0&&Number.isSafeInteger(e['pack-offset'])&&e['pack-offset']>=0&&/^[a-f0-9]{64}$/.test(e.sha),'cold extent contract');
  const fd=fs.openSync(path.join(root,'packs',`pack-${e.pack}.car`),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{check(fs.fstatSync(fd).isFile()&&e['pack-offset']+e.length<=fs.fstatSync(fd).size,'cold pack extent');const bytes=Buffer.alloc(e.length);check(fs.readSync(fd,bytes,0,e.length,e['pack-offset'])===e.length&&hash(bytes)===e.sha,'cold chunk SHA256');whole.update(bytes);onBytes(bytes);total+=bytes.length;}finally{fs.closeSync(fd);}
 }
 check(total===expected.bytes&&whole.digest('hex')===expected.sha256,'cold part SHA256');return true;
}
export async function confirmAbsent(read,wait=pause){
 for(let i=0;i<10;i++){const r=read();if(r.status!==0&&/HTTP 404/.test(r.stderr))return;await wait(1000);}
 throw Error('deletion readback unknown');
}
export function deletionAllowed(a,s,fresh=new Set()){
 return !!(s&&s.id===a.id&&s.digest===a.digest&&s.sourceRun===a.workflow_run.id&&s.bytes===a.size_in_bytes&&s.sha256===a.digest.slice(7)&&s.receipt?.verified&&fresh.has(s.receipt.name)&&s.parts.length&&s.parts.every(p=>p.verified&&p.snapshot&&fresh.has(p.name)));
}
function atomic(file,value){const tmp=file+'.pending-'+crypto.randomUUID();const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
const exec=(bin,args,options={})=>cp.execFileSync(bin,args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options});
const gh=args=>JSON.parse(exec('gh',['api',...args]));

export async function run(config){
 const {work,volume,app,credentialsPlist,maxArtifacts=441,maxArtifactBytes=MAX_ARTIFACT,batchBytes=128*1024**2,applyDelete=false,coldHost}=config;
 check(!coldHost||coldHost==='jacob','only the reviewed Tailscale peer is admitted');
 for(const p of [work,volume,app,credentialsPlist])check(path.isAbsolute(p),'explicit absolute paths required');
 check(volume===path.join(process.env.HOME,'.awaivol','archives','awai-os-actions-20261116'),'fixed dedicated archive namespace only');
 check(batchBytes>=PART&&batchBytes<=1024**3,'batch staging bound');
 fs.mkdirSync(work,{recursive:true,mode:0o700});fs.mkdirSync(volume,{recursive:true,mode:0o700});
 check(!fs.lstatSync(volume).isSymbolicLink()&&!fs.lstatSync(work).isSymbolicLink(),'no symlink storage roots');
 const lock=path.join(volume,'.operator-writer');fs.mkdirSync(lock,{mode:0o700});
 let child;const saveFile=path.join(work,'progress.json');
 const log=o=>{const row={at:new Date().toISOString(),...o};fs.appendFileSync(path.join(work,'events.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});console.log(JSON.stringify(row));};
 const installed=path.join(app,'awaivol.cljc');const pin={source:installed,sha256:hash(fs.readFileSync(installed)),node:process.version,nbb:exec('/opt/homebrew/bin/nbb',['--version']).trim(),rclone:exec('rclone',['version']).split('\n')[0]};
 let state=fs.existsSync(saveFile)?JSON.parse(fs.readFileSync(saveFile)): {schema:'awai.operator.github-archive-progress.v1',repo:REPO,pin,artifacts:{}};
 check(state.repo===REPO&&state.pin.sha256===pin.sha256,'archive binding/source changed');
 const runtimeFingerprint=installedFingerprint(app);state.runtimeFingerprint??=runtimeFingerprint;check(state.runtimeFingerprint===runtimeFingerprint,'installed helper/source changed');
 log({event:'run-start',operatorSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),runtimeFingerprint,applyDelete,maxArtifacts,maxArtifactBytes,batchBytes});
 const ownerFile=path.join(volume,'operator-binding.json');const owner={repo:REPO,work,sourceSha256:pin.sha256};
 if(fs.existsSync(ownerFile))check(JSON.stringify(JSON.parse(fs.readFileSync(ownerFile)))===JSON.stringify(owner),'foreign archive volume');
 else{check(fs.readdirSync(volume).every(x=>x==='.operator-writer'),'new volume must be empty');atomic(ownerFile,owner);}
 // Secret values remain in process memory and child environments, never argv/logs.
 const vars=JSON.parse(exec('/usr/bin/plutil',['-extract','EnvironmentVariables','json','-o','-',credentialsPlist]));
 const prefix=[vars.AWAI_B2_PREFIX,'operator-archives','awai-os-actions-20261116'].filter(Boolean).join('/');
 check(!prefix.split('/').some(x=>!x||x==='.'||x==='..'),'remote namespace');
 const remote=`awaiarchive:${vars.AWAI_B2_BUCKET_NAME}/${prefix}`;
 const env={...process.env,RCLONE_CONFIG_AWAIARCHIVE_TYPE:'b2',RCLONE_CONFIG_AWAIARCHIVE_ACCOUNT:vars.AWAI_B2_KEY_ID,RCLONE_CONFIG_AWAIARCHIVE_KEY:vars.AWAI_B2_APP_KEY};
 if(coldHost)Object.assign(env,{RCLONE_CONFIG_COLDPROOF_TYPE:'sftp',RCLONE_CONFIG_COLDPROOF_SSH:'ssh -l node -o BatchMode=yes -o StrictHostKeyChecking=yes jacob',RCLONE_CONFIG_COLDPROOF_DISABLE_HASHCHECK:'true'});
 check(vars.AWAI_B2_KEY_ID&&vars.AWAI_B2_APP_KEY&&vars.AWAI_B2_BUCKET_NAME,'existing AwaiFS credentials required');
 const rclone=args=>{try{return exec('rclone',[...args,'--retries','2','--low-level-retries','2','--contimeout','15s','--timeout','180s'],{env,timeout:1800000,maxBuffer:8*1024**2});}catch{throw Error('bounded AwaiFS remote operation refused; no source deletion qualified');}};
 let origin,pending=[],staged=0;const fresh=new Set(),coldHashes=new Map();
 const sshArgs=['-l','node','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','jacob'];
 const remoteJS=code=>exec('ssh',[...sshArgs,'/opt/homebrew/bin/node --input-type=module'],{input:code,timeout:60000});
 let remoteTools;
 if(coldHost){
  const files=['actions-to-awaifs.mjs','remote-cold-proof.mjs'].map(name=>({name,bytes:fs.readFileSync(new URL(name,import.meta.url))}));const id=hash(Buffer.concat(files.map(x=>x.bytes)));remoteTools=`/Users/node/github/workspaces/codex/awai-2987/.agent-output/archive-tools/${id}`;
  remoteJS(`import fs from'node:fs';fs.mkdirSync(${JSON.stringify(remoteTools)},{recursive:true,mode:0o700});`);
  for(const f of files)exec('ssh',[...sshArgs,`cat > ${remoteTools}/${f.name}`],{input:f.bytes});
  const actual=JSON.parse(remoteJS(`import fs from'node:fs';import crypto from'node:crypto';console.log(JSON.stringify(${JSON.stringify(files.map(x=>x.name))}.map(n=>crypto.createHash('sha256').update(fs.readFileSync(${JSON.stringify(remoteTools)}+'/'+n)).digest('hex'))));`));check(actual.every((h,i)=>h===hash(files[i].bytes)),'peer verification source changed');
 }
 async function start(){
  check(hash(fs.readFileSync(installed))===state.pin.sha256&&installedFingerprint(app)===runtimeFingerprint,'installed AwaiFS changed; qualification held');
  exec(process.execPath,['/opt/homebrew/bin/nbb','-cp',path.join(app,'src'),installed,'init',volume],{cwd:app,timeout:60000});
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const fd=fs.openSync(path.join(work,'volume-server.log'),'a',0o600);child=cp.spawn(process.execPath,['/opt/homebrew/bin/nbb','-cp',path.join(app,'src'),installed,'serve',volume,String(port)],{cwd:app,stdio:['ignore',fd,fd]});fs.closeSync(fd);origin=`http://127.0.0.1:${port}`;
  for(let i=0;i<120;i++){check(child.exitCode===null,'archive volume exited');try{const r=await fetch(origin+'/',{method:'OPTIONS',signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await pause(250);}throw Error('archive volume startup timeout');
 }
 async function stop(){if(!child)return;const c=child;child=undefined;c.kill('SIGTERM');await Promise.race([once(c,'close'),pause(10000).then(()=>{if(c.exitCode===null)throw Error('archive volume did not stop');})]);}
 async function put(name,bytes){
  check(bytes.length<=PART&&name.startsWith('github-actions/'),'owned logical path bound');
  const dirs=name.split('/');for(let i=1;i<dirs.length;i++){const r=await fetch(origin+'/'+dirs.slice(0,i).join('/'),{method:'MKCOL',signal:AbortSignal.timeout(30000)});check([201,405].includes(r.status),'archive directory refused');}
  const head=await fetch(origin+'/'+name,{method:'HEAD',signal:AbortSignal.timeout(30000)});
  if(head.ok){const r=await fetch(origin+'/'+name,{signal:AbortSignal.timeout(120000)});check(Number(r.headers.get('content-length'))===bytes.length,'existing part length');const b=Buffer.from(await r.arrayBuffer());check(b.length<=PART&&hash(b)===hash(bytes),'existing part differs');return;}
  check(head.status===404,'archive destination unknown');const r=await fetch(origin+'/'+name,{method:'PUT',body:bytes,signal:AbortSignal.timeout(120000)});check(r.status===201,'archive PUT refused');
 }
 async function flush(){
  if(!pending.length)return;
  // Empty PUT follows the installed AwaiFS sealed-ingest branch, sealing any
  // small-file append Pack. It does not introduce a new storage format.
  const barrier='github-actions/barrier-'+crypto.randomUUID();await put(barrier,Buffer.alloc(0));
  let catalog,raw;
  for(let i=0;i<120;i++){raw=fs.readFileSync(path.join(volume,'manifest.json'));catalog=JSON.parse(raw);if(catalog.files[barrier]&&pending.every(p=>catalog.files[p.name]?.['file-size']===p.bytes)&&fs.statSync(path.join(volume,'journal.jsonl')).size===0)break;catalog=undefined;await pause(250);}
  check(catalog,'archive checkpoint did not commit');await stop();
  const snapshot=hash(raw),snapshotFile=path.join(work,`catalog-${snapshot}.json`);fs.writeFileSync(snapshotFile,raw,{flag:'w',mode:0o600});
  const local=fs.readdirSync(path.join(volume,'packs')).filter(x=>/^pack-\d+\.car$/.test(x));
  const indices=new Set(local.map(x=>Number(x.match(/\d+/)[0])));for(const p of pending)for(const e of catalog.files[p.name].entries)indices.add(e.pack);
  const descriptors=new Map(catalog.packs.map(p=>[p['pack-index'],p.bytes]));
  let coldBytes=0;for(const i of indices){check(Number.isSafeInteger(i)&&i>=0&&Number.isSafeInteger(descriptors.get(i)),'unknown cold Pack');coldBytes+=descriptors.get(i);}check(coldBytes<=MAX_COLD,'cold recovery staging bound');
  let peerCold;
  if(coldHost){peerCold='/Users/node/github/workspaces/codex/awai-2987/.agent-output/archive-cold/cold-'+crypto.randomUUID();const space=JSON.parse(remoteJS(`import fs from'node:fs';fs.mkdirSync(${JSON.stringify(peerCold+'/packs')},{recursive:true,mode:0o700});const s=fs.statfsSync(${JSON.stringify(peerCold)});console.log(JSON.stringify({free:s.bavail*s.bsize}));`));check(space.free>coldBytes+4*1024**3,'peer recovery disk reserve');}
  else{const space=fs.statfsSync(work);check(space.bavail*space.bsize>coldBytes+4*1024**3,'recovery disk reserve');}
  const cold=fs.mkdtempSync(path.join(work,'cold-'));fs.mkdirSync(path.join(cold,'packs'));
  const list=path.join(cold,'selected-packs.txt');fs.writeFileSync(list,[...indices].map(i=>`pack-${i}.car`).join('\n')+'\n',{mode:0o600});
  rclone(['copy',path.join(volume,'packs'),remote+'/packs','--checksum','--immutable','--transfers','4','--checkers','4']);
  rclone(['copyto',snapshotFile,remote+`/manifests/sha256-${snapshot}.json`,'--checksum','--immutable']);
  const coldTarget=peerCold?'coldproof:'+peerCold:cold;
  rclone(['copyto',remote+`/manifests/sha256-${snapshot}.json`,coldTarget+'/manifest.json']);
  rclone(['copy',remote+'/packs',coldTarget+'/packs','--files-from-raw',list,'--transfers','4','--checkers','4','--no-traverse']);
  function context(p){
   const match=p.name.match(/^github-actions\/(\d+)\/part-(\d+)\.bin$/);let sum;
   if(match){const id=Number(match[1]);if(!coldHashes.has(id))coldHashes.set(id,{next:0,bytes:0,h:crypto.createHash('sha256')});sum=coldHashes.get(id);check(sum.next===Number(match[2]),'cold artifact part order');}
   return sum;
  }
  function finish(p,sum){if(sum)sum.next++;p.verified=true;p.snapshot=snapshot;fresh.add(p.name);}
  if(peerCold){
   const localPacks=local.map(name=>{const b=fs.readFileSync(path.join(volume,'packs',name));return{name,bytes:b.length,sha256:hash(b)};});
   const request={snapshot,localPacks,parts:pending.map(({name,bytes,sha256})=>({name,bytes,sha256}))};remoteJS(`import fs from'node:fs';fs.writeFileSync(${JSON.stringify(peerCold+'/request.json')},${JSON.stringify(JSON.stringify(request))},{mode:0o600});`);
   const proc=cp.spawn('ssh',[...sshArgs,`/opt/homebrew/bin/node ${remoteTools}/remote-cold-proof.mjs ${peerCold}`],{stdio:['ignore','pipe','pipe']});let stderr='';proc.stderr.on('data',b=>{stderr+=b;if(stderr.length>1024**2)proc.kill();});const done=new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('close',code=>code===0?resolve():reject(Error('peer cold proof failed')));});done.catch(()=>{});let activeName,active;
   try{await verifyColdTranscript(proc.stdout,pending,(p,b)=>{if(activeName!==p.name){activeName=p.name;active=context(p);}if(active){active.h.update(b);active.bytes+=b.length;}},p=>finish(p,active));await done;}catch(e){proc.kill();await done.catch(()=>{});throw e;}
   const report=JSON.parse(stderr.trim().split('\n').at(-1));check(report.verified===true&&report.snapshot===snapshot,'peer proof receipt');
  }else{
   check(hash(fs.readFileSync(path.join(cold,'manifest.json')))===snapshot,'remote catalog SHA256');
   for(const name of local){const a=fs.readFileSync(path.join(volume,'packs',name)),b=fs.readFileSync(path.join(cold,'packs',name));check(hash(a)===hash(b),'remote complete Pack SHA256');}
   for(const p of pending){const sum=context(p);readLegacyPart(cold,catalog.files[p.name],p,b=>{if(sum){sum.h.update(b);sum.bytes+=b.length;}});finish(p,sum);}
  }
  atomic(saveFile,state);
  if(Object.values(state.artifacts).some(s=>!s.deleted&&deletionAllowed(s.source,s,fresh))){
   const root={schema:'awai.operator.archive-root.v1',repo:REPO,catalog:snapshot,profile:'installed-legacy-raw-pack',publishedAt:new Date().toISOString()};
   const rootFile=path.join(work,'recovery-root.json');atomic(rootFile,root);rclone(['copyto',rootFile,remote+'/recovery-root.json','--checksum']);rclone(['copyto',remote+'/recovery-root.json',path.join(cold,'root.json')]);check(hash(fs.readFileSync(rootFile))===hash(fs.readFileSync(path.join(cold,'root.json'))),'recovery root publication refused');
   state.recoveryRoot=root;atomic(saveFile,state);log({event:'recovery-root-published',catalog:snapshot});
  }
  // Only this exclusive volume's independently restored immutable Pack cache.
  // The primary volume, its cache, credentials and unrelated WIP are untouched.
  for(const name of local)fs.unlinkSync(path.join(volume,'packs',name));
  log({event:'cold-readback-verified',files:pending.length,bytes:staged,coldPackBytes:coldBytes,snapshot,evictedLocalPacks:local.length,recoveryPeer:coldHost||'local'});pending=[];staged=0;
  // The immutable remote catalog was just read back and hash checked. Keep
  // its hash/proof, canonical volume manifest and state; release only this
  // duplicate local snapshot so hundreds of batches cannot fill the disk.
  fs.unlinkSync(snapshotFile);
  fs.rmSync(cold,{recursive:true});
  if(peerCold)remoteJS(`import fs from'node:fs';fs.rmSync(${JSON.stringify(peerCold)},{recursive:true});`);
  await deleteQualified();
  await start();
 }
 async function deleteQualified(){
  for(const s of Object.values(state.artifacts)){
   const a=s.source;if(s.deleted||!deletionAllowed(a,s,fresh))continue;
   const sum=coldHashes.get(a.id);check(sum&&sum.next===s.parts.length&&sum.bytes===a.size_in_bytes,'cold complete artifact coverage');sum.sha256??=sum.h.digest('hex');check(sum.sha256===a.digest.slice(7),'cold complete original ZIP SHA256');
   if(!applyDelete){log({event:'deletion-qualified-plan-only',id:a.id});continue;}
   let current;try{current=gh([`repos/${REPO}/actions/artifacts/${a.id}`]);}catch(error){
    if(/HTTP 404/.test(String(error.stderr))){s.deleted=true;s.deletedAt=new Date().toISOString();s.observedAbsent=true;atomic(saveFile,state);log({event:'verified-copy-source-already-absent',id:a.id});continue;}
    throw Error('source metadata readback failed; deletion held');
   }
   check(current.id===a.id&&current.digest===a.digest&&current.workflow_run?.id===a.workflow_run.id,'source identity changed; deletion held');
   s.deleteIntentAt=new Date().toISOString();atomic(saveFile,state);exec('gh',['api','-X','DELETE',`repos/${REPO}/actions/artifacts/${a.id}`]);
   await confirmAbsent(()=>cp.spawnSync('gh',['api',`repos/${REPO}/actions/artifacts/${a.id}`],{encoding:'utf8'}));
   s.deleted=true;s.deletedAt=new Date().toISOString();atomic(saveFile,state);log({event:'github-artifact-deleted',id:a.id,bytes:a.size_in_bytes,sha256:s.sha256});
  }
 }
 try{
  check(gh([`repos/${REPO}`]).private===false,'expected public source repository');
  const inventory=[];for(let page=1;;page++){const x=gh([`repos/${REPO}/actions/artifacts?per_page=100&page=${page}`]);inventory.push(...x.artifacts);if(x.artifacts.length<100)break;}
  for(const a of inventory)admitArtifact(a);atomic(path.join(work,'inventory.json'),inventory);atomic(saveFile,state);
  await start();const present=new Set(inventory.map(a=>a.id));
  // A previous DELETE may have succeeded before its readback/ledger update.
  // Reconstruct that whole ZIP and receipt from remote storage before recording
  // absence; do not trust a saved verification flag or re-delete blindly.
  for(const s of Object.values(state.artifacts).filter(s=>!s.deleted)){
   if(!present.has(s.id))check(s.receipt?.verified&&s.parts.every(p=>p.verified),'missing source without complete preserved copy');
   // Drain previously staged data before accepting new source bytes. This also
   // makes a copied-but-not-yet-verified prefix readable after cache removal.
   for(const p of [...s.parts,...(s.receipt?[s.receipt]:[])]){pending.push(p);staged+=p.bytes;if(staged>=batchBytes)await flush();}await flush();
  }
  let completed=0;
  for(const a of inventory.filter(a=>a.size_in_bytes<=maxArtifactBytes).sort((a,b)=>a.size_in_bytes-b.size_in_bytes)){
   if(completed>=maxArtifacts)break;
   let s=state.artifacts[a.id];if(s?.deleted)continue;
   s??=state.artifacts[a.id]={id:a.id,digest:a.digest,sourceRun:a.workflow_run.id,source:a,parts:[]};
   check(s.digest===a.digest&&s.sourceRun===a.workflow_run.id,'resume source changed');
   const token=exec('gh',['auth','token']).trim();
   const first=await fetch(`https://api.github.com/repos/${REPO}/actions/artifacts/${a.id}/zip`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'manual',signal:AbortSignal.timeout(30000)});
   check(first.status===302,'artifact download admission');const url=admitRedirect(first.headers.get('location'));
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(3600000)});check(response.ok,'artifact CDN response');
   let bytes=0,index=0;const whole=crypto.createHash('sha256');
   for await(const b of split(response.body)){
    bytes+=b.length;check(bytes<=MAX_ARTIFACT,'artifact streaming bound');whole.update(b);const name=`github-actions/${a.id}/part-${String(index).padStart(6,'0')}.bin`,sha256=hash(b);let p=s.parts[index];
    if(p)check(p.name===name&&p.bytes===b.length&&p.sha256===sha256,'resume bytes changed');
    else{p={name,bytes:b.length,sha256};s.parts.push(p);}
    if(!p.verified)await put(name,b);
    // Saved booleans do not authorize deletion after a restart. Re-download the
    // source, rebind every part, and require fresh independent remote readback.
    if(!fresh.has(p.name)&&!pending.includes(p)){pending.push(p);staged+=b.length;}index++;atomic(saveFile,state);if(staged>=batchBytes)await flush();
   }
   check(bytes===a.size_in_bytes&&whole.digest('hex')===a.digest.slice(7)&&s.parts.length===index,'original archive bytes/SHA256 differ');s.bytes=bytes;s.sha256=a.digest.slice(7);
   const receipt={schema:'awai.operator.github-artifact.v1',repo:REPO,source:a,bytes,sha256:s.sha256,parts:s.parts.map(({name,bytes,sha256})=>({name,bytes,sha256})),storage:'installed legacy AwaiFS; bounded raw-Pack operator archive; not CARv2/WNFS/Native qualification',pin:state.pin};
   const body=Buffer.from(JSON.stringify(receipt));check(body.length<=PART,'receipt bound');const priorReceipt=s.receipt;s.receipt={name:`github-actions/${a.id}/receipt.json`,bytes:body.length,sha256:hash(body)};
   if(priorReceipt?.verified)check(priorReceipt.name===s.receipt.name&&priorReceipt.bytes===body.length&&priorReceipt.sha256===s.receipt.sha256,'resume receipt changed');else await put(s.receipt.name,body);
   pending.push(s.receipt);staged+=body.length;atomic(saveFile,state);completed++;
   if(staged>=batchBytes||completed%16===0)await flush();log({event:'artifact-ingested',id:a.id,bytes,parts:index});
  }
  await flush();await stop();log({event:'run-complete',deleted:Object.values(state.artifacts).filter(s=>s.deleted).length,qualified:Object.values(state.artifacts).filter(s=>deletionAllowed(s.source,s,fresh)).length});return state;
 }finally{await stop();fs.rmdirSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file=process.argv[2];check(file&&path.isAbsolute(file),'explicit absolute operator config required');const c=JSON.parse(fs.readFileSync(file));
 run(c).catch(e=>{console.error('ARCHIVE_HELD: '+e.message);process.exitCode=1;});
}
