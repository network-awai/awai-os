// Restore an exact original ZIP through AwaiFS only. No GitHub client/network.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath}from'node:url';
import {offsite} from './awaifs-offsite.mjs';
import {REPO,PART,readLegacyPart} from './actions-to-awaifs.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=(v,m)=>{if(!v)throw Error(m);};
export function admitReceipt(r,id,digest){
 check(r.schema==='awai.operator.github-artifact.v1'&&r.repo===REPO&&r.source?.id===id&&r.source?.digest==='sha256:'+digest&&r.sha256===digest,'recovery receipt identity');
 check(Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=32*1024**3&&r.bytes===r.source.size_in_bytes&&Array.isArray(r.parts)&&r.parts.length<=4096,'recovery receipt bounds');
 let total=0;for(const[p,i]of r.parts.map((p,i)=>[p,i])){check(p.name===`github-actions/${id}/part-${String(i).padStart(6,'0')}.bin`&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&p.bytes<=PART&&/^[a-f0-9]{64}$/.test(p.sha256),'recovery part admission');total+=p.bytes;}check(total===r.bytes,'recovery complete coverage');return r;
}
export function recover(c){
 const {work,output,credentialsPlist,artifactId:id,expectedSha256:digest}=c;
 for(const p of [work,output,credentialsPlist])check(path.isAbsolute(p),'explicit absolute recovery paths');
 check(Number.isSafeInteger(id)&&id>0&&/^[a-f0-9]{64}$/.test(digest),'caller-pinned source digest required');
 fs.mkdirSync(work,{recursive:true,mode:0o700});check(!fs.existsSync(output),'refuse output overwrite');
 const cold=fs.mkdtempSync(path.join(work,'restore-'));fs.mkdirSync(path.join(cold,'packs'));const store=offsite(credentialsPlist);
 store.pull('recovery-root.json',path.join(cold,'root.json'));const root=JSON.parse(fs.readFileSync(path.join(cold,'root.json')));
 check(root.schema==='awai.operator.archive-root.v1'&&root.repo===REPO&&/^[a-f0-9]{64}$/.test(root.catalog),'archive root locator');
 store.pull(`manifests/sha256-${root.catalog}.json`,path.join(cold,'manifest.json'));const raw=fs.readFileSync(path.join(cold,'manifest.json'));check(raw.length<=256*1024**2&&sha(raw)===root.catalog,'recovery catalog SHA256');const catalog=JSON.parse(raw);
 const sizes=new Map(catalog.packs.map(p=>[p['pack-index'],p.bytes]));
 function fetchFiles(names){
  const packs=new Set();for(const name of names){const fm=catalog.files[name];check(fm&&fm['file-size']<=PART&&Array.isArray(fm.entries),'missing logical archive member');for(const e of fm.entries){check(Number.isSafeInteger(e.pack)&&e.pack>=0,'Pack reference');packs.add(e.pack);}}
  let bytes=0;for(const p of packs){check(Number.isSafeInteger(sizes.get(p))&&sizes.get(p)>=0,'unknown Pack size');bytes+=sizes.get(p);}check(bytes<=2*1024**3,'bounded cold cache');
  const list=path.join(cold,'packs.txt');fs.writeFileSync(list,[...packs].map(i=>`pack-${i}.car`).join('\n')+'\n',{mode:0o600});store.packs(list,path.join(cold,'packs'));
 }
 const receiptName=`github-actions/${id}/receipt.json`;fetchFiles([receiptName]);const fm=catalog.files[receiptName];check(fm['file-size']<=2*1024**2,'receipt size');
 const pieces=[];let count=0;for(const e of fm.entries){check(Number.isSafeInteger(e.length)&&e.length>0&&e.length<=PART&&Number.isSafeInteger(e['pack-offset'])&&e['pack-offset']>=0,'receipt extent');count+=e.length;check(count<=2*1024**2,'receipt extent sum');const b=Buffer.alloc(e.length),fd=fs.openSync(path.join(cold,'packs',`pack-${e.pack}.car`),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{check(fs.readSync(fd,b,0,b.length,e['pack-offset'])===b.length,'receipt short read');pieces.push(b);}finally{fs.closeSync(fd);}}
 const body=Buffer.concat(pieces);readLegacyPart(cold,fm,{bytes:body.length,sha256:sha(body)});const r=admitReceipt(JSON.parse(body),id,digest);
 const space=fs.statfsSync(path.dirname(output));check(space.bavail*space.bsize>r.bytes+2*1024**3+4*1024**3,'restore disk reserve');
 const partial=output+'.pending',fd=fs.openSync(partial,'wx',0o600),whole=crypto.createHash('sha256');
 try{
  for(let i=0;i<r.parts.length;i+=16){for(const n of fs.readdirSync(path.join(cold,'packs')))fs.unlinkSync(path.join(cold,'packs',n));const group=r.parts.slice(i,i+16);fetchFiles(group.map(p=>p.name));for(const p of group)readLegacyPart(cold,catalog.files[p.name],p,b=>{whole.update(b);fs.writeSync(fd,b);});}
  check(fs.fstatSync(fd).size===r.bytes&&whole.digest('hex')===digest,'restored whole original ZIP SHA256');fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 fs.linkSync(partial,output);fs.unlinkSync(partial);const dir=fs.openSync(path.dirname(output),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 fs.rmSync(cold,{recursive:true});return {restored:true,artifactId:id,bytes:r.bytes,sha256:digest,catalog:root.catalog,source:'AwaiFS offsite empty cache; no GitHub requests'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const p=process.argv[2];check(p&&path.isAbsolute(p),'explicit recovery config');console.log(JSON.stringify(recover(JSON.parse(fs.readFileSync(p)))));}catch(e){console.error('RECOVERY_HELD: '+e.message);process.exitCode=1;}
}
