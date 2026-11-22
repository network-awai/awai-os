// Explicit disposable-fixture acceptance. Never reads the device's app/user data.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const run=promisify(execFile);
const args=process.argv.slice(2);
if(args.length!==4)throw Error('device-lan.mjs <adb-serial> <device-literal-IPv4> <WNFS-CAR> <trusted-WNFS-root>');
const [serial,ip,car,root]=args;
if(!/^[A-Za-z0-9:._-]{1,100}$/.test(serial)||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)||!/^[a-z0-9]{20,120}$/.test(root))throw Error('Invalid explicit fixture target');
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const output=resolve(repo,'.agent-output',`device-lan-${Date.now()}`);await mkdir(output,{recursive:true});
const remote=`/data/local/tmp/awai-3001-${Date.now()}`;
const binary=resolve(repo,'packages/awai-peer/target/debug/awai-peer');
const android=resolve(repo,'packages/awai-peer/target/aarch64-linux-android/debug/awai-peer');
const adb=(...args)=>run('adb',['-s',serial,...args],{timeout:60000,maxBuffer:1048576});
const cli=async(...args)=>JSON.parse((await run(binary,args,{timeout:60000,maxBuffer:1048576})).stdout);
const hash=b=>createHash('sha256').update(b).digest('hex');
const sender=await cli('identity',output+'/sender');
await adb('shell','mkdir',remote);await adb('push',android,remote+'/awai-peer');await adb('shell','chmod','700',remote+'/awai-peer');
const receiver=JSON.parse((await adb('shell',remote+'/awai-peer','identity',remote+'/receiver')).stdout);
const imported=await cli('snapshot-import',output+'/source',resolve(car),root);
const grants=[{allow_read:true,peer_id:sender.peerId,snapshot:imported.snapshot,max_bytes:1048576,expires_at:Math.floor(Date.now()/1000)+300}];
await writeFile(output+'/grants.json',JSON.stringify(grants));await adb('push',output+'/grants.json',remote+'/grants.json');
const service=spawn('adb',['-s',serial,'shell',`echo $$ > ${remote}/provider.pid; exec ${remote}/awai-peer provider ${remote}/receiver ${remote}/grants.json /ip4/${ip}/tcp/0`],{stdio:['ignore','pipe','pipe']});
let error='';service.stderr.on('data',d=>{error+=d;});
try {
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('device provider startup timed out: '+error)),35000);
    createInterface({input:service.stdout}).once('line',line=>{clearTimeout(timer);try{resolve(JSON.parse(line));}catch(e){reject(e);}});
    service.once('exit',code=>{clearTimeout(timer);reject(Error(`provider exited ${code}: ${error}`));});
  });
  assert(ready.address.startsWith(`/ip4/${ip}/tcp/`));assert(ready.address.endsWith('/p2p/'+receiver.peerId));
  const pushed=await cli('sync-push',output+'/sender',output+'/source',ready.address,imported.snapshot);
  assert.equal(pushed.verified.provider,receiver.peerId);assert.equal(pushed.verified.snapshot,imported.snapshot);
  const queried=await cli('pin-query',output+'/sender',output+'/source',ready.address,imported.snapshot);
  assert.equal(queried.verified.blocks,8);
  const pulled=await cli('sync-pull',output+'/sender',output+'/restored',ready.address,imported.snapshot,output+'/restored.car');assert(pulled.verified);
  const original=await readFile(car),returned=await readFile(output+'/restored.car');assert.deepEqual(returned,original);
  const deviceApi=(await adb('shell','getprop','ro.build.version.sdk')).stdout.trim();
  const result={schema:'awai.peer.device.v1',workingTreeCandidate:true,sourceRevision:(await run('git',['rev-parse','HEAD'],{cwd:repo})).stdout.trim(),checkedAt:new Date().toISOString(),devices:['macOS','moto g05'],androidApi:deviceApi,transport:'literal IPv4 TCP/Noise/Yamux',protocol:ready.protocol,independentDevices:true,independentNetworks:false,usbUsedFor:'binary/fixture-grant setup and diagnostics only; no ADB forwarding',sender:sender.peerId,receiver:receiver.peerId,snapshot:imported.snapshot,trustedWnfsRoot:root,blocks:queried.verified.blocks,carBytes:original.length,carSha256:hash(original),returnedCarSha256:hash(returned),verifiedPinReceipt:true,restoredStore:output+'/restored',output,receipt:queried};
  await writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n');await writeFile(resolve(repo,'.agent-output/device-lan-latest.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {
  try { const pid=(await adb('shell','cat',remote+'/provider.pid')).stdout.trim(); if(/^\d+$/.test(pid)) await adb('shell','kill',pid); } finally { service.kill('SIGTERM'); }
  // Only this task's recorded PID is stopped; no shared adb/device service reset.
}
