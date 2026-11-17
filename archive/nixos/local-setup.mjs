// Device identity and local setup completion do not assert an account or fleet admission.
import {identity} from './account-link.mjs';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export async function readLocal(dir='/var/lib/murakumo') {
  try {
    const value=JSON.parse(await readFile(join(dir,'local-setup.json'),'utf8'));
    if(value.version!==1||value.mode!=='local'||value.deviceDid!==(await identity(dir)).did)throw Error('Local setup identity mismatch');
    return value;
  } catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export async function completeLocal(dir='/var/lib/murakumo') {
  const previous=await readLocal(dir);if(previous)return previous;
  const id=await identity(dir);
  const value={version:1,mode:'local',deviceDid:id.did,completedAt:Date.now()};
  const target=join(dir,'local-setup.json'),temporary=target+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});
  await rename(temporary,target);return value;
}
