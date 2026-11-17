// Reversible operator boot-directory route. No existing HTTP/TFTP process is stopped.
import {lstat,readdir,readFile,readlink,rename,symlink,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [planFile,recordFile]=process.argv.slice(2);assert(planFile&&recordFile);
const plan=JSON.parse(await readFile(planFile));
for(const p of [plan.oldRoot,plan.newRoot,plan.activeLink])assert(p===resolve(p));
assert((await lstat(plan.activeLink)).isSymbolicLink());assert.equal(await readlink(plan.activeLink),plan.oldRoot,'Boot route ownership changed');
assert((await lstat(plan.oldRoot)).isDirectory()&&!(await lstat(plan.oldRoot)).isSymbolicLink());
assert((await lstat(plan.newRoot)).isDirectory()&&!(await lstat(plan.newRoot)).isSymbolicLink());
assert.deepEqual((await readdir(plan.oldRoot)).sort(),['artifacts.json','initrd','ipxe.efi','kernel']);
assert.deepEqual((await readdir(plan.newRoot)).sort(),['initrd','ipxe.efi','kernel']);
for(const [root,pins]of [[plan.oldRoot,plan.oldPins],[plan.newRoot,plan.newPins]])for(const name of ['kernel','initrd','ipxe.efi']){
 const path=root+'/'+name;assert((await lstat(path)).isFile());const b=await readFile(path);assert.equal(createHash('sha256').update(b).digest('hex'),pins[name].sha256);
}
const preserved=plan.oldRoot+'.preserved-'+Date.now(),record={schema:'awai.boot.route.transition.v1',checkedAt:new Date().toISOString(),oldRoot:plan.oldRoot,preserved,newRoot:plan.newRoot,activeLink:plan.activeLink,existingServicesStopped:false,state:'prepared'};
await writeFile(recordFile,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
await rename(plan.oldRoot,preserved);
try{await symlink(plan.newRoot,plan.oldRoot,'dir');}catch(error){await rename(preserved,plan.oldRoot);throw error;}
record.state='active';await writeFile(recordFile,JSON.stringify(record,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(record,null,2));
