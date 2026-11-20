// Independent cosigner; signatures cover identical bytes, no mutable reserialization.
import {readFile,writeFile,rename,lstat} from 'node:fs/promises';import {createPrivateKey,sign} from 'node:crypto';
import {validateVMGate,sourceDigest} from './check-setup-vm.mjs';
const [manifest,keyFile,keyId]=process.argv.slice(2);if(!keyId)throw Error('manifest private-key key-id required');
const s=await lstat(keyFile);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077))throw Error('private key permissions');
const e=JSON.parse(await readFile(manifest,'utf8'));const release=JSON.parse(Buffer.from(e.payload,'base64'));validateVMGate(release.vmGate,release.systemPath,sourceDigest());if(typeof e.payload!=='string'||e.payload.length>131072||!Array.isArray(e.signatures)||e.signatures.length>=32||e.signatures.some(x=>x.keyId===keyId))throw Error('invalid envelope or duplicate signer');
const key=createPrivateKey(await readFile(keyFile));if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 required');
const bytes=Buffer.from(e.payload,'base64');if(bytes.toString('base64')!==e.payload)throw Error('noncanonical payload');
e.signatures.push({keyId,signature:sign(null,bytes,key).toString('base64')});await writeFile(manifest+'.signed',JSON.stringify(e),{mode:0o600});await rename(manifest+'.signed',manifest);
