/** Awai key approval handoff (ADR 0048). The app never holds a key: it asks the Awai app, which shows its own card and asks for the user's authentication. No HTTP, no stored grant, no fallback signer. */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const WALLET_ID=/^[a-z0-9][a-z0-9-]{0,39}$/;
const SAFE=/^[A-Za-z0-9._:-]+$/;
const ADDRESS=/^0x[0-9a-f]{40}$/;
export function createApprovalClient({invoke=globalThis.__TAURI_INTERNALS__?.invoke,uuid=()=>crypto.randomUUID()}={}){
 const call=async request=>{
  if(typeof invoke!=='function')throw Error('key-approval-unavailable');
  const result=await invoke('awai_key_approval',{request});
  if(result?.schema!=='awai.approval.result.v1'||result.requestId!==request.requestId)throw Error('invalid-approval-result');
  return result;
 };
 const ids=walletId=>{if(!WALLET_ID.test(walletId))throw Error('invalid-wallet-id');const requestId=uuid();if(!UUID.test(requestId))throw Error('invalid-request-id');return {schema:'awai.approval.request.v1',requestId,walletId};};
 return Object.freeze({
  async botWalletAddress(walletId='default'){
   const r=await call({...ids(walletId),kind:'itonami.bot-wallet.address'});
   if(!ADDRESS.test(r.walletAddress))throw Error('invalid-approval-result');
   return r.walletAddress;
  },
  async signBotLaunch({walletId='default',assignmentId,businessId,creditLimitMicros,walletAddress}={}){
   if(typeof assignmentId!=='string'||assignmentId.length<8||assignmentId.length>120||!SAFE.test(assignmentId))throw Error('invalid-launch');
   if(typeof businessId!=='string'||businessId.length<1||businessId.length>120||!SAFE.test(businessId))throw Error('invalid-launch');
   if(!Number.isSafeInteger(creditLimitMicros)||creditLimitMicros<1000||creditLimitMicros>50000)throw Error('invalid-launch');
   if(typeof walletAddress!=='string'||!ADDRESS.test(walletAddress))throw Error('invalid-launch');
   const r=await call({...ids(walletId),kind:'itonami.bot-wallet.launch',assignmentId,businessId,creditLimitMicros,walletAddress});
   if(r.walletAddress!==walletAddress||!/^0x[0-9a-f]{130}$/.test(r.walletSignature))throw Error('invalid-approval-result');
   return {wallet_address:r.walletAddress,wallet_signature:r.walletSignature};
  }
 });
}
