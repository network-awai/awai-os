// Signs exact envelope bytes on Mac; private keys stay in the login Keychain.
import {spawnSync} from 'node:child_process';import {readFile} from 'node:fs/promises';import {createPublicKey,verify} from 'node:crypto';import {fileURLToPath} from 'node:url';import {atomicJSON} from '../update-linux.mjs';
import {validateVMGate,sourceDigest} from './check-setup-vm.mjs';
export function appendSignature(envelope,keyId,rawPublic,signature){
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(keyId)||typeof envelope.payload!=='string'||envelope.payload.length>131072||!Array.isArray(envelope.signatures)||envelope.signatures.length>=32||envelope.signatures.some(x=>x.keyId===keyId))throw Error('invalid or duplicate signer');
 const bytes=Buffer.from(envelope.payload,'base64'),raw=Buffer.from(rawPublic,'base64');if(raw.length!==32||bytes.toString('base64')!==envelope.payload)throw Error('invalid public key or payload');
 const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw]),type:'spki',format:'der'});
 if(!verify(null,bytes,key,Buffer.from(signature,'base64')))throw Error('Keychain signature mismatch');
 return {envelope:{...envelope,signatures:[...envelope.signatures,{keyId,signature}]},publicKey:key.export({type:'spki',format:'pem'}).toString()};
}
async function main(){const [manifest,keyId,helper]=process.argv.slice(2);if(!helper)throw Error('manifest key-id compiled-signer required');const e=JSON.parse(await readFile(manifest,'utf8'));const release=JSON.parse(Buffer.from(e.payload,'base64'));validateVMGate(release.vmGate,release.systemPath,sourceDigest());const run=(op,input)=>{const p=spawnSync(helper,[op,keyId],{input,encoding:'utf8',timeout:120000,maxBuffer:16384});if(p.status!==0)throw Error('Keychain signer failed');return p.stdout.trim();};
 const result=appendSignature(e,keyId,run('public'),run('sign',Buffer.from(e.payload,'base64')));await atomicJSON(manifest,result.envelope);console.log(JSON.stringify({keyId,publicKey:result.publicKey,signatures:result.envelope.signatures.length}));}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
