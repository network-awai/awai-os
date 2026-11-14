// Read-only installed AwaiVol inventory and bounded in-memory compression oracle.
// No filenames, payloads, credentials or prompts are emitted. No live writes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
const [root,out,mode]=process.argv.slice(2);
if(!out)throw Error('usage: node live-audit.mjs VOLUME_ROOT NEW_REPORT');
const sha=b=>createHash('sha256').update(b).digest('hex');
const start=new Date().toISOString(), raw=fs.readFileSync(path.join(root,'manifest.json'));
const m=JSON.parse(raw), files=Object.values(m.files),entries=files.flatMap(f=>f.entries||[]);
const stats=a=>{const v=[...a].sort((a,b)=>a-b);return {n:v.length,min:v[0],p50:v[Math.ceil(v.length*.5)-1],p95:v[Math.ceil(v.length*.95)-1],p99:v[Math.ceil(v.length*.99)-1],max:v.at(-1)};};
const measure=fn=>{fn();const a=[];for(let i=0;i<30;i++){let t=performance.now();fn();a.push(performance.now()-t);}return stats(a);};
const resident=fs.readdirSync(path.join(root,'packs')).filter(n=>/^pack-\d+\.car$/.test(n)).map(n=>{
 let st=fs.lstatSync(path.join(root,'packs',n));if(!st.isFile()||st.isSymbolicLink())throw Error('unsupported pack');
 return {name:n,index:Number(n.match(/\d+/)[0]),bytes:st.size,blocks:st.blocks,mtime:st.mtimeMs};});
const unique=new Map();for(const e of entries){if(unique.has(e.sha)&&unique.get(e.sha)!==e.length)throw Error('chunk size conflict');unique.set(e.sha,e.length);}
const intervals=new Map();for(const e of entries){const a=intervals.get(e.pack)||[];a.push([e['pack-offset'],e['pack-offset']+e.length]);intervals.set(e.pack,a);}
function union(a){let end=-1,n=0;for(const [s,e] of a.sort((a,b)=>a[0]-b[0])){n+=Math.max(0,e-Math.max(s,end));end=Math.max(end,e);}return n;}
const liveByPack=new Map([...intervals].map(([k,a])=>[k,union(a)]));
const residentBytes=resident.reduce((a,x)=>a+x.bytes,0), residentLive=resident.reduce((a,x)=>a+(liveByPack.get(x.index)||0),0);
// Stratified quantiles by pack size, at most 32 packs / 8 MiB. Not a random sample.
const ordered=[...resident].sort((a,b)=>a.bytes-b.bytes||a.index-b.index),selected=[];
let selectedBytes=0;
for(let i=0;i<Math.min(32,ordered.length);i++){const row=ordered[Math.floor(i*(ordered.length-1)/Math.max(1,Math.min(32,ordered.length)-1))];
 if(row.bytes>0&&selectedBytes+row.bytes<=8*1024*1024&&!selected.some(x=>x.index===row.index)){selected.push(row);selectedBytes+=row.bytes;}}
if(mode==="--full"){if(residentBytes>64*1024*1024)throw Error("full audit exceeds 64 MiB bound");selected.splice(0,selected.length,...resident.filter(r=>r.bytes>0));}
const buffers=selected.map(r=>fs.readFileSync(path.join(root,'packs',r.name)));
for(let i=0;i<selected.length;i++){const st=fs.statSync(path.join(root,'packs',selected[i].name));if(st.size!==selected[i].bytes||st.mtimeMs!==selected[i].mtime)throw Error('sample changed; retry snapshot');}
const corpus=Buffer.concat(buffers);
function z(args,input){let r=spawnSync('zstd',['-q','-T1',...args],{input,maxBuffer:128*1024*1024});if(r.status!==0)throw Error('zstd refused');return r.stdout;}
const compression=[];
for(const level of [1,3,9]){let t=performance.now();const packed=buffers.map(b=>z(['-'+level,'-c'],b));const perPackMs=performance.now()-t;
 const combined=z(['-'+level,'-c'],corpus);t=performance.now();const restored=z(['-d','-c'],combined),decodeMs=performance.now()-t;
 if(!corpus.equals(restored)||!packed.every((b,i)=>z(['-d','-c'],b).equals(buffers[i])))throw Error('roundtrip mismatch');
 compression.push({level,perPackBytes:packed.reduce((n,b)=>n+b.length,0),concatenatedBytes:combined.length,
 perPackCliMs:perPackMs,concatenatedDecodeCliMs:decodeMs,roundtrip:true,
 ratioRawToPerPack:corpus.length/packed.reduce((n,b)=>n+b.length,0)});}
const keys=Object.keys(m.files),first=keys[0],prefix=first?.split('/')[0]??'';
const manifestAfter=fs.readFileSync(path.join(root,'manifest.json'));
const report={schema:'awai.fs-efficiency.live.v1',startedAt:start,endedAt:new Date().toISOString(),
 scope:'installed-AwaiVol-read-only-snapshot',format:'raw-concatenated-chunks; .car suffix is not CARv2',
 manifest:{sha256:sha(raw),bytes:raw.length,unchangedDuringAudit:raw.equals(manifestAfter),files:files.length,
 logicalBytes:files.reduce((n,f)=>n+f['file-size'],0),chunkReferences:entries.length,uniqueChunks:unique.size,
 uniqueLiveChunkBytes:[...unique.values()].reduce((a,b)=>a+b,0)},
 storage:{residentPacks:resident.length,residentPackBytes:residentBytes,residentLiveIntervalBytes:residentLive,
 residentUnreferencedOrSlackBytes:residentBytes-residentLive,residentAllocatedBytes:resident.reduce((a,p)=>a+p.blocks*512,0),
 referencedPacks:liveByPack.size,referencedPacksNotResident:[...liveByPack.keys()].filter(k=>!resident.some(r=>r.index===k)).length,
 totalDeclaredPackBytes:(m.packs||[]).reduce((n,p)=>n+p.bytes,0),journalBytes:fs.statSync(path.join(root,'journal.jsonl')).size,
 note:'Nonresident may be tiered; unreferenced/slack is an estimate, not deletion authorization. APFS blocks are not exclusive billed space.'},
 compression:{sampleStrategy:mode==="--full"?"all nonempty resident packs at snapshot; <=64 MiB bound":"32 size-quantiles, <=8 MiB, not population estimate",packs:buffers.length,
 rawBytes:corpus.length,rawSha256:sha(corpus),levels:compression,installedCompression:'none in inspected payload path',
 timingScope:'one CLI invocation per pack including spawn; single warm sample, not sustained throughput'},
 query:{unit:'ms',cache:'warm process/page cache; 1 warmup +30 samples; no fs cache flush',
 manifestJsonParse:measure(()=>JSON.parse(raw)),
 pointLookup1000:measure(()=>{for(let i=0;i<1000;i++)if(!m.files[first])throw Error('lookup mismatch');}),
 prefixScanAllPaths:measure(()=>keys.filter(k=>k.startsWith(prefix)).length),
 datalog:'unmeasured: not an API of this installed file service'},
 process:{node:process.version,zstd:spawnSync('zstd',['--version'],{encoding:'utf8'}).stdout.trim()}};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({files:report.manifest.files,residentBytes,sampleBytes:corpus.length,stable:report.manifest.unchangedDuringAudit}));
