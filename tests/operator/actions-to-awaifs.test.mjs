import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {admitArtifact,admitRedirect,split,readLegacyPart,deletionAllowed,confirmAbsent,installedFingerprint,verifyColdTranscript,PART} from '../../scripts/operator/actions-to-awaifs.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const a={id:10,digest:'sha256:'+'a'.repeat(64),size_in_bytes:8,expired:false,workflow_run:{id:9}};
test('admission rejects unknown digest, expired archive, changed size and unbound run',()=>{
 assert.equal(admitArtifact(a),a);
 for(const p of [{digest:null},{expired:true},{size_in_bytes:33*1024**3},{workflow_run:null},{id:-1}])assert.throws(()=>admitArtifact({...a,...p}));
});
test('a peer proof byte stream must cover exactly the ordered parts, never only a peer success flag',async()=>{
 const a=Buffer.from('first'),b=Buffer.from('second'),parts=[{bytes:a.length,sha256:sha(a)},{bytes:b.length,sha256:sha(b)}],bytes=Buffer.concat([a,b]);
 async function* feed(buf){yield buf.subarray(0,2);yield buf.subarray(2,8);yield buf.subarray(8);}
 await verifyColdTranscript(feed(bytes),parts);
 await assert.rejects(()=>verifyColdTranscript(feed(bytes.subarray(0,bytes.length-1)),parts));
 await assert.rejects(()=>verifyColdTranscript(feed(Buffer.concat([bytes,Buffer.from('extra')])),parts));
 const wrong=Buffer.from(bytes);wrong[3]^=1;await assert.rejects(()=>verifyColdTranscript(feed(wrong),parts));
});
test('eventually consistent source deletion is retried, an unknown outcome never becomes success',async()=>{
 let calls=0;await confirmAbsent(()=>++calls<3?{status:0,stderr:''}:{status:1,stderr:'HTTP 404'},async()=>{});assert.equal(calls,3);
 await assert.rejects(()=>confirmAbsent(()=>({status:0,stderr:''}),async()=>{}));
 await assert.rejects(()=>confirmAbsent(()=>({status:1,stderr:'HTTP 401'}),async()=>{}));
});
test('a changed installed helper changes the runtime admission fingerprint',()=>{
 const base=path.resolve('.agent-output/operator-tests');fs.mkdirSync(base,{recursive:true});const app=fs.mkdtempSync(path.join(base,'app-'));fs.mkdirSync(path.join(app,'src'));fs.writeFileSync(path.join(app,'awaivol.cljc'),'one');fs.writeFileSync(path.join(app,'src','hash.cljc'),'two');const before=installedFingerprint(app);fs.writeFileSync(path.join(app,'src','hash.cljc'),'changed');assert.notEqual(installedFingerprint(app),before);fs.rmSync(app,{recursive:true});
});
test('signed CDN redirect is HTTPS-only and never an arbitrary credential recipient',()=>{
 assert.equal(admitRedirect('https://productionresultssa1.blob.core.windows.net/a?sig=private').hostname,'productionresultssa1.blob.core.windows.net');
 for(const u of ['http://x.blob.core.windows.net/a','https://github.com/a','https://x.blob.core.windows.net.evil.test/a','https://user:password@x.blob.core.windows.net/a','https://x.blob.core.windows.net:8443/a'])assert.throws(()=>admitRedirect(u));
});
test('arbitrary incoming frame boundaries preserve exact complete archive with bounded pieces',async()=>{
 const bytes=crypto.randomBytes(PART*2+73);async function* incoming(){yield bytes.subarray(0,11);yield bytes.subarray(11,PART+1);yield bytes.subarray(PART+1);}
 const parts=[];for await(const p of split(incoming())){assert.ok(p.length<=PART);parts.push(p);}assert.equal(parts.length,3);assert.deepEqual(Buffer.concat(parts),bytes);
});
test('cold recovery validates offsets, full logical coverage and every SHA; corruption/missing data refuses',()=>{
 const base=path.resolve('.agent-output/operator-tests');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'cold-'));fs.mkdirSync(path.join(root,'packs'));
 const bytes=Buffer.from('abcdefgh'),pack=path.join(root,'packs','pack-8.car');fs.writeFileSync(pack,Buffer.concat([Buffer.from('pad'),bytes]));
 const fm={'file-size':8,entries:[{offset:0,length:4,pack:8,'pack-offset':3,sha:sha(bytes.subarray(0,4))},{offset:4,length:4,pack:8,'pack-offset':7,sha:sha(bytes.subarray(4))}]};const p={bytes:8,sha256:sha(bytes)};
 assert.equal(readLegacyPart(root,fm,p),true);assert.throws(()=>readLegacyPart(root,{...fm,'file-size':7},p));
 assert.throws(()=>readLegacyPart(root,{...fm,entries:[fm.entries[1],fm.entries[0]]},p));
 fs.writeFileSync(pack,Buffer.alloc(11));assert.throws(()=>readLegacyPart(root,fm,p));fs.unlinkSync(pack);assert.throws(()=>readLegacyPart(root,fm,p));
 fs.symlinkSync('/etc/hosts',pack);assert.throws(()=>readLegacyPart(root,fm,p));fs.unlinkSync(pack);fs.rmdirSync(path.join(root,'packs'));fs.rmdirSync(root);
});
test('deletion requires complete independent readback and exact original identity, never local PUT acceptance',()=>{
 const s={id:a.id,digest:a.digest,sourceRun:9,bytes:8,sha256:a.digest.slice(7),receipt:{name:'receipt',verified:true},parts:[{name:'part',verified:true,snapshot:'b'.repeat(64)}]},fresh=new Set(['receipt','part']);
 assert.equal(deletionAllowed(a,s,fresh),true);assert.equal(deletionAllowed(a,s),false);assert.equal(deletionAllowed(a,s,new Set(['part'])),false);
 for(const p of [{id:11},{digest:'sha256:'+'b'.repeat(64)},{sourceRun:11},{bytes:9},{receipt:{verified:false}},{parts:[{verified:false,snapshot:'b'.repeat(64)}]},{parts:[{verified:true}]},{parts:[]}])assert.equal(deletionAllowed(a,{...s,...p},fresh),false);
});
