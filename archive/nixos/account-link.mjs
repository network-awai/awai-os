#!/usr/bin/env node
// Passwordless account linking. No account credentials are stored on this node.
import {createPrivateKey,createPublicKey,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,stat,unlink} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifyReceipt} from './node-root-receipt.mjs';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
function base58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = alphabet[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function didFromPublicKey(publicKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  if (!spki.subarray(0, spkiPrefix.length).equals(spkiPrefix) ||
      spki.length !== spkiPrefix.length + 32) {
    throw new Error('expected an Ed25519 public key');
  }
  return 'did:key:z' + base58(Buffer.concat([
    Buffer.from([0xed, 0x01]), spki.subarray(spkiPrefix.length),
  ]));
}

async function loadIdentity(path) {
  const value=JSON.parse(await readFile(path,'utf8'));
  const key=createPrivateKey(value.privateKeyPem);
  if(value.version!==1 || didFromPublicKey(createPublicKey(key))!==value.did) throw Error('invalid factory device identity');
  return {key};
}
const authority='https://murakumo.cloud';
const accountFlowToken=()=>randomBytes(32).toString('base64url');
const raw=k=>createPublicKey(k).export({type:'spki',format:'der'}).subarray(-32).toString('base64url');
export async function identity(dir){
  await mkdir(dir,{recursive:true,mode:0o700});
  const path=join(dir,'account-device.json');
  let value;
  try {value=JSON.parse(await readFile(path,'utf8'));}
  catch(e){
    if(e.code!=='ENOENT') throw e;
    let signing=generateKeyPairSync('ed25519');
    try {const factory=await loadIdentity(join(dir,'device-identity.json')); signing={privateKey:factory.key,publicKey:createPublicKey(factory.key)};} catch(e) {if(e.code!=='ENOENT')throw e;}
    const encryption=generateKeyPairSync('x25519');
    value={version:1,did:didFromPublicKey(signing.publicKey),signing:signing.privateKey.export({type:'pkcs8',format:'pem'}),encryption:encryption.privateKey.export({type:'pkcs8',format:'pem'})};
    await writeFile(path,JSON.stringify(value),{flag:'wx',mode:0o600});
  }
  if((await stat(path)).mode&0o077) throw Error('device identity permissions must be 0600');
  const key=createPrivateKey(value.signing);
  if(value.version!==1||didFromPublicKey(createPublicKey(key))!==value.did) throw Error('device identity mismatch');
  return {...value,key,signingPublicKey:raw(key),encryptionPublicKey:raw(createPrivateKey(value.encryption))};
}
export function validateReceipt(r,flow,id,challenge,model){
  if(!r||r.registered!==true||r.flowId!==flow.flowId||r.deviceDid!==id.did||r.challenge!==challenge||r.model!==model||!/^did:[a-z0-9]+:\S+$/.test(r.accountDid||'')) throw Error('registration receipt binding mismatch');
  return r;
}
export class LinkError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
export async function savedLink(dir='/var/lib/murakumo'){
  try {
    const saved=JSON.parse(await readFile(join(dir,'account-link.json'),'utf8'));
    if(saved.version===1){
      if(saved.authority!==authority||saved.registrationState!=='registered'||!/^did:[a-z0-9]+:\S+$/.test(saved.accountDid||'')||saved.deviceDid!==(await identity(dir)).did) throw new LinkError('invalid','Stored registration does not match this device.');
      throw new LinkError('legacy-proof-required','This registration needs a fresh user signature. Local installation and settings are preserved.');
    }
    if(saved.version!==2||saved.authority!==authority||saved.registrationState!=='registered'||!/^did:pkh:eip155:8453:0x[0-9a-f]{40}$/.test(saved.accountDid||'')||saved.deviceDid!==(await identity(dir)).did||saved.userRootReceipt?.['account-did']!==saved.accountDid||saved.userRootReceipt?.['device-did']!==saved.deviceDid||saved.verification?.rootCid!==saved.userRootReceipt?.['root-cid']||!Number.isSafeInteger(saved.verification?.verifiedAt)) throw new LinkError('invalid','Stored registration does not match this device.');
    return saved;
  } catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export async function link({dir='/var/lib/murakumo',model='Murakumo-NixOS',fetcher=fetch,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms)),display=console.log,onFlow,onProgress=()=>{},signal}={}){
  const id=await identity(dir);
  const challenge=accountFlowToken(),pollToken=accountFlowToken();
  const post=async(path,body)=>{
    signal?.throwIfAborted();
    const response=await fetcher(authority+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    if(response.status===404||response.status===503) {
      await response.body?.cancel();
      throw Object.assign(new LinkError('service','Registration service is not available.'),{status:response.status});
    }
    return {status:response.status,data:await response.json()};
  };
  try {
    const saved=await savedLink(dir);
    if(!saved)throw Object.assign(Error('No saved registration'),{code:'ENOENT'});
    if(saved.deviceDid!==id.did||saved.authority!==authority) throw Error('stored receipt mismatch');
    const timestamp=now();
    const status=await post('/api/devices/link/status',{deviceDid:id.did,timestamp,deviceProof:sign(null,Buffer.from(['murakumo-device-link-status-v1',authority,id.did,String(timestamp)].join('\n')),id.key).toString('base64url')});
    if(status.status!==200) throw Error('registration status unavailable');
    if(status.data.registered===true&&status.data.deviceDid===id.did&&status.data.accountDid===saved.accountDid){display('Murakumo device registration verified.');return saved;}
    throw new LinkError('revoked','registration revoked; owner must approve re-registration after explicit local reset');
  } catch(e){if(e.code!=='ENOENT'&&e.code!=='legacy-proof-required')throw e;}
  const message=['murakumo-device-link-start-v1',authority,id.did,challenge,model,pollToken].join('\n');
  const started=await post('/api/devices/link/start',{deviceDid:id.did,challenge,model,pollToken,deviceProof:sign(null,Buffer.from(message),id.key).toString('base64url')});
  const flow=started.data;
  if(started.status!==201||! /^[A-Za-z0-9_-]{43}$/.test(flow.flowId||'')||! /^[A-Z0-9_-]{10}$/.test(flow.userCode||'')||flow.expiresIn!==300||!Number.isSafeInteger(flow.expiresAt)||flow.expiresAt<=now()||flow.expiresAt>now()+330000||flow.verificationUriComplete!==authority+'/portal/#device-link?code='+flow.userCode) throw Error('invalid registration flow');
  // Keep signed node authority and stored receipts stable; move only the human approval UI.
  flow.verificationUriComplete='https://setup.murakumo.cloud/#device-link?code='+flow.userCode;
  display('Scan the QR with your phone and approve this device using a Passkey.\n'+flow.verificationUriComplete+'\nDevice code: '+flow.userCode+'\nDevice ID: '+id.did+'\nExpires in: 5 minutes');
  if(onFlow)await onFlow({...flow,deviceDid:id.did});
  else spawnSync('qrencode',['-t','ANSIUTF8',flow.verificationUriComplete],{stdio:['ignore','inherit','ignore']});
  const deadline=now()+300000;
  const proof=sign(null,Buffer.from(['murakumo-device-link-poll-v1',authority,flow.flowId,id.did,pollToken].join('\n')),id.key).toString('base64url');
  while(now()<deadline){
    signal?.throwIfAborted();
    let reply;
    try {reply=await post('/api/devices/link/poll',{flowId:flow.flowId,pollToken,deviceDid:id.did,challenge,deviceProof:proof});}
    catch(e){signal?.throwIfAborted();if(e instanceof LinkError)throw e;onProgress('reconnecting');display('Retrying connection...');await pause(2000);continue;}
    if(reply.status===202){onProgress('waiting');await pause(2000);continue;}
    if(reply.status===410)throw new LinkError(reply.data.error==='registration_revoked'?'revoked':'expired','Approval expired or registration revoked.');
    if(reply.status!==200)throw Error('authority refused device proof');
    signal?.throwIfAborted();
    const receipt=validateReceipt(reply.data,flow,id,challenge,model);
    const decision=await verifyReceipt(receipt.userRootReceipt,{'flow-id':flow.flowId,'device-did':id.did,challenge,'expires-at':Math.floor(flow.expiresAt/1000),now:Math.floor(now()/1000)});
    signal?.throwIfAborted();
    if(decision.allowed!==true||decision.accountDid!==receipt.accountDid) throw new LinkError('proof','The user signature could not be verified on this Node.');
    // Retain public evidence of this completed link, never polling secrets,
    // Cookie/JWT authority or a server-owned user signing key.
    const saved={version:2,deviceDid:id.did,accountDid:decision.accountDid,authority,linkedAt:now(),registrationState:'registered',userRootReceipt:receipt.userRootReceipt,verification:{rootCid:receipt.userRootReceipt['root-cid'],verifiedAt:now()}};
    const target=join(dir,'account-link.json'),temporary=target+'.'+accountFlowToken()+'.tmp';
    await writeFile(temporary,JSON.stringify(saved),{mode:0o600,flag:'wx'});await rename(temporary,target);
    display('Murakumo device registration completed with a verified user signature.');return saved;
  }
  throw new LinkError('expired','Approval expired. Restart to display a new QR code.');
}

function option(args,key,fallback){const i=args.indexOf(key);return i>=0?args[i+1]:fallback;}
async function main(){
  const args=process.argv.slice(2),dir=option(args,'--directory','/var/lib/murakumo');
  if(args.includes('--relink')){try{await unlink(join(dir,'account-link.json'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  await link({dir,model:option(args,'--model','Murakumo-NixOS')});
}
if(process.argv[1] && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) main().catch(e=>{console.error(e.message);process.exitCode=1;});
