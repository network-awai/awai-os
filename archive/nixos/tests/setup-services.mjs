// Invoked by the CI wrapper in the production setup service, inside its
// original systemd filesystem namespace and PATH. No dependency mocks.
import assert from 'node:assert/strict';
import {readFileSync, existsSync, statSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import https from 'node:https';
import {X509Certificate} from 'node:crypto';
import {showUpdates} from '/etc/murakumo/update-ui.mjs';
import {showRemote, remoteAddresses} from '/etc/murakumo/remote-ui.mjs';
import {control} from '/etc/murakumo/remote-access.mjs';
import {setTimeout as delay} from 'node:timers/promises';
async function main(){
// A simple systemd unit is active before its async certificate generation
// finishes. Wait for actual IPC readiness before scripting a user action.
let ready=false;
for(let attempt=0;attempt<60;attempt++){
  try{await control({action:'info'});ready=true;break;}catch{await delay(500);}
}
assert(ready,'remote daemon did not become ready');
const t = (_ja, en) => en;
const saved = existsSync('/var/lib/aiueos-update/config.json');
const choices = saved ? ['resume', 'back'] : ['enable', 'enable', 'back'];
const notices = [];
let updateMenus=0, ownerConsent=saved;
await showUpdates({menu:(message,items)=>{updateMenus++;const choice=choices.shift();assert(items.some(([id])=>id===choice));if(message.includes('Automatic activation stays on hold')){assert.equal(choice,'enable');ownerConsent=true;}return choice;}, message:s=>notices.push(s)}, t);
assert.equal(choices.length, 0);
assert(notices.some(s=>/checks (enabled|resumed)/.test(s)), notices.join('\n'));
const config = JSON.parse(readFileSync('/var/lib/aiueos-update/config.json'));
const journal = JSON.parse(readFileSync('/var/lib/aiueos-update/journal.json'));
assert.equal(config.enabled, true);
assert.equal(config.ownerPolicyAuthorized, true);
assert.equal(ownerConsent, true);
assert.equal(config.watchdogQualified, false);
assert.equal(config.trust.threshold, 2);
assert.equal(journal.highestSequence, 4);
assert.equal(statSync('/var/lib/aiueos-update').mode & 0o777, 0o700);
assert.equal(spawnSync('systemctl', ['is-active','aiueos-update.timer']).status, 0);
// Network discovery must work with the service's real PATH. In particular,
// hostname is intentionally not injected into this unit for the test.
assert(remoteAddresses().length > 0, 'no native LAN addresses');
const ip = remoteAddresses()[0], origin = `https://${ip}:8443`;
const cert = new X509Certificate(readFileSync('/var/lib/murakumo-remote/tls.crt'));
let ticket;
const request = (path, body={}) => new Promise((resolve,reject)=>{
  const req = https.request(origin+path, {
    method:'POST', rejectUnauthorized:false, agent:false,
    headers:{origin, 'content-type':'application/json', ...(ticket?{authorization:`Bearer ${ticket}`}:{})}
  }, res=>{
    try{assert.equal(res.socket.getPeerCertificate().fingerprint256, cert.fingerprint256);}
    catch(e){res.resume();reject(e);return;}
    let data=''; res.on('data',b=>data+=b); res.on('end',()=>resolve({status:res.statusCode, value:JSON.parse(data)}));
  });
  req.on('error',reject); req.setTimeout(5000,()=>req.destroy(Error('timeout')));
  req.end(JSON.stringify(body));
});
let menus=0;
const errors=[];
await showRemote({menu:(message,items)=>{
  if(menus++===0){
    assert.match(message,/Approve this computer/);
    assert.match(message,/VM companion/);
    assert(items.some(([id])=>id==='approve'));
    return 'approve';
  }
  assert.match(message,/Connected: VM companion/);
  return 'back';
},message:s=>errors.push(s)},t, async value=>{
  if(value.action==='info' && !ticket){
    const info=await control(value);
    assert.match(info.window.code,/^\d{8}$/);
    const paired=await request('/pair',{code:info.window.code,name:'VM companion'});
    assert.equal(paired.status,202); ticket=paired.value.ticket;
    assert.equal((await request('/poll')).value.state,'pending');
    assert.equal((await request('/status')).status,403);
  }
  const result=await control(value);
  if(value.action==='approve'){
    assert.equal((await request('/poll')).value.state,'approved');
    assert.equal((await request('/status')).status,200);
  }
  return result;
});
assert.deepEqual(errors,[]);
assert.equal(menus,2);
assert.equal((await request('/status')).status,403);
writeFileSync('/var/lib/murakumo/ci-setup-result.json',JSON.stringify({
  schema:'murakumo.setup-vm.v1', checks:['service-path','state-directory','timer','pairing','revocation'],
  savedConsent:saved, hardwareRecoveryQualified:config.watchdogQualified,
  journeys:{updates:{completed:true,consentPreserved:true,activationHeld:true,returned:true,decisions:updateMenus},
    remote:{completed:true,certificateCompared:true,approvalRequired:true,revoked:true,decisions:menus}}
}),{mode:0o600});
}
try{await main();}catch(e){
  writeFileSync('/var/lib/murakumo/ci-probe-failure.json',JSON.stringify({error:e.message,stack:e.stack}),{mode:0o600});
  throw e;
}
