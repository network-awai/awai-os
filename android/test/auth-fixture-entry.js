// Host-injected test module; never an application asset or an authentication bypass.
// The runner checks a newly owned disposable emulator before evaluating this module.
import {deviceDid,saveSession,loadSession,clearSession} from '../../nixos/otehon/shell/src/identity/device.js';
import {createLinkRequest,verifyLink} from '../../nixos/otehon/shell/src/identity/link.js';
export async function begin(){const did=await deviceDid();const {request}=await createLinkRequest(did);return request;}
export async function accept(request,response,now=Date.now()){
 const did=await deviceDid();
 const account=verifyLink({request,response,deviceDid:did,now});
 saveSession(request,response);
 if(loadSession(did,now)?.accountDid!==account.accountDid)throw Error('fixture-readback-failed');
 return {method:account.method,verified:true};
}
export async function current(){const account=loadSession(await deviceDid());return account?{method:account.method,verified:true}:null;}
export {clearSession};
