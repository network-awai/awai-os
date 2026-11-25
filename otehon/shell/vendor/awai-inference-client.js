/** Device-local Android handoff. No HTTP, model download, service grants or silent fallback. */
export function createInferenceClient({invoke=globalThis.__TAURI_INTERNALS__?.invoke,uuid=()=>crypto.randomUUID()}={}){
 const validScope=s=>s&&typeof s==='object'&&Object.keys(s).sort().join(',')==='botId,sessionId'&&/^profile:[\w.-]+$/.test(s.botId)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s.sessionId);
 const call=request=>{if(typeof invoke!=='function')return Promise.reject(Error('local-inference-unavailable'));return invoke('awai_local_inference',{request});};
 return Object.freeze({
  info:()=>call({action:'info'}),
  open:()=>call({action:'open'}),
  async readImage(imageId,conversation,expectedSha256){if(!/^[a-f0-9-]{36}$/.test(imageId)||(conversation!==undefined&&!validScope(conversation))||(expectedSha256!==undefined&&!/^[a-f0-9]{64}$/.test(expectedSha256)))throw Error('invalid-image-reference');const r=await call({action:'readImage',imageId,...(conversation?{conversation}:{})});if(r?.imageId!==imageId||r.modality!=='image'||r.engine!=='stable-diffusion.cpp'||r.modelSet!=='qwen-image-2.1-turbo-uncensored-ad-q2-k'||r.width!==512||r.height!==512||!Number.isSafeInteger(r.bytes)||r.bytes<1||r.bytes>4194304||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(r.dataUrl)||r.dataUrl.length>5592500||!/^([a-f0-9]{64})$/.test(r.sha256)||(expectedSha256&&r.sha256!==expectedSha256))throw Error('image-reference-mismatch');return r;},
  async saveImage(imageId){if(!/^[a-f0-9-]{36}$/.test(imageId))throw Error('invalid-image-id');const r=await call({action:'saveImage',imageId});if(r?.saved!==true||r.readbackVerified!==true||!/^content:\/\//.test(r.uri)||!/^([a-f0-9]{64})$/.test(r.sha256))throw Error('invalid-save-result');return r;},
  async cancel(requestId){if(!/^[a-f0-9-]{36}$/.test(requestId))throw Error('invalid-request-id');const r=await call({action:'cancel',requestId});if(r?.cancelled===true&&r.reason===undefined)return{cancelled:true};if(r?.cancelled===false&&r?.reason==='not-running')return{cancelled:false,reason:'not-running'};throw Error('invalid-cancel-result');},
  async generate({prompt,modality='text',maxTokens=128,conversation}={}){
   if(conversation!==undefined&&!validScope(conversation))throw Error('invalid-conversation-scope');
   if(!['text','image'].includes(modality))throw Error('unsupported-modality');
   if(typeof prompt!=='string'||!prompt.trim()||new TextEncoder().encode(prompt).length>8192)throw Error('prompt-limit');
   if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>256)throw Error('token-limit');
   const requestId=uuid();if(!/^[a-f0-9-]{36}$/.test(requestId))throw Error('invalid-request-id');
   let result;try{result=await call({action:'generate',schema:'awai.inference.request.v1',requestId,modality,prompt,maxTokens,...(conversation?{conversation}:{})});}catch(e){if(String(e)==='inference-cancelled')throw Error('inference-cancelled');throw e;}
   if(modality==='image'){if(result?.schema!=='awai.inference.result.v1'||result.requestId!==requestId||result.modality!=='image'||result.engine!=='stable-diffusion.cpp'||result.imageId!==requestId||result.modelSet!=='qwen-image-2.1-turbo-uncensored-ad-q2-k'||result.width!==512||result.height!==512||!Number.isSafeInteger(result.bytes)||result.bytes<1||result.bytes>4194304||!/^([a-f0-9]{64})$/.test(result.sha256)||typeof result.dataUrl!=='string'||result.dataUrl.length>5592500||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.dataUrl))throw Error('invalid-image-result');return result;}
   if(result?.schema!=='awai.inference.result.v1'||result.requestId!==requestId||result.modality!=='text'||result.engine!=='llama.cpp'||typeof result.text!=='string'||new TextEncoder().encode(result.text).length>65536)throw Error('invalid-inference-result');
   return result;
  }
 });
}
