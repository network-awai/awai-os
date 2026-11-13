// Public operator plan; a workstream/Issue never grants execution authority.
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
export function groupFor(bot){
 if(bot.physicsRollout?.reason==='source-unavailable')return 'source';
 if(bot.physicsRollout)return 'solver';
 if(bot.holds.includes('source-disabled-or-paused'))return 'paused';
 if(bot.holds.includes('linear-unresolved'))return 'mapping';
 if(bot.holds.includes('no-source-schedule'))return 'schedule';
 if(!bot.holds.length)return 'event';
 return 'executor';
}
const actions={source:'Retrieve exact profile repository/commit/spec; verify digest and bounded solver before grant.',solver:'Measure unchanged spec workload; qualify solver/resource limits with negative controls.',paused:'Keep stopped; preserve original disabled/paused fields and document restart condition.',mapping:'Verify repository alias and existing Kotoba Labs Project/Initiative/unfinished Issue.',schedule:'Determine per-Bot event or schedule contract from source; no invented common cadence.',event:'Define event input, execution owner, bounded executor and scoped grant; empty cron is not running.',executor:'Review imported operations as data; implement typed connector/executor and original calendar with narrow grant.'};
export function buildPlan(catalog,envelope,baseline,workstreams,now=Date.now()){
 if(catalog?.schema!=='awai.bot-fleet.v1'||envelope?.schema!=='awai.fleet-artifact.v1'||!Array.isArray(baseline?.held))throw Error('pinned-inputs-required');
 if(sha(JSON.stringify(envelope.payload))!==envelope.sha256)throw Error('fleet-digest-mismatch');
 const bots=new Map(envelope.payload.bots.map(b=>[b.id,b])),sources=new Map(catalog.organization.bots.map(b=>[b.id,b]));
 if(new Set(baseline.held.map(b=>b.id)).size!==baseline.held.length)throw Error('duplicate-baseline-bot');
 const age=now-Date.parse(envelope.payload.observedAt),fresh=Number.isFinite(age)&&age>=0&&age<=180000;
 const rows=baseline.held.map(prior=>{
  const bot=bots.get(prior.id),source=sources.get(prior.id),group=groupFor(prior),workstream=workstreams[group];
  if(!bot||!source||!/^AWAI-\d+$/.test(workstream?.id))throw Error('incomplete-stabilization-binding');
  const holds=[...bot.holds];if(!bot.configured&&!holds.length)holds.push('no-source-jobs','event-executor-and-owner-required');
  return {botId:bot.id,name:bot.name,repository:bot.repository,profileRevision:source.profile.commit,profileChecksum:source.profile.checksum,
   projectId:bot.linear.projectId,initiativeId:bot.linear.initiativeId,owningIssueIds:bot.linear.issues,workstream:workstream.id,group,
   configured:bot.configured,runtimeState:fresh?bot.state:'unknown-stale-observation',holds,physicsRollout:bot.physicsRollout,
   schedule:{state:source.schedule.state,jobs:source.schedule.jobs.map(j=>({id:j.id,schedule:j.schedule,timezone:j.timezone,sourceEnabled:j.sourceEnabled,paused:j.paused}))},
   nextAction:actions[group],acceptance:['source and unfinished owning Issue bound','explicit scoped executor/grant and owner','original schedule or reviewed event contract','distributed occurrence admission and no unknown redispatch','actual result persisted/read back in AwaiFS and owning Linear','next scheduled/event occurrence and restart/duplicate recovery verified'],
   evidenceState:bot.configured?'activation-needs-per-run-evidence':'not-activated',issueVelocity:'unknown-no-stable-completed-work-window',codingModel:'unknown',codingTokenForecast:'unknown',codingActualTokens:'unknown-shared-unallocated'};
 });
 const counts={};for(const r of rows)counts[r.group]=(counts[r.group]||0)+1;
 return {schema:'awai.bot-stabilization-plan.v1',generatedAt:new Date(now).toISOString(),sourceObservedAt:envelope.payload.observedAt,sourceFresh:fresh,catalogSha256:envelope.payload.catalogSha256,baselineCount:rows.length,groups:counts,currentFleetTotals:envelope.payload.totals,authority:'plan-only-no-execution-grants',rows};
}

export function attachStabilization(payload,plan,catalog){
 if(plan?.schema!=='awai.bot-stabilization-plan.v1'||plan.catalogSha256!==payload.catalogSha256||!Array.isArray(plan.rows)||plan.rows.length>10000
   ||new Set(plan.rows.map(r=>r.botId)).size!==plan.rows.length)throw Error('stabilization-plan-binding-mismatch');
 const source=new Map(catalog.organization.bots.map(b=>[b.id,b])),byId=new Map(),groups={};
 for(const r of plan.rows){const b=source.get(r.botId);
  if(!b||b.profile.commit!==r.profileRevision||b.profile.checksum!==r.profileChecksum||!Object.hasOwn(actions,r.group)||!/^AWAI-\d+$/.test(r.workstream))throw Error('stabilization-profile-binding-mismatch');
  byId.set(r.botId,{issueId:r.workstream,group:r.group,nextAction:actions[r.group]});
 }
 let heldLinked=0;const bots=payload.bots.map(b=>{const step=byId.get(b.id);if(step&&!b.configured){heldLinked++;groups[step.group]=(groups[step.group]||0)+1;}return step?{...b,stabilization:step}:b;});
 return {...payload,bots,stabilization:{plannedBots:plan.rows.length,heldLinked,groups,planGeneratedAt:plan.generatedAt,authority:'plan-only-no-execution-grants'}};
}
