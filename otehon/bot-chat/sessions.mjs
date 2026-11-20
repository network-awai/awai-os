import {bbJSON,database} from './database.mjs';
export const validSession=id=>id==='default'||typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export const scopes=(cfg,owner,botId,sessionId='default')=>bbJSON(cfg.bb,['-m','itonami-chat.sessions'],{op:'scope',owner,botId,sessionId});
export async function sessionRows(cfg,index,db=database){const r=await db(cfg,index,'history');const events=r.messages.map(e=>JSON.parse(e.text));return {sessions:await bbJSON(cfg.bb,['-m','itonami-chat.sessions'],{op:'list',events}),store:r.store};}
export async function recordSession(cfg,index,sessionId,eventId,metadata,db=database){return db(cfg,index,'append',[{id:eventId,role:'session',text:JSON.stringify({sessionId,...metadata}),at:metadata.updatedAt}]);}
