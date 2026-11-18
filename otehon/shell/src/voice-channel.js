// Trusted host adapter for one bounded live connection. Never returns an approval or an arbitrary socket.
import {createClientConsentHost,createClientOperationBroker} from './vendor-runtime.gen.js';
import {runtimeDescriptor} from './runtime.js';
import {ensureAgentTransport} from './agent-transport.js';
import {CHAT_ORIGIN,CHAT_MODEL} from './bot-chat-contract.js';
import {VOICE_DURATION_MS,VOICE_MAX_TURNS,VOICE_PROTOCOL,VOICE_PATH,VOICE_ORIGIN,voiceOperation,voiceScope} from './voice-channel-contract.js';
const sameScope=(a,b)=>a?.botId===b.botId&&a?.sessionId===b.sessionId;
export function connectVoiceChannel(payload,{WebSocketImpl=globalThis.WebSocket,signal}={}){
 if(!payload||Object.keys(payload).sort().join(',')!=='durationMs,maxTurns,scope'||payload.durationMs!==VOICE_DURATION_MS||payload.maxTurns!==VOICE_MAX_TURNS)throw Error('invalid-voice-budget');
 const scope=voiceScope(payload.scope),url=new URL(VOICE_PATH,VOICE_ORIGIN);
 if(url.origin!==VOICE_ORIGIN||url.pathname!==VOICE_PATH||url.search||url.hash||url.username||url.password||new URL(CHAT_ORIGIN).origin!==CHAT_ORIGIN||signal?.aborted)throw Error('voice-connection-refused');
 if(typeof WebSocketImpl!=='function')throw Error('voice-transport-unavailable');
 return new Promise((resolve,reject)=>{
  const socket=new WebSocketImpl(url.href,VOICE_PROTOCOL),started=performance.now();let ready=false,closed=false,pending=null,turns=0,receivedBytes=0;
  const fail=()=>{if(closed)return;closed=true;clearTimeout(deadline);clearTimeout(openDeadline);signal?.removeEventListener('abort',close);try{socket.close(1000,'voice-session-ended')}catch{}if(pending){clearTimeout(pending.timer);pending.reject(Error('voice-outcome-unconfirmed-no-automatic-retry'));pending=null}if(!ready)reject(Error('voice-connection-unavailable'))};
  const close=()=>fail(),deadline=setTimeout(close,VOICE_DURATION_MS),openDeadline=setTimeout(close,10000);
  signal?.addEventListener('abort',close,{once:true});
  const channel=Object.freeze({scope,close,
   send(text){
    if(closed||!ready||pending||++turns>VOICE_MAX_TURNS||performance.now()-started>=VOICE_DURATION_MS||socket.readyState!==1||socket.bufferedAmount>32768||typeof text!=='string'||!text.trim()||text.length>8192){fail();return Promise.reject(Error('voice-turn-refused'))}
    const requestId=crypto.randomUUID();return new Promise((ok,bad)=>{const timer=setTimeout(close,Math.min(120000,VOICE_DURATION_MS-(performance.now()-started)));pending={requestId,resolve:ok,reject:bad,timer,text};try{socket.send(JSON.stringify({schema:'awai.bot-voice-frame.v1',type:'turn',requestId,text:text.trim()}))}catch{fail()}});
   }
  });
  socket.addEventListener('open',()=>{if(signal?.aborted){close();return}socket.send(JSON.stringify({schema:'awai.bot-voice-open.v1',type:'open',scope,durationMs:VOICE_DURATION_MS,maxTurns:VOICE_MAX_TURNS}))});
  socket.addEventListener('error',fail);socket.addEventListener('close',fail);
  socket.addEventListener('message',event=>{try{
   if(closed||typeof event.data!=='string'||event.data.length>262144||(receivedBytes+=new TextEncoder().encode(event.data).length)>1048576)throw Error();const value=JSON.parse(event.data);
   if(!ready){if(value.schema!=='awai.bot-voice-ready.v1'||!sameScope(value.scope,scope)||value.maxTurns!==VOICE_MAX_TURNS||!Number.isSafeInteger(value.durationMs)||value.durationMs<1||value.durationMs>VOICE_DURATION_MS||value.model!==CHAT_MODEL||value.store?.owner!=='itonami-agent'||value.store?.readback!==true)throw Error();ready=true;clearTimeout(openDeadline);resolve(channel);return}
   if(!pending||value.schema!=='awai.bot-voice-result.v1'||!sameScope(value.scope,scope)||value.requestId!==pending.requestId||value.botId!==scope.botId||value.sessionId!==scope.sessionId||value.model!==CHAT_MODEL||value.provider!=='meta'||value.state!=='completed'||value.store?.owner!=='itonami-agent'||value.store?.readback!==true||typeof value.text!=='string'||!value.text.trim()||value.text.length>32768)throw Error();
   const done=pending;pending=null;clearTimeout(done.timer);done.resolve(value);
  }catch{fail()}});
 });
}
export async function openVoiceChannel(scope,{signal}={}){
 const approvedScope=voiceScope(scope);await ensureAgentTransport();
 const host=({operation,payload})=>{if(operation.endpoint.origin!==CHAT_ORIGIN||operation.endpoint['browser-action']!==voiceOperation.endpoint['browser-action']||!sameScope(payload.scope,approvedScope))throw Error('voice-host-scope-refused');return connectVoiceChannel(payload,{signal})};
 const broker=createClientOperationBroker({runtime:runtimeDescriptor('index.html',[voiceOperation]),requestedCapabilities:[voiceOperation.capability],approvedOperations:[voiceOperation],hostSupportedOperations:[[voiceOperation.capability,voiceOperation.service,voiceOperation.operation]],consentHost:createClientConsentHost(),browserAdapters:{[voiceOperation.service]:{[voiceOperation.operation]:host}}});
 return broker.invoke({capability:voiceOperation.capability,service:voiceOperation.service,operation:voiceOperation.operation},{scope:approvedScope,durationMs:VOICE_DURATION_MS,maxTurns:VOICE_MAX_TURNS},{signal});
}
