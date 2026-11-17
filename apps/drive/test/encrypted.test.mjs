import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const ctx=vm.createContext({window:{},crypto:globalThis.crypto,TextEncoder,TextDecoder,Uint8Array,DataView,atob,btoa,console});vm.runInContext(fs.readFileSync(new URL('../generated/core.js',import.meta.url),'utf8'),ctx);const core=ctx.window.AwaiDriveEncrypted;
test('owner-store hybrid bytes survive CAR roundtrip; wrong key/root/corrupt/truncated data refuse',async()=>{
 const secret=crypto.getRandomValues(new Uint8Array(32));const record=await core.newRecord(secret);
 const bytes=Uint8Array.from({length:262121},(_,i)=>(i*29+7)%256),text=new TextEncoder().encode('private-canary-3014');
 const rows=[{path:'documents/invoice.bin',bytes},{path:'private-canary-name.txt',bytes:text}];rows.directories=['empty-directory'];const snapshot=await core.sealSnapshot(record,secret,rows);
 assert.equal(new TextDecoder().decode(snapshot.bytes).includes('private-canary-name'),false);assert.equal(new TextDecoder().decode(snapshot.bytes).includes('private-canary-3014'),false);
 const recovered=await core.openSnapshot(record,secret,snapshot.root,snapshot.bytes);assert.equal(recovered.length,2);assert.deepEqual(Array.from(recovered.directories),['empty-directory']);assert.deepEqual(Array.from(recovered[0].bytes),Array.from(bytes));assert.deepEqual(Array.from(recovered[1].bytes),Array.from(text));
 await assert.rejects(async()=>core.openSnapshot(record,new Uint8Array(32),snapshot.root,snapshot.bytes));
 await assert.rejects(async()=>core.openSnapshot(record,secret,'0'.repeat(64),snapshot.bytes));
 const bad=snapshot.bytes.slice();bad[bad.length-1]^=1;await assert.rejects(async()=>core.openSnapshot(record,secret,snapshot.root,bad));
 await assert.rejects(async()=>core.openSnapshot(record,secret,snapshot.root,snapshot.bytes.slice(0,-1)));
 await assert.rejects(async()=>core.sealSnapshot(record,secret,[{path:'../escape',bytes:text}]));secret.fill(0);
});
