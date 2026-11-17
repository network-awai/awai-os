import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {digest} from '../update-release.mjs';import {runUpdate,finishTrial} from '../update-controller.mjs';
const grant=process.env.AIUEOS_GRANT_CHECKOUT;
test('signed release -> real Kotoba policy -> trial -> local-health commit',{skip:!grant},async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');const closure=Buffer.from('qa');
 const r={schema:'aiueos.release.v1',arch:'x86_64-linux',sequence:2,channel:'stable',issuedAt:1,expiresAt:999999999,securityRisk:'high',applyRisk:'medium',closureSha256:digest(closure),closureBytes:2,systemPath:'/nix/store/'+'a'.repeat(32)+'-nixos-system-qa',hostContract:'uuid-v1'};
 const bytes=Buffer.from(JSON.stringify(r));const envelope={payload:bytes.toString('base64'),signatures:[{keyId:'qa',signature:sign(null,bytes,privateKey).toString('base64')}]};
 const trust={threshold:1,channel:'stable',keys:{qa:publicKey.export({type:'spki',format:'pem'})}};
 const decide=async req=>{const result=spawnSync('kbb',['--classpath','src','scripts/update-policy.cljk'],{cwd:grant,input:JSON.stringify(req),encoding:'utf8',timeout:60000,maxBuffer:131072});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
 let journal=null,verified=false;const calls=[];
 const providers={withLock:fn=>fn(),readJournal:async()=>journal,casJournal:async(old,next)=>{assert.equal(old,journal);journal=next;return next;},notify:async()=>calls.push('notice'),collectEvidence:async()=>({'owner-policy-current?':true,'compatible?':true,'fresh?':true,'time-trusted?':true,'rollout-admitted?':true,'installed-sequence':1,'closure-verified?':verified,'previous-preserved?':true,'boot-recovery-qualified?':true,'space-ok?':true,'owner-peers-updating':0,'drained?':true,'maintenance-window?':true}),decide,fetchClosure:async()=>closure,importVerifiedClosure:async()=>{verified=true;calls.push('import');},acquireFleetLease:async()=>({id:1}),recheckActivation:async()=>true,prepareTrialBoot:async()=>calls.push('prepare'),reboot:async()=>calls.push('reboot'),releaseFleetLease:async()=>calls.push('release'),collectLocalHealth:async()=>({'local-health':'pass','elapsed-ms':1,'timeout-ms':120000,attempts:1,'max-attempts':2}),decideTrial:e=>decide({operation:'trial',evidence:e}),installedSequence:async()=>2,commitBoot:async()=>calls.push('commit')};
 const args={envelope,trust,current:{arch:r.arch,highestSequence:1,hostContract:r.hostContract},policy:{},now:2,providers};
 assert.equal((await runUpdate(args)).action,'stage');assert.equal((await runUpdate({...args,now:3})).action,'trial-boot');assert.equal((await finishTrial({journal,providers})).action,'commit');assert.deepEqual(calls,['notice','import','prepare','reboot','commit']);assert.equal(journal.pending,null);assert.equal(journal.highestSequence,2);
});
