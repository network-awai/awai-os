import missions from './mission-catalog.js';
import {botActivity} from './fleet-activity.js';
export function missionGoals(nodes,scopeId='fleet'){
 const scope=nodes.find(n=>n.id===scopeId);if(!scope)return [];
 const contained=id=>id===scopeId||nodes.find(n=>n.id===id)?.ancestorIds.includes(scopeId);
 return missions['goals'].filter(g=>[g['lead'],...g['support']].some(contained)||scope.ancestorIds.some(id=>[g['lead'],...g['support']].includes(id)));
}
export function circleCooperations(nodes,bots,cycles=[],now=Date.now(),stale=false){
 const byId=new Map(nodes.map(n=>[n.id,n]));
 return cycles.flatMap(c=>{
  if(!Array.isArray(c.participants)||c.participants.length<2||new Set(c.participants).size!==c.participants.length||!Array.isArray(c['turns'])||c['turns'].length>4)return [];
  const participants=c.participants.map(id=>byId.get(id));if(participants.some(n=>n?.kind!=='bot'))return [];
  if(c['turns'].some((t,i)=>t['turn']!==i||!c.participants.includes(t['speaker'])||!['completed','unknown','running','ready'].includes(t.state)))return [];
  const common=nodes.filter(n=>n.kind==='responsibility'&&participants.every(p=>p.ancestorIds.includes(n.id))).sort((a,b)=>b.depth-a.depth)[0];
  const age=now-Date.parse(c.observedAt),live=c.state!=='completed'&&c.state!=='unknown'&&Number.isFinite(age)&&age>=0&&age<=45000;
  const active=live?participants.filter(p=>{const b=bots.find(b=>b.id===p.id);return b?.agentPresence?.['peerCycleKey']===c.cycleKey&&botActivity(b,now,stale).state==='running';}).map(p=>p.id):[];
  return [{...c,'missionKey':missions['peerBindings'].find(b=>b['cycleKey']===c.cycleKey&&b['issueId']===c.issueId)?.['goalKey']??null,'circleId':common?.id??'fleet','circleLabel':common?.label??'Itonami',participants:participants.map(p=>({id:p.id,name:p.label,'roleId':p.parentId,role:nodes.find(n=>n.id===p.parentId)?.label,activity:botActivity(bots.find(b=>b.id===p.id),now,stale).state})),'active':active,'live':active.length>0}];
 });
}
