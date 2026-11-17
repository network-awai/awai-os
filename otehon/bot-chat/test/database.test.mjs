import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync,spawnSync} from 'node:child_process';import {createHash,randomUUID,randomBytes} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..'),otehon=path.resolve(root,'..');
const manifest=JSON.parse(await fs.readFile(path.join(root,'vendor/sources.json')));
const classpath=[...Object.keys(manifest.pins).map(r=>path.join(root,'vendor',r,'src')),path.join(root,'src'),path.join(otehon,'storage/src'),path.join(otehon,'storage/vendor/apex/src'),path.join(otehon,'storage/vendor/apex-car/src')].join(':');
const testRoot=path.resolve(process.env.CHAT_TEST_ROOT??'.agent-output',`chat-database-${randomUUID()}`);await fs.mkdir(testRoot,{recursive:true,mode:0o700});
const invoke=(directory,value,success=true)=>{const r=spawnSync(process.env.BB_BIN??'bb',['--classpath',classpath,'-m','itonami-chat.database',directory],{input:JSON.stringify(value),encoding:'utf8'});if(success){assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}assert.notEqual(r.status,0);return r;};
test('historical Otehon dependency files match pinned bytes',async()=>{for(const f of manifest.files){const bytes=await fs.readFile(path.join(root,'vendor',f.repo,f.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);}});
test('real Kotobase over AwaiFS recovers conversations in a new process and rejects conflicting IDs',()=>{
 const directory=path.join(testRoot,'recovery'),thread='a'.repeat(64),message={id:'m1',role:'user',text:'日本語の会話',at:'2026-11-13T08:00:00Z'};
 const first=invoke(directory,{op:'append',thread,events:[message]});assert.equal(first.store.engine,'kotobase-peer');assert.equal(first.store.backend,'awai-fs-otehon-pack');assert.equal(first.store.readback,true);
 const restarted=invoke(directory,{op:'history',thread});assert.deepEqual(restarted.messages,[message]);assert.equal(restarted.store.headCid,first.store.headCid);
 assert.equal(invoke(directory,{op:'append',thread,events:[message]}).store.headCid,first.store.headCid);
 invoke(directory,{op:'append',thread,events:[{...message,text:'overwrite'}]},false);assert.deepEqual(invoke(directory,{op:'history',thread}).messages,[message]);
 invoke(directory,{op:'history',thread:'../escape'},false);
});
test('wrong or missing key and tampered durable CAR fail closed',async()=>{
 const directory=path.join(testRoot,'tamper'),thread='b'.repeat(64),message={id:'m1',role:'assistant',text:'Synthetic private reply',at:'2026-11-13T08:00:00Z'};invoke(directory,{op:'append',thread,events:[message]});
 const keyPath=path.join(directory,'master.key'),key=await fs.readFile(keyPath);assert.equal((await fs.stat(keyPath)).mode&0o777,0o600);await fs.writeFile(keyPath,randomBytes(32));invoke(directory,{op:'history',thread},false);await fs.writeFile(keyPath,key);
 await fs.rename(keyPath,keyPath+'.backup');invoke(directory,{op:'history',thread},false);await fs.rename(keyPath+'.backup',keyPath);
 const folder=path.join(directory,'threads',thread),car=(await fs.readdir(folder)).find(f=>f.endsWith('.car'));assert.ok(car);const p=path.join(folder,car),bytes=await fs.readFile(p);assert.equal(bytes.includes(Buffer.from(message.text)),false);bytes[bytes.length-1]^=1;await fs.writeFile(p,bytes);invoke(directory,{op:'history',thread},false);
});
