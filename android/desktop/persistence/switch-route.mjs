// Update only our already-owned audit symlink, preserving both artifact directories.
import {readFile,lstat,readlink,readdir,symlink,rename,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [recordPath,newRootArg,pinsPath,output]=process.argv.slice(2);assert(output);
const prior=JSON.parse(await readFile(recordPath)),newRoot=resolve(newRootArg),pins=JSON.parse(await readFile(pinsPath));
assert(prior.state==='active');assert((await lstat(prior.oldRoot)).isSymbolicLink());assert.equal(await readlink(prior.oldRoot),prior.newRoot);
assert((await lstat(prior.activeLink)).isSymbolicLink());assert.equal(await readlink(prior.activeLink),prior.oldRoot);
assert((await lstat(newRoot)).isDirectory()&&!(await lstat(newRoot)).isSymbolicLink());
assert.deepEqual((await readdir(newRoot)).sort(),['initrd','ipxe.efi','kernel']);
for(const name of ['kernel','initrd','ipxe.efi']){assert((await lstat(newRoot+'/'+name)).isFile());const b=await readFile(newRoot+'/'+name);assert.equal(b.length,pins.files[name].bytes);assert.equal(createHash('sha256').update(b).digest('hex'),pins.files[name].sha256);}
const next={...prior,newRoot,previousRoot:prior.newRoot,checkedAt:new Date().toISOString(),state:'prepared'};
await writeFile(output,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});
const staged=prior.oldRoot+'.switch-'+Date.now();await symlink(newRoot,staged,'dir');
assert.equal(await readlink(prior.oldRoot),prior.newRoot);await rename(staged,prior.oldRoot);
next.state='active';await writeFile(output,JSON.stringify(next,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(next));
