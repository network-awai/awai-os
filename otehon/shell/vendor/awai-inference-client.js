/** Device-local Android handoff. No HTTP, model download, service grants or silent fallback. */
export function createInferenceClient({invoke=globalThis.__TAURI_INTERNALS__?.invoke,uuid=()=>crypto.randomUUID()}={}){
 const call=request=>{if(typeof invoke!=='function')return Promise.reject(Error('local-inference-unavailable'));return invoke('awai_local_inference',{request});};
 return Object.freeze({
  info:()=>call({action:'info'}),
  open:()=>call({action:'open'}),
  async generate({prompt,modality='text',maxTokens=128}={}){
   if(modality!=='text')throw Error('unsupported-modality');
   if(typeof prompt!=='string'||!prompt.trim()||new TextEncoder().encode(prompt).length>8192)throw Error('prompt-limit');
   if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>256)throw Error('token-limit');
   const requestId=uuid();if(!/^[a-f0-9-]{36}$/.test(requestId))throw Error('invalid-request-id');
   const result=await call({action:'generate',schema:'awai.inference.request.v1',requestId,modality,prompt,maxTokens});
   if(result?.schema!=='awai.inference.result.v1'||result.requestId!==requestId||result.modality!=='text'||result.engine!=='llama.cpp'||typeof result.text!=='string'||new TextEncoder().encode(result.text).length>65536)throw Error('invalid-inference-result');
   return result;
  }
 });
}
