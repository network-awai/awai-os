import test, {after} from 'node:test';
import {generateKeyPairSync} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,writeFile,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {identity,link,savedLink,validateReceipt,didFromPublicKey} from '../account-link.mjs';
const flow={flowId:'f'.repeat(43),userCode:'ABCD123456',expiresIn:300,expiresAt:Date.now()+300000,verificationUriComplete:'https://murakumo.cloud/portal/#device-link?code=ABCD123456'};
const directories=[];
const dir=async()=>{const value=await mkdtemp(join(tmpdir(),'murakumo-account-test-'));directories.push(value);return value;};
after(async()=>{await Promise.all(directories.map(d=>rm(d,{recursive:true,force:true})));});
function receipt(body){return {registered:true,flowId:flow.flowId,deviceDid:body.deviceDid,challenge:body.challenge,model:body.model,accountDid:'did:key:account',principalId:'test-principal'};}
test('key survives restart and private files are 0600',async()=>{const d=await dir();assert.equal((await identity(d)).did,(await identity(d)).did);assert.equal((await stat(join(d,'account-device.json'))).mode&0o777,0o600);});
test('a successful server projection without a user signature cannot persist ownership',async()=>{const d=await dir();let start;const fetcher=async(url,opts)=>{const b=JSON.parse(opts.body);if(url.endsWith('/start')){start=b;return new Response(JSON.stringify(flow),{status:201});}return new Response(JSON.stringify(receipt(start)));};await assert.rejects(link({dir:d,fetcher,display:()=>{}}),{code:'proof'});assert.equal(await savedLink(d),null);await assert.rejects(readFile(join(d,'account-link.json')),/ENOENT/);});
test('wrong device, challenge, model or unregistered receipt never persists',async()=>{const id=await identity(await dir());const b={deviceDid:id.did,challenge:'challenge',model:'Murakumo-NixOS',deviceSigningPublicKey:id.signingPublicKey,deviceEncryptionPublicKey:id.encryptionPublicKey};const good=receipt(b);validateReceipt(good,flow,id,b.challenge,b.model);for(const [k,v] of Object.entries({deviceDid:'did:key:other',challenge:'other',model:'other',registered:false,flowId:'other'}))assert.throws(()=>validateReceipt({...good,[k]:v},flow,id,b.challenge,b.model));});
test('disconnect retries within deadline; expired approval never succeeds',async()=>{const d=await dir();let clock=0,requests=0;await assert.rejects(link({dir:d,now:()=>clock,pause:async()=>{clock+=150000;},display:()=>{},fetcher:async(url)=>{requests++;if(url.endsWith('/start'))return new Response(JSON.stringify({...flow,expiresAt:300000}),{status:201});throw Error('offline');}}),/Approval expired/);assert.equal(requests,3);await assert.rejects(readFile(join(d,'account-link.json')),/ENOENT/);});


test('an existing factory signing identity is preserved without the factory daemon',async()=>{
  const d=await dir(),pair=generateKeyPairSync('ed25519'),did=didFromPublicKey(pair.publicKey);
  await writeFile(join(d,'device-identity.json'),JSON.stringify({version:1,did,privateKeyPem:pair.privateKey.export({type:'pkcs8',format:'pem'})}),{mode:0o600});
  assert.equal((await identity(d)).did,did);
});
test('a device key with group or world permissions is refused',async()=>{
  const d=await dir();await identity(d);await chmod(join(d,'account-device.json'),0o644);
  await assert.rejects(identity(d),/permissions/);
});
test('deferred approval never saves even if approval arrives during cancellation',async()=>{
  const d=await dir(),controller=new AbortController();let start;
  await assert.rejects(link({dir:d,signal:controller.signal,onFlow:()=>{},display:()=>{},fetcher:async(url,opts)=>{
    if(url.endsWith('/start')){start=JSON.parse(opts.body);return new Response(JSON.stringify(flow),{status:201});}
    controller.abort(new DOMException('Deferred','AbortError'));return new Response(JSON.stringify(receipt(start)));
  }}),{name:'AbortError'});
  assert.equal(await savedLink(d),null);
});
test('unpublished registration service is distinct from an approval refusal',async()=>{
  const d=await dir();await assert.rejects(link({dir:d,display:()=>{},fetcher:async()=>new Response('{"error":"unknown devices route"}',{status:404})}),{code:'service'});
  assert.equal(await savedLink(d),null);
});
test('server expiry returns the new-QR recovery state',async()=>{
  const d=await dir();await assert.rejects(link({dir:d,onFlow:()=>{},display:()=>{},fetcher:async(url)=>url.endsWith('/start')?new Response(JSON.stringify(flow),{status:201}):new Response('{"error":"expired_code"}',{status:410})}),{code:'expired'});
  assert.equal(await savedLink(d),null);
});
test('QR moves to setup domain while Node signatures retain original authority',async()=>{const d=await dir();let start,shown;await assert.rejects(link({dir:d,display:()=>{},onFlow:f=>{shown=f.verificationUriComplete;},fetcher:async(url,opts)=>{assert.equal(new URL(url).origin,'https://murakumo.cloud');const body=JSON.parse(opts.body);if(url.endsWith('/start')){start=body;return new Response(JSON.stringify(flow),{status:201});}return new Response(JSON.stringify(receipt(start)));}}),{code:'proof'});assert.equal(shown,'https://setup.murakumo.cloud/#device-link?code=ABCD123456');assert.equal(await savedLink(d),null);});
test('legacy registration is preserved but cannot become verified ownership on reboot',async()=>{const d=await dir(),id=await identity(d);const legacy={version:1,authority:'https://murakumo.cloud',deviceDid:id.did,accountDid:'did:key:legacy',registrationState:'registered'};await writeFile(join(d,'account-link.json'),JSON.stringify(legacy),{mode:0o600});await assert.rejects(savedLink(d),{code:'legacy-proof-required'});assert.deepEqual(JSON.parse(await readFile(join(d,'account-link.json'),'utf8')),legacy);});

test('legacy approval can start a fresh flow without replacing its evidence or identity on refusal',async()=>{
  const d=await dir(),id=await identity(d),legacy={version:1,authority:'https://murakumo.cloud',deviceDid:id.did,accountDid:'did:key:legacy',registrationState:'registered'};
  const path=join(d,'account-link.json');await writeFile(path,JSON.stringify(legacy),{mode:0o600});let start,shown=false;
  await assert.rejects(link({dir:d,display:()=>{},onFlow:()=>{shown=true;},fetcher:async(url,opts)=>{
    const body=JSON.parse(opts.body);if(url.endsWith('/start')){start=body;return new Response(JSON.stringify({...flow,expiresAt:Date.now()+300000}),{status:201});}
    assert.ok(url.endsWith('/poll'));return new Response(JSON.stringify(receipt(start)));
  }}),{code:'proof'});
  assert.equal(shown,true);assert.equal(start.deviceDid,id.did);assert.equal((await identity(d)).did,id.did);assert.deepEqual(JSON.parse(await readFile(path,'utf8')),legacy);
});
test('a legacy record for another device stays blocked before network requests',async()=>{
  const d=await dir();await identity(d);await writeFile(join(d,'account-link.json'),JSON.stringify({version:1,authority:'https://murakumo.cloud',deviceDid:'did:key:other',accountDid:'did:key:legacy',registrationState:'registered'}),{mode:0o600});
  await assert.rejects(link({dir:d,fetcher:()=>assert.fail('no network request')}),{code:'invalid'});
});
