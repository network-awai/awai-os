/** Awai key approval handoff (ADR 0048). The app never holds a key: it asks the Awai app, which shows its own card and asks for the user's authentication. No HTTP, no stored grant, no fallback signer. */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const WALLET_ID=/^[a-z0-9][a-z0-9-]{0,39}$/;
const SAFE=/^[A-Za-z0-9._:-]+$/;
const ADDRESS=/^0x[0-9a-f]{40}$/;
const BOT_ID=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const HEX=/^(?:[0-9a-f]{2})+$/;
const DID_KEY=/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]+$/;
const CID=/^b[a-z2-7]{20,}$/;
const checkDelegation=(r,botId)=>{if(!HEX.test(r.block)||r.block.length>4096||!CID.test(r.cid)||!Number.isSafeInteger(r.before)||!DID_KEY.test(r.holder)||!/^0x[0-9a-fA-F]{40}$/.test(r.owner))throw Error('invalid-approval-result');return r;};
export function createApprovalClient({invoke=globalThis.__TAURI_INTERNALS__?.invoke,uuid=()=>crypto.randomUUID()}={}){
 const call=async request=>{
  if(typeof invoke!=='function')throw Error('key-approval-unavailable');
  const result=await invoke('awai_key_approval',{request});
  if(result?.schema!=='awai.approval.result.v1'||result.requestId!==request.requestId)throw Error('invalid-approval-result');
  return result;
 };
 const ids=walletId=>{if(!WALLET_ID.test(walletId))throw Error('invalid-wallet-id');const requestId=uuid();if(!UUID.test(requestId))throw Error('invalid-request-id');return {schema:'awai.approval.request.v1',requestId,walletId};};
 const local=(kind,botId)=>{if(typeof botId!=='string'||!BOT_ID.test(botId))throw Error('invalid-bot-id');const requestId=uuid();if(!UUID.test(requestId))throw Error('invalid-request-id');return {schema:'awai.approval.request.v1',requestId,kind,botId};};
 return Object.freeze({
  /** Class A (ADR 0048 stage 7): the Awai app makes this Bot's on-device operating key and, after its card and the owner's verification, delegates to it for 30 days. */
  async delegateBot(botId){
   const r=checkDelegation(await call(local('itonami.bot-signer.delegate',botId)),botId);
   if(!/^0x[0-9a-f]{130}$/.test(r.signature))throw Error('invalid-approval-result');
   return {block:r.block,cid:r.cid,before:r.before,holder:r.holder,owner:r.owner,rootSignature:r.signature};
  },
  /** Class B: a presentation of the stored delegation, sealed by the operating key. No card; refused once expired or stopped. */
  async presentBotDelegation(botId){
   const r=checkDelegation(await call(local('itonami.bot-signer.present',botId)),botId);
   if(!/^0x[0-9a-f]{130}$/.test(r.rootSignature)||!/^[0-9a-f]{128}$/.test(r.seal))throw Error('invalid-approval-result');
   return {block:r.block,cid:r.cid,before:r.before,holder:r.holder,owner:r.owner,rootSignature:r.rootSignature,seal:r.seal};
  },
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
