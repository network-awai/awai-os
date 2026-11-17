import {readFile,lstat,mkdir} from 'node:fs/promises';import {atomicJSON} from '../update-linux.mjs';
if(process.getuid?.()!==0)throw Error('root required');
const c=JSON.parse(await readFile(process.argv[2],'utf8'));
if(c.schema!=='aiueos.update-config.v1'||c.enabled!==true||c.ownerPolicyAuthorized!==true||c.role!=='standalone'||!Number.isSafeInteger(c.initialSequence)||!Array.isArray(c.sources)||!c.sources.length||!c.trust?.keys||!Number.isSafeInteger(c.trust.threshold)||c.trust.threshold<1)throw Error('invalid owner provision');
const root='/var/lib/aiueos-update';await mkdir(root,{recursive:true,mode:0o700});
const s=await lstat(root);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))throw Error('unsafe state directory');
for(const name of ['config.json','journal.json']){try{await lstat(root+'/'+name);throw Error('already provisioned');}catch(e){if(e.code!=='ENOENT')throw e;}}
// Journal before enabled config: interrupted provisioning cannot reset high-water.
await atomicJSON(root+'/journal.json',{revision:1,highestSequence:c.initialSequence,pending:null,blocked:[]});
await atomicJSON(root+'/config.json',c);
