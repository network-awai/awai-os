// Completion is an onboarding preference, never an account or operation grant.
const KEY='otehon.setup.v1';
const validate=value=>{if(value?.schema!=='awai.setup.state.v1'||typeof value.complete!=='boolean')throw Error('invalid-setup-state');return value;};
export function createSetupState({invoke,storage=globalThis.localStorage}={}){
 const native=()=>invoke??globalThis.__TAURI_INTERNALS__?.invoke;
 const legacy=()=>{try{return storage.getItem(KEY)==='done';}catch{return false;}};
 const complete=async()=>{
  const call=native();
  if(typeof call==='function'){
   const state=validate(await call('awai_setup_state',{action:'complete'}));
   if(!state.complete)throw Error('setup-not-committed');
   return true;
  }
  // Existing hosted/Nix browser behavior is preserved; not Android durability evidence.
  storage.setItem(KEY,'done');return true;
 };
 return Object.freeze({
  async read(){
   const call=native();if(typeof call!=='function')return legacy();
   const state=validate(await call('awai_setup_state',{action:'read'}));
   // Upgrade a previously completed WebView. This confers no account identity:
   // the app still re-verifies its separately held device key and signed proof.
   return state.complete||(legacy()?complete():false);
  },complete,
 });
}
export const setupState=createSetupState();
