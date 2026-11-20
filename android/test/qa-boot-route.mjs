// Physical QA must retain its LAN boot files before touching apps or rebooting.
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
export async function checkBootFiles(routeFile,manifestFile){
 assert(routeFile&&manifestFile,'physical QA requires --boot-route and --boot-manifest');
 const route=JSON.parse(await readFile(routeFile)),manifest=JSON.parse(await readFile(manifestFile));
 assert.equal(route.schema,'awai.boot.route.transition.v1');assert.equal(route.state,'active');
 assert.equal(manifest.schema,'awai.android.audit.artifacts.v1');
 assert.equal(await realpath(route.activeLink),await realpath(route.newRoot),'TFTP route differs from pinned Android artifacts');
 for(const name of ['kernel','initrd','ipxe.efi']){
  const bytes=await readFile(path.join(route.activeLink,name)),pin=manifest.files[name];
  assert.equal(bytes.length,pin.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);
 }
 return {routeFile:path.resolve(routeFile),manifestFile:path.resolve(manifestFile),files:manifest.files};
}
