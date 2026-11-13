import {bbJSON} from './database.mjs';
export const peerGrant=(cfg,sessionId)=>(cfg.peerCycles??[]).find(g=>g['session-id']===sessionId);
export function peerMetadata(grant,turns=0){return {kind:'peer',goal:grant.goal,cycleId:grant['cycle-id'],participants:grant.participants.map(x=>x['bot-id']),maxTurns:grant['max-turns'],completedTurns:turns};}
export async function authorizePeer(cfg,request,messages,bots,origin){
 const g=peerGrant(cfg,request.sessionId);
 if(!g||origin!==undefined||!cfg.allowCLI||request.peer?.cycleId!==g['cycle-id']||request.botId!==g.participants[0]['bot-id'])throw Error('peer-grant-required');
 const answers=messages.filter(m=>m.role==='assistant');
 if(messages.length!==answers.length*2||messages.some(m=>m.peer?.cycleId!==g['cycle-id']))throw Error('peer-previous-outcome-unknown');
 const turns=answers.map(m=>({turn:m.peer.turn,speaker:m.speakerBotId,state:'completed',text:m.text}));
 const plan=await bbJSON(cfg.bb,['-m','itonami-chat.peer'],{grant:g,turns});
 const target=bots.find(b=>b.id===plan.speaker);
 if(plan.state!=='ready'||request.peer.turn!==plan.turn||request.text!==plan.prompt||!target?.chatPersona?.available||target.chatPersona.sourceSha256!==plan['profile-sha'])throw Error('peer-turn-binding-mismatch');
 return {bot:target,grant:g,inputSha:plan['input-sha'],envelope:{schema:'itonami.peer-message.v1',cycleId:g['cycle-id'],turn:plan.turn,from:plan.from,speakerBotId:target.id,grantCid:plan['grant-cid']}};
}

export async function checkPeerAdmission(cfg,request,peer){if(!cfg.peerEtcdConfig||!request.peer?.admission)return false;const r=await bbJSON(cfg.bb,['-m','itonami-chat.admission'],{etcdConfig:cfg.peerEtcdConfig,request:request.peer.admission,grant:peer.grant,turn:peer.envelope.turn,inputSha:peer.inputSha});return r.verified===true;}
