// Provider contract runner: no arbitrary shell, disk formatting or implicit reboot.
// A qualified Linux provider must supply locking, atomic journal CAS, durable
// receipts and boot-counted recovery before this can activate a real machine.
import {admitRelease,verifyClosure} from './update-release.mjs';
export function policyRequest(admitted,policy,evidence,now) {
 const r=admitted.release;
 return {operation:'schedule',release:{sequence:r.sequence,channel:r.channel,
  'security-risk':r.securityRisk,'apply-risk':r.applyRisk,'required-by':r.requiredBy},
  policy,evidence:{...evidence,'signature-valid?':true},now};
}
export async function runUpdate({envelope,trust,current,policy,now,providers}) {
 return providers.withLock(async()=>{
  const admitted=admitRelease(envelope,trust,current,now);
  let journal=await providers.readJournal();
  if(journal?.blocked?.includes(admitted.manifestHash))return {action:'hold',reason:'previous-trial-failed'};
  if(journal?.pending?.phase==='trial-prepared')return {action:'hold',reason:'trial-reconciliation-required'};
  if(journal?.pending && journal.pending.manifestHash!==admitted.manifestHash) return {action:'hold',reason:'another-release-pending'};
  // Persist first notification before staging. Failed/repeated boots cannot reset it.
  if(!journal?.pending) {
   journal=await providers.casJournal(journal,{...journal,highestAdmittedSequence:admitted.release.sequence,pending:{manifestHash:admitted.manifestHash,sequence:admitted.release.sequence,noticedAt:now,phase:'notified'}});
   await providers.notify(admitted);
  }
  let evidence=await providers.collectEvidence(admitted,journal);
  // Same signed release, durable policy and fresh evidence must reach the CLJK
  // decision provider together; provider cannot substitute an unrelated manifest.
  evidence={...evidence,'signature-valid?':true,'noticed-at':journal.pending.noticedAt};
  const verdict=await providers.decide(policyRequest(admitted,policy,evidence,now));
  if(verdict.fleet==='drain-and-refuse-new-jobs')await providers.restrictNewJobs(admitted);
  if(verdict.action==='stage') {
   const bytes=await providers.fetchClosure(admitted);
   if(!bytes?.verifiedArchive)verifyClosure(bytes,admitted);
   // Importer checks every NAR hash, complete requisites and exact systemPath.
   await providers.importVerifiedClosure(bytes,admitted);
   await providers.casJournal(journal,{...journal,pending:{...journal.pending,phase:'staged'}});
  } else if(verdict.action==='drain')await providers.drain(admitted);
  else if(verdict.action==='trial-boot') {
   // Acquisition is atomic; evidence collection alone is not a fleet lease.
   const lease=await providers.acquireFleetLease(admitted);
   if(!lease)return {action:'hold',reason:'fleet-lease-unavailable'};
   let prepared=false;
   try {
    if(!await providers.recheckActivation(admitted,policy,journal,lease))return {action:'hold',reason:'activation-evidence-changed'};
    journal=await providers.casJournal(journal,{...journal,pending:{...journal.pending,phase:'trial-prepared'}});
    // Provider installs preserved UUID entries, fallback/default/boot counter,
    // fsyncs ESP+journal, then reboots. Crash recovery reconciles trial-prepared.
    await providers.prepareTrialBoot(admitted,journal,lease);
    prepared=true;
    await providers.reboot(admitted);
   } finally {if(!prepared)await providers.releaseFleetLease(lease);}
  }
  return {...verdict,manifestHash:admitted.manifestHash};
 });
}
export async function finishTrial({journal,providers}) {
 return providers.withLock(async()=>{
  const latest=await providers.readJournal();
  if(latest?.pending?.manifestHash!==journal?.pending?.manifestHash || latest?.pending?.phase!=='trial-prepared')throw Error('trial journal changed');
  const verdict=await providers.decideTrial(await providers.collectLocalHealth(latest));
  if(verdict.action==='commit') {
   const installed=await providers.installedSequence();
   if(!Number.isSafeInteger(installed) || installed!==latest.pending.sequence)throw Error('running generation mismatch');
   await providers.commitBoot(latest);
   await providers.casJournal(latest,{...latest,pending:null,lastOutcome:'committed',highestSequence:installed});
  } else if(verdict.action==='rollback') {
   // Persist block before rollback; recovery USB reads the same journal.
   await providers.casJournal(latest,{...latest,lastOutcome:'rollback-required',blocked:[...new Set([...(latest.blocked||[]),latest.pending.manifestHash])]});
   await providers.restorePreviousBoot(latest);
  }
  return verdict;
 });
}
