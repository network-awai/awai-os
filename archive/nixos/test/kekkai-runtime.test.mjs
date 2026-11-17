import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const sha=v=>createHash('sha256').update(v).digest('hex');
test('frozen offline Kekkai runtime matches namespace provenance and executes its real key provider',()=>{
 const manifest=JSON.parse(readFileSync('archive/nixos/kekkai-runtime-sources.json'));
 assert.equal(sha(readFileSync('archive/nixos/kekkai-runtime.tar.gz')),manifest.bundleSha256);
 const root=mkdtempSync(join(tmpdir(),'kekkai-runtime-'));
 try{
  const unpack=spawnSync('tar',['-xzf','archive/nixos/kekkai-runtime.tar.gz','-C',root]);assert.equal(unpack.status,0);
  for(const source of manifest.sources){const name=source.namespace.replaceAll('.','/').replaceAll('-','_');let content;
   for(const extension of ['.cljk','.cljs','.cljc']){try{content=readFileSync(join(root,'src',name+extension));break;}catch(e){if(e.code!=='ENOENT')throw e;}}
   assert.ok(content,source.namespace);assert.equal(sha(content),source.sha256,source.namespace);
  }
  copyFileSync('archive/nixos/kekkai-bootstrap.cljk',join(root,'bootstrap.cljk'));
  const result=spawnSync(process.execPath,[join(root,'engine/cli.js'),'--classpath',join(root,'src'),join(root,'bootstrap.cljk'),'client-key','unused'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const pair=JSON.parse(result.stdout);assert.match(pair.pub,/^[a-f0-9]{64}$/);assert.match(pair.priv,/^[a-f0-9]{64}$/);assert.notEqual(pair.pub,pair.priv);
 }finally{rmSync(root,{recursive:true,force:true});}
});

import {prepareSSHKey} from '../kekkai-setup-client.mjs';
test('first pairing creates a private local SSH key but never replaces an existing identity',()=>{
 const root=mkdtempSync(join(tmpdir(),'kekkai-identity-'));
 try{
  const path=join(root,'manager'),first=prepareSSHKey(path);
  assert.match(first.key,/^ssh-ed25519 /);const privateBefore=readFileSync(path),publicBefore=readFileSync(path+'.pub');
  assert.deepEqual(prepareSSHKey(path),first);
  assert.deepEqual(readFileSync(path),privateBefore);assert.deepEqual(readFileSync(path+'.pub'),publicBefore);
  rmSync(path);
  assert.throws(()=>prepareSSHKey(path),/existing public key was preserved/);
  assert.deepEqual(readFileSync(path+'.pub'),publicBefore);
 }finally{rmSync(root,{recursive:true,force:true});}
});
