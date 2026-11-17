// Existing awai.link.v1 verifier and device-key custody, not a new identity protocol.
import {deviceDid,loadSession,saveSession} from '../../nixos/otehon/shell/src/identity/device.js';
import {createLinkRequest,linkUrl,confirmationCode,openResponse,verifyLink,REQUEST_MS} from '../../nixos/otehon/shell/src/identity/link.js';
import qrcode from 'qrcode-generator';
import {createClientOperationBroker,createClientConsentHost} from './runtime.js';
export const RELAY='https://relay.awai.network';
const operation={capability:'awai-link',service:'awai-relay',operation:'await-phone-approval',consent:'each-operation','data-categories':['link-topic'],endpoint:{origin:RELAY,routes:[{method:'GET',path:'/:topic/json','query-params':[]}]}};
export function relayRequestAllowed(input,method='GET') {
  try{const u=new URL(input);return method==='GET'&&u.origin!== 'null'&&u.origin===RELAY&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/[0-9a-f]{32}\/json$/.test(u.pathname);}catch{return false;}
}
export function createIdentity(changed) {
  let did=null,account=null,state={status:'loading'},abort=null,sequence=0;
  const update=value=>{state=value;changed();};
  const ready=deviceDid().then(value=>{did=value;account=loadSession(did);update({status:account?'linked':'ready'});}).catch(()=>update({status:'storage-error'}));
  const broker=createClientOperationBroker({runtime:{schema:'kotoba.app.client-runtime.v1',target:'browser',profile:'trusted-page-v1',entry:'index.html','local-state':{adapter:'localstorage',schema:'awai.account',version:1},operations:[operation]},requestedCapabilities:['awai-link'],approvedOperations:[operation],hostSupportedOperations:[['awai-link','awai-relay','await-phone-approval']],consentHost:createClientConsentHost()});
  async function begin(){
    await ready;if(!did||state.status==='storage-error')return;
    abort?.abort();const run=++sequence;const controller=new AbortController();abort=controller;
    let timer=setTimeout(()=>controller.abort(),REQUEST_MS);
    try{
      update({status:'asking'});
      const {request,privateKey}=await createLinkRequest(did);
      const input=RELAY+'/'+request.topic+'/json';if(!relayRequestAllowed(input))throw Error('scope');
      const response=await broker.invoke({capability:'awai-link',service:'awai-relay',operation:'await-phone-approval'},{input,init:{method:'GET'}},{signal:controller.signal});
      if(!response.ok||!response.body)throw Error('relay');
      const url=linkUrl(request),qr=qrcode(0,'M');qr.addData(url);qr.make();
      if(run!==sequence)return;
      update({status:'waiting',url,code:confirmationCode(request),qr:'data:image/svg+xml;base64,'+btoa(qr.createSvgTag(4,2))});
      const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer='',received=0;
      try{for(;;){
        const {value,done}=await reader.read();if(done)throw Error('relay-closed');
        received+=value.length;if(received>1024*1024)throw Error('relay-budget');buffer+=value;
        const lines=buffer.split('\n');buffer=lines.pop();if(buffer.length>131072)throw Error('relay-budget');
        for(const line of lines){
          if(!line.trim())continue;
          let event;try{event=JSON.parse(line);}catch{continue;}
          if(event.event!=='message'||typeof event.message!=='string'||event.message.length>65536)continue;
          let response;try{response=await openResponse(request,privateKey,event.message);verifyLink({request,response,deviceDid:did});}catch{continue;}
          if(run!==sequence||controller.signal.aborted)return;
          saveSession(request,response);account=loadSession(did);if(!account)throw Error('restore');
          update({status:'linked'});return;
        }
      }}finally{await reader.cancel().catch(()=>{});}
    }catch(error){if(run===sequence)update({status:controller.signal.aborted?'expired':state.status==='asking'?'denied-or-unavailable':'unavailable'});}
    finally{clearTimeout(timer);}
  }
  return {get state(){return state;},get account(){if(account)account=loadSession(did);return account;},begin,cancel(){sequence++;abort?.abort();if(!account)state={status:'ready'};}};
}
