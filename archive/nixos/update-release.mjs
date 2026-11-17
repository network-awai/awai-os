// Host mechanism only. Scheduling/authority policy lives in grant.update-lifecycle.
import {createHash,createPublicKey,verify} from 'node:crypto';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function admitRelease(envelope, trust, current, now=Date.now()) {
 if (!envelope || typeof envelope.payload!=='string' || envelope.payload.length>131072 || !Array.isArray(envelope.signatures) || envelope.signatures.length>32) throw Error('invalid envelope');
 if (!Number.isSafeInteger(trust.threshold) || trust.threshold<1 || !trust.keys || !Number.isSafeInteger(now)) throw Error('invalid trust policy');
 const bytes=Buffer.from(envelope.payload,'base64');
 if(bytes.toString('base64')!==envelope.payload)throw Error('noncanonical payload');
 const signers=new Set();
 for(const s of envelope.signatures) {
  if(!s || typeof s.keyId!=='string' || typeof s.signature!=='string' || signers.has(s.keyId) || !Object.hasOwn(trust.keys,s.keyId))continue;
  const key=createPublicKey(trust.keys[s.keyId]);
  if(key.asymmetricKeyType!=='ed25519')throw Error('wrong key type');
  const signature=Buffer.from(s.signature,'base64');
  if(signature.length===64 && signature.toString('base64')===s.signature && verify(null,bytes,key,signature))signers.add(s.keyId);
 }
 if(signers.size<trust.threshold)throw Error('signature quorum');
 const r=JSON.parse(bytes.toString('utf8'));
 if(r.schema!=='aiueos.release.v1' || r.arch!==current.arch || r.channel!==trust.channel ||
    !Number.isSafeInteger(r.sequence) || !Number.isSafeInteger(current.highestSequence) || (r.sequence<current.highestSequence || (r.sequence===current.highestSequence && current.pendingManifestHash!==digest(bytes))) ||
    !Number.isSafeInteger(r.issuedAt) || !Number.isSafeInteger(r.expiresAt) || r.issuedAt>now || r.expiresAt<=now || r.expiresAt<=r.issuedAt ||
    !['low','medium','high','critical'].includes(r.securityRisk) || !['low','medium','high','critical'].includes(r.applyRisk) ||
    !/^[a-f0-9]{64}$/.test(r.closureSha256) || !Number.isSafeInteger(r.closureBytes) || r.closureBytes<1 ||
    !/^\/nix\/store\/[a-z0-9]{32}-nixos-system-[a-zA-Z0-9.+_-]+$/.test(r.systemPath) ||
    r.systemPath.endsWith('.drv') || r.hostContract!==current.hostContract || (r.requiredBy!==undefined && !Number.isSafeInteger(r.requiredBy))) throw Error('release incompatible, expired or downgraded');
 // Transport locations deliberately not used as commands or trust roots.
 return Object.freeze({manifestHash:digest(bytes),release:Object.freeze(r),signers:[...signers]});
}
export function verifyClosure(bytes, admitted) {
 if(bytes.length!==admitted.release.closureBytes || digest(bytes)!==admitted.release.closureSha256)throw Error('closure digest');
 return true;
}
