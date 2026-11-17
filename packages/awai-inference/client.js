/** Device-local Android handoff. No HTTP, model download, service grants or silent fallback. */
export function createInferenceClient({invoke=globalThis.__TAURI_INTERNALS__?.invoke,uuid=()=>crypto.randomUUID()}={}){
 const call=request=>{if(typeof invoke!=='function')return Promise.reject(Error('local-inference-unavailable'));return invoke('awai_local_inference',{request});};
 return Object.freeze({
  info:()=>call({action:'info'}),
  open:()=>call({action:'open'}),
  async saveImage(imageId){if(!/^[a-f0-9-]{36}$/.test(imageId))throw Error('invalid-image-id');const r=await call({action:'saveImage',imageId});if(r?.saved!==true||r.readbackVerified!==true||!/^content:\/\//.test(r.uri)||!/^([a-f0-9]{64})$/.test(r.sha256))throw Error('invalid-save-result');return r;},
  async generate({prompt,modality='text',maxTokens=128}={}){
   if(!['text','image'].includes(modality))throw Error('unsupported-modality');
   if(typeof prompt!=='string'||!prompt.trim()||new TextEncoder().encode(prompt).length>8192)throw Error('prompt-limit');
   if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>256)throw Error('token-limit');
   const requestId=uuid();if(!/^[a-f0-9-]{36}$/.test(requestId))throw Error('invalid-request-id');
   const result=await call({action:'generate',schema:'awai.inference.request.v1',requestId,modality,prompt,maxTokens});
   if(modality==='image'){if(result?.schema!=='awai.inference.result.v1'||result.requestId!==requestId||result.modality!=='image'||result.engine!=='stable-diffusion.cpp'||result.imageId!==requestId||result.modelSet!=='qwen-image-2.1-turbo-uncensored-ad-q2-k'||result.width!==512||result.height!==512||!Number.isSafeInteger(result.bytes)||result.bytes<1||result.bytes>4194304||!/^([a-f0-9]{64})$/.test(result.sha256)||typeof result.dataUrl!=='string'||result.dataUrl.length>5592500||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.dataUrl))throw Error('invalid-image-result');return result;}
   if(result?.schema!=='awai.inference.result.v1'||result.requestId!==requestId||result.modality!=='text'||result.engine!=='llama.cpp'||typeof result.text!=='string'||new TextEncoder().encode(result.text).length>65536)throw Error('invalid-inference-result');
   return result;
  }
 });
}
