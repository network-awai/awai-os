import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,open,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
test('multipart resume retains receipts across holes and out-of-order completion',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aiueos-upload-fixture-'));
 try {
  const file=join(dir,'archive'),checkpoint=join(dir,'checkpoint.json'),helper=join(dir,'signer'),shim=join(dir,'fetch.mjs');
  const size=2*33554432+17,key='a'.repeat(64)+'.nar-export';const fd=await open(file,'w');await fd.truncate(size);await fd.close();
  await writeFile(helper,'#!/bin/sh\nprintf fixture-signature\n',{mode:0o700});
  await writeFile(checkpoint,JSON.stringify({key,size,uploadId:'fixture',parts:[null,{partNumber:2,etag:'part-2'}]}));
  await writeFile(shim,`globalThis.fetch=async(url,req)=>{const t=JSON.parse(Buffer.from(req.headers['X-AiueOS-Ticket'],'base64'));if(t.op==='part'){if(t.partNumber===2)throw Error('receipt unnecessarily uploaded again');await new Promise(r=>setTimeout(r,t.partNumber===1?40:5));return Response.json({partNumber:t.partNumber,etag:'part-'+t.partNumber});}if(t.op==='complete'){const p=JSON.parse(req.body);if(JSON.stringify(p)!==JSON.stringify([1,2,3].map(n=>({partNumber:n,etag:'part-'+n}))))throw Error('parts missing or unordered');return Response.json({key:t.key,size:${size}});}throw Error('unexpected operation');};`);
  const result=spawnSync(process.execPath,['--import',shim,new URL('../scripts/upload-release-r2.mjs',import.meta.url).pathname,'https://fixture.invalid',file,key,helper,'fixture',checkpoint],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);const saved=JSON.parse(await readFile(checkpoint,'utf8'));assert.equal(saved.complete.size,size);assert.deepEqual(saved.parts.map(p=>p.partNumber),[1,2,3]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
