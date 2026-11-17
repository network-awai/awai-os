// Offline publisher: exports the COMPLETE Nix closure, then signs exact manifest.
import {spawnSync,spawn} from 'node:child_process';import {readFile,writeFile,mkdir,rename,open} from 'node:fs/promises';import {createReadStream,createWriteStream} from 'node:fs';import {pipeline} from 'node:stream/promises';import {createHash,createPrivateKey,sign} from 'node:crypto';import {join} from 'node:path';
import {runVMGate,sourceDigest} from './check-setup-vm.mjs';
const [specFile,keyFile,out,nixpkgs]=process.argv.slice(2);if(!nixpkgs)throw Error('spec key output-directory pinned-nixpkgs required');
const spec=JSON.parse(await readFile(specFile,'utf8'));
if(spec.systemPath?.endsWith('.drv')||!/^\/nix\/store\/[a-z0-9]{32}-nixos-system-[a-zA-Z0-9.+_-]+$/.test(spec.systemPath)||!Number.isSafeInteger(spec.sequence)||!spec.keyId)throw Error('invalid release spec');
// Recompute against exact release source and pin; caller-provided proofs are ignored.
const vmGate=runVMGate(nixpkgs,{systemPath:spec.systemPath});
const key=keyFile==='--unsigned'?null:createPrivateKey(await readFile(keyFile));if(key&&key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 required');
await mkdir(out,{recursive:true});
const query=spawnSync('nix-store',['--query','--requisites',spec.systemPath],{encoding:'utf8',maxBuffer:16*1024*1024});if(query.status!==0)throw Error('closure query failed');const paths=query.stdout.trim().split('\n');
const child=spawn('nix-store',['--export',...paths],{stdio:['ignore','pipe','inherit']});const exit=new Promise((ok,bad)=>{child.on('error',bad);child.on('exit',code=>code===0?ok():bad(Error('export failed')));});
await pipeline(child.stdout,createWriteStream(join(out,'closure.part'),{mode:0o600}));await exit;
const hash=createHash('sha256');let size=0;for await(const b of createReadStream(join(out,'closure.part'))){hash.update(b);size+=b.length;}const sha=hash.digest('hex');await rename(join(out,'closure.part'),join(out,sha+'.nar-export'));
if(sourceDigest()!==vmGate.sourceSha256)throw Error('source changed during release export');
const {keyId,...metadata}=spec;const payload=Buffer.from(JSON.stringify({...metadata,vmGate,schema:'aiueos.release.v1',closureSha256:sha,closureBytes:size}));const envelope={payload:payload.toString('base64'),signatures:key?[{keyId,signature:sign(null,payload,key).toString('base64')}]:[]};await writeFile(join(out,'manifest.json.part'),JSON.stringify(envelope));const file=await open(join(out,'manifest.json.part'),'r');await file.sync();await file.close();await rename(join(out,'manifest.json.part'),join(out,key?'manifest.json':'manifest.pending.json'));
console.log(JSON.stringify({sequence:spec.sequence,systemPath:spec.systemPath,closureSha256:sha,closureBytes:size}));
