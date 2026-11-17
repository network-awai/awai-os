import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import {checkBootFiles} from './qa-boot-route.mjs';
test('refuses missing boot delivery and changed pinned files before hardware mutation',async()=>{
 const dir=await mkdtemp(path.resolve('.agent-output/qa-boot-test-'));
 try{
  const root=path.join(dir,'serve'),link=path.join(dir,'active');await mkdir(root);await symlink(root,link);
  const files={};for(const name of ['kernel','initrd','ipxe.efi']){const bytes=Buffer.from(name);await writeFile(path.join(root,name),bytes);files[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
  const route=path.join(dir,'route.json'),manifest=path.join(dir,'manifest.json');
  await writeFile(route,JSON.stringify({schema:'awai.boot.route.transition.v1',state:'active',activeLink:link,newRoot:root}));
  await writeFile(manifest,JSON.stringify({schema:'awai.android.audit.artifacts.v1',files}));
  await checkBootFiles(route,manifest);
  await writeFile(path.join(root,'kernel'),'tampered');await assert.rejects(checkBootFiles(route,manifest));
  await rm(link);await assert.rejects(checkBootFiles(route,manifest),/ENOENT/);
 }finally{await rm(dir,{recursive:true});}
});
