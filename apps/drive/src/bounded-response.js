// Bound untrusted storage replies, including small JSON receipts, before parsing.
export async function readResponse(response,maxBytes=12*1024*1024,timeoutMs=30000){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>12*1024*1024||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('invalid-response-bound');
 if(!response.body)throw Error('missing-response-body');const reader=response.body.getReader(),chunks=[];let size=0,timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;reader.cancel().catch(()=>{});},timeoutMs);
 try{for(;;){const {value,done}=await reader.read();if(timedOut)throw Error('sync-timeout');if(done)break;if(!(value instanceof Uint8Array))throw Error('invalid-response-bytes');size+=value.length;if(size>maxBytes)throw Error('response-limit');chunks.push(value);}const out=new Uint8Array(size);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;}
 finally{clearTimeout(timer);await reader.cancel().catch(()=>{});}
}
