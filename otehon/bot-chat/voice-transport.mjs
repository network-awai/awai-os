// Authenticated, bounded protocol transport only. CLJC owns admission; existing Agent owns all messages.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {bbJSON} from './database.mjs';
export const VOICE_PATH='/v1/bot-chat/voice',VOICE_PROTOCOL='awai.bot-voice.v1';
export async function verifiedWebSocket(){
 const root=new URL('./vendor/ws/',import.meta.url),pin=JSON.parse(await fs.readFile(new URL('./vendor/ws-source.json',import.meta.url)));
 if(pin.version!=='8.23.0'||pin.schema!=='awai.vendored-websocket-source.v1'||pin.files.length!==17)throw Error('voice-dependency-pin-invalid');
 for(const p of pin.files){if(!/^(?:lib\/)?[\w.-]+$/.test(p.path))throw Error('voice-dependency-path-invalid');const b=await fs.readFile(new URL(p.path,root));if(b.length!==p.bytes||createHash('sha256').update(b).digest('hex')!==p.sha256)throw Error('voice-dependency-byte-mismatch');}
 // Optional native addons are not part of this pinned distribution.
 process.env.WS_NO_BUFFER_UTIL='1';process.env.WS_NO_UTF_8_VALIDATE='1';
 return import('./vendor/ws/wrapper.mjs');
}
export function voiceUpgradeAllowed(req,cfg){return req.method==='GET'&&req.url===VOICE_PATH&&typeof req.headers.origin==='string'&&cfg.origins.includes(req.headers.origin)&&req.headers['tailscale-user-login']===cfg.ownerLogin&&typeof cfg.ownerLogin==='string'&&cfg.ownerLogin.length>0&&req.headers['sec-websocket-protocol']===VOICE_PROTOCOL&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);}
// Reuse the actual original upgrade identity. No caller-supplied owner, URL or HTTP headers.
function dispatch(handle,authenticatedHeaders,path,body){return new Promise((resolve,reject)=>{
 const request=Readable.from([Buffer.from(JSON.stringify(body))]);request.headers={...authenticatedHeaders,'content-type':'application/json'};request.method='POST';request.url=path;
 let status=0;const response={setHeader(){},writeHead(code){status=code;},end(bytes){try{const value=JSON.parse(bytes);resolve({status,value})}catch(e){reject(e)}}};
 Promise.resolve(handle(request,response)).catch(reject);
});}
export async function attachVoiceTransport(server,cfg,{handleFactory,admission,wallMs=180000,openMs=10000}={}){
 if(typeof handleFactory!=='function'||!Number.isSafeInteger(wallMs)||wallMs<1||wallMs>180000||!Number.isSafeInteger(openMs)||openMs<1||openMs>10000)throw Error('invalid-voice-transport-config');
 const policy=admission??(input=>bbJSON(cfg.bb,['-m','itonami-chat.voice-adapter'],input));
 const {WebSocketServer}=await verifiedWebSocket();
 const wss=new WebSocketServer({noServer:true,maxPayload:32768,perMessageDeflate:false,maxPendingAutoPongs:8,handleProtocols:protocols=>protocols.has(VOICE_PROTOCOL)?VOICE_PROTOCOL:false});
 server.on('upgrade',(req,socket,head)=>{
  if(!voiceUpgradeAllowed(req,cfg)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
 });
 wss.on('connection',(ws,upgrade)=>{
  const controller=new AbortController(),handle=handleFactory(controller.signal),headers=Object.freeze({...upgrade.headers});
  const started=performance.now();let state=null,busy=false,closed=false,frames=0;
  const send=value=>{if(!closed&&ws.readyState===1&&ws.bufferedAmount<262144)ws.send(JSON.stringify(value));else finish('voice-output-unavailable')};
  const finish=reason=>{if(closed)return;closed=true;clearTimeout(deadline);clearTimeout(openDeadline);controller.abort();ws.close(1000,reason);const t=setTimeout(()=>ws.terminate(),1000);t.unref();};
  const deadline=setTimeout(()=>finish('voice-session-ended'),wallMs),openDeadline=setTimeout(()=>{if(!state)finish('voice-open-timeout')},openMs);
  ws.on('close',()=>finish('voice-closed'));ws.on('error',()=>finish('voice-error'));
  ws.on('message',async(bytes,binary)=>{
   if(closed)return;if(busy||binary||++frames>13){finish('voice-frame-refused');return}busy=true;
   try{
    const frame=JSON.parse(bytes.toString('utf8'));
    const gate=await policy(state?{action:'turn',state,frame,elapsedMs:Math.floor(performance.now()-started)}:{action:'open',frame});
    if(closed||gate?.schema!=='awai.bot-voice-admission.v1'||gate.admitted!==true||!gate.value){finish('voice-admission-refused');return}
    if(!state){
     const accepted=gate.value;const history=await dispatch(handle,headers,'/v1/bot-chat/history',accepted.scope);
     if(closed||history.status!==200||history.value.store?.owner!=='itonami-agent'||history.value.store?.readback!==true){finish('voice-session-unavailable');return}
     state=accepted;clearTimeout(openDeadline);send({schema:'awai.bot-voice-ready.v1',scope:state.scope,durationMs:Math.max(1,Math.floor(wallMs-(performance.now()-started))),maxTurns:12,model:cfg.model,store:history.value.store});
    }else{
     state=gate.value.state;const response=await dispatch(handle,headers,'/v1/bot-chat/turn',gate.value.request);
     if(closed)return;
     if(response.status!==200){send({schema:'awai.bot-voice-error.v1',requestId:frame.requestId,error:'voice-turn-unconfirmed-no-automatic-retry'});finish('voice-turn-unconfirmed');return}
     send({schema:'awai.bot-voice-result.v1',scope:state.scope,...response.value});
    }
   }catch{finish('voice-outcome-unknown-no-retry')}finally{busy=false}
  });
 });
 server.on('close',()=>{for(const ws of wss.clients)ws.close(1001,'service-closed');wss.close()});
 return wss;
}
