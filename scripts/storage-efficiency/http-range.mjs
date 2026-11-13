// Read-only, fixed known public fixture over the existing loopback service.
import fs from 'node:fs';import {performance} from 'node:perf_hooks';import {createHash} from 'node:crypto';
const [file,out]=process.argv.slice(2);
const expected=fs.readFileSync(file);
const url='http://127.0.0.1:8586/itonami-runtime-AWAI-2795-20261112/observation.json';
const offset=100,length=1024;
const times=[];for(let i=0;i<31;i++){
 const t=performance.now();const r=await fetch(url,{headers:{Range:`bytes=${offset}-${offset+length-1}`}});
 const b=Buffer.from(await r.arrayBuffer());
 if(r.status!==206||r.headers.get('content-range')!==`bytes ${offset}-${offset+length-1}/${expected.length}`||!b.equals(expected.subarray(offset,offset+length)))throw Error('range verification failed');
 if(i)times.push(performance.now()-t);
}
const v=[...times].sort((a,b)=>a-b),q=f=>v[Math.ceil(v.length*f)-1];
fs.writeFileSync(out,JSON.stringify({schema:'awai.fs-efficiency.http.v1',observedAt:new Date().toISOString(),
 scope:'existing-loopback-AwaiVol-HTTP-range-public-fixture',sourceSha256:createHash('sha256').update(expected).digest('hex'),
 payloadBytes:expected.length,rangeBytes:length,verified:true,unit:'ms',n:30,warmup:1,
 p50:q(.5),p95:q(.95),p99:q(.99),rawMs:times,
 note:'Warm service/page/client connection cache; network/server overhead included. Disk bytes/cache hit ratio not instrumented; no remote distributed query or Datalog claim.'},null,2)+'\n',{flag:'wx'});
