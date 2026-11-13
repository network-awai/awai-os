import {botActivity,verifiedExecution} from './fleet-activity.js';
const fresh=(at,now,limit=45000)=>{const n=Date.parse(at);return Number.isFinite(n)&&n<=now&&now-n<=limit;};
export async function decodeAgentPresence(envelope,cryptoImpl=globalThis.crypto){
 if(envelope?.schema!=='itonami.agent-presence-artifact.v1')throw Error('invalid-agent-presence');
 const bytes=new TextEncoder().encode(JSON.stringify(envelope.payload)),hash=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==envelope.sha256||envelope.payload?.schema!=='itonami.agent-presence.v1'||!Array.isArray(envelope.payload.conversationBots)||!Array.isArray(envelope.payload.executions))throw Error('invalid-agent-presence');return envelope.payload;
}
export function directoryState(bot,presence,catalogSha,now,stale=false){
 const p=presence?.catalogSha256===catalogSha&&fresh(presence.service?.heartbeatAt,now)&&fresh(presence.observedAt,now)?presence:null;
 const process=p?.executions.find(e=>e.botId===bot.id&&e.source==='muse-process-heartbeat'&&e.phase==='responding'&&typeof e.invocationId==='string'&&e.node&&fresh(e.heartbeatAt,now)&&fresh(e.startedAt,now,300000));
 const resident=p?.residentBots?.some(e=>e.botId===bot.id&&e.source==='agent-resident-heartbeat'&&e.instanceId&&e.node&&fresh(e.heartbeatAt,now));
 const cron=botActivity(bot,now,stale),running=!!process||cron.state==='running'||cron.state==='recovering';
 return {botId:bot.id,running,resident:!!resident,residentCoverage:p?.residentCoverage??'unobserved',conversation:!!p?.conversationBots.includes(bot.id),scheduled:!stale&&bot.configured&&cron.state!=='unknown',state:process?'responding':resident?'resident':cron.state,observation:process??null};
}
export function directoryRows(bots,presence,catalogSha,{now=Date.now(),stale=false,filter='scheduled',query='',limit=20,recent=[]}={}){
 const q=query.trim().toLowerCase(),rows=bots.map(bot=>({bot,...directoryState(bot,presence,catalogSha,now,stale)}));
 const matches=rows.filter(r=>(filter==='all'||filter==='recent'&&recent.includes(r.bot.id)||r[filter]===true)&&`${r.bot.name} ${r.bot.repository} ${(r.bot.linear?.issues??[]).join(' ')}`.toLowerCase().includes(q));
 matches.sort((a,b)=>Number(b.running)-Number(a.running)||Number(b.resident)-Number(a.resident)||Math.max(0,recent.indexOf(a.bot.id))-Math.max(0,recent.indexOf(b.bot.id))||a.bot.name.localeCompare(b.bot.name));
 return {total:matches.length,rows:matches.slice(0,limit),counts:{running:rows.filter(r=>r.running).length,resident:presence?.residentCoverage==='complete'&&presence?.catalogSha256===catalogSha&&fresh(presence.observedAt,now)?rows.filter(r=>r.resident).length:null,conversation:rows.filter(r=>r.conversation).length,scheduled:rows.filter(r=>r.scheduled).length}};
}

export async function decodePeerProgress(e,cryptoImpl=globalThis.crypto){if(e?.schema!=='itonami.peer-progress-artifact.v1'||e.payload?.schema!=='itonami.peer-progress.v1'||!Array.isArray(e.payload.cycles)||e.payload.cycles.length>12)throw Error('invalid-peer-progress');const hash=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(e.payload)))),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==e.sha256||e.payload.cycles.some(c=>!Number.isInteger(c.completedTurns)||c.completedTurns<0||c.completedTurns>c.maxTurns||c.maxTurns>4))throw Error('invalid-peer-progress');return e.payload;}
