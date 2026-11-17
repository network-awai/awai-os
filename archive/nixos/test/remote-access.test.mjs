import {test} from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync} from 'node:crypto';
import {Pairing,sshKey,localAddress} from '../remote-access.mjs';import {showRemote} from '../remote-ui.mjs';import {runSetup} from '../registration-ui.mjs';
function key(){const {publicKey}=generateKeyPairSync('ed25519');const raw=publicKey.export({type:'spki',format:'der'}).subarray(-32);const blob=Buffer.concat([Buffer.from([0,0,0,11]),Buffer.from('ssh-ed25519'),Buffer.from([0,0,0,32]),raw]);return 'ssh-ed25519 '+blob.toString('base64');}
test('eight-digit pairing requires physical approval and sessions expire',()=>{let now=0;const p=new Pairing({now:()=>now,code:()=> '00001234'});assert.equal(p.open().code.length,8);const {ticket}=p.pair('00001234','My Mac','192.168.1.2');assert.deepEqual(p.poll(ticket),{state:'pending'});assert.throws(()=>p.authorize(ticket),/unauthorized/);p.approve();p.authorize(ticket);assert.equal(p.poll(ticket).state,'approved');now=600001;assert.throws(()=>p.authorize(ticket),/unauthorized/);});
test('failed guesses are globally bounded and close/reissue revokes pending and active tickets',()=>{const p=new Pairing({code:()=> '12345678'});p.open();for(let i=0;i<5;i++)assert.throws(()=>p.pair('wrong','mac','127.0.0.1'),/wrong_code/);assert.throws(()=>p.pair('12345678','mac','127.0.0.1'),/pairing_closed/);p.open();const {ticket}=p.pair('12345678','mac','127.0.0.1');p.open();assert.throws(()=>p.poll(ticket),/expired/);const next=p.pair('12345678','mac','127.0.0.1');p.approve();p.close();assert.throws(()=>p.authorize(next.ticket),/unauthorized/);});
test('expired pending request cannot become an approved session',()=>{let now=0;const p=new Pairing({now:()=>now,code:()=> '12345678'});p.open();p.pair('12345678','mac','127.0.0.1');now=300001;assert.throws(()=>p.approve(),/no_request/);});
test('SSH requests accept only a public Ed25519 blob after approved pairing',()=>{const p=new Pairing({code:()=> '12345678'}),k=key();assert.throws(()=>p.requestSSH('no',k),/unauthorized/);p.open();const {ticket}=p.pair('12345678','mac','127.0.0.1');p.approve();assert.equal(p.requestSSH(ticket,k).state,'local_approval_required');assert.match(p.info().ssh.fingerprint,/^SHA256:/);for(const invalid of ['ssh-ed25519 AAAA','command="sh" '+k,k+'\n'+k,'-----BEGIN PRIVATE KEY-----'])assert.throws(()=>sshKey(invalid),/invalid_key/);});
test('public Internet peers are refused while local and tailnet addresses are recognized',()=>{for(const a of ['8.8.8.8','172.32.0.1','100.128.0.1','2001:4860::8888'])assert.equal(localAddress(a),false);for(const a of ['192.168.1.2','10.0.0.1','::ffff:172.16.1.2','100.84.1.2','fd00::1'])assert.equal(localAddress(a),true);});
test('Esc in remote UI closes the pairing session without enabling SSH',async()=>{const calls=[];await showRemote({menu:()=>null,message:()=>assert.fail()},(_j,e)=>e,async v=>{calls.push(v.action);return {window:{code:'12345678'},certificate:'SHA256=test'};},()=>['192.168.1.2']);assert.deepEqual(calls,['open','info','close']);});
test('network handoff exposes remote setup before account registration and returns to it',async()=>{const actions=['connect','remote','continue','shutdown'],events=[];await runSetup({t:(_j,e)=>e,ui:{menu:(_,items)=>{const a=actions.shift();assert.ok(items.some(([k])=>k===a));return a;},busy:()=>{}},readSaved:async()=>null,network:async()=>{events.push('network');return 'connected';},showRemote:async()=>events.push('remote'),register:async()=>{events.push('register');return {accountDid:'did:key:owner',deviceDid:'did:key:node'};},poweroff:async()=>true});assert.deepEqual(events,['network','remote','register']);assert.equal(actions.length,0);});

import {Readable} from 'node:stream';import {remoteHandler} from '../remote-access.mjs';
test('real HTTP handler denies unapproved status, foreign origins and Internet peers',async()=>{
 const p=new Pairing({code:()=> '12345678'});const h=remoteHandler(p,{page:'page',client:'client',collect:async()=>({os:'AiueOS'})});
 async function request(url,body={},extra={}){let status,payload;const req=Readable.from([JSON.stringify(body)]);Object.assign(req,{method:'POST',url,socket:{remoteAddress:'192.168.1.2'},headers:{host:'192.168.1.3:8443',...extra}});await h(req,{writeHead:s=>{status=s;},end:b=>{payload=JSON.parse(b);}});return {status,payload};}
 assert.equal((await request('/status')).status,403);
 assert.equal((await request('/pair',{code:'12345678',name:'Mac'},{origin:'https://evil.example'})).status,403);
 p.open();const first=await request('/pair',{code:'12345678',name:'Mac'});assert.equal(first.status,202);const header={authorization:'Bearer '+first.payload.ticket};assert.equal((await request('/status',{},header)).status,403);p.approve();assert.deepEqual((await request('/status',{},header)).payload,{os:'AiueOS'});assert.equal((await request('/exec',{command:'erase'},header)).status,404);
 const req=Readable.from([]);Object.assign(req,{method:'GET',url:'/',socket:{remoteAddress:'8.8.8.8'},headers:{host:'192.168.1.3:8443'}});let response;await h(req,{writeHead:s=>{response=s;},end:()=>{}});assert.equal(response,403);
});
test('SSH approval is bound to the displayed fingerprint, not a replacement key',()=>{const p=new Pairing({code:()=> '12345678'});p.open();const {ticket}=p.pair('12345678','mac','127.0.0.1');p.approve();const first=p.requestSSH(ticket,key());const secondKey=key();p.requestSSH(ticket,secondKey);assert.throws(()=>p.approvedSSH(first.fingerprint),/changed_request/);assert.equal(p.approvedSSH(p.info().ssh.fingerprint),secondKey);assert.throws(()=>p.approvedSSH(first.fingerprint),/changed_request/);});
test('LAN-only handoff permits remote setup without starting account registration',async()=>{const actions=['connect','remote','continue','shutdown'];let remote=0;await runSetup({t:(_j,e)=>e,ui:{menu:(_,items)=>{const a=actions.shift();assert.ok(items.some(([k])=>k===a));return a;},busy:()=>{}},readSaved:async()=>null,network:async()=> 'local-connected',showRemote:async()=>remote++,register:()=>assert.fail('LAN must not imply Internet registration'),poweroff:async()=>true});assert.equal(remote,1);assert.equal(actions.length,0);});

import {remoteAddresses} from '../remote-ui.mjs';
test('remote URLs use native interface discovery without relying on a service PATH',()=>{
 const a=remoteAddresses(()=>({lo:[{family:'IPv4',internal:true,address:'127.0.0.1'}],eth:[{family:'IPv4',internal:false,address:'192.168.1.2'},{family:'IPv6',internal:false,address:'fd00::1'}],vpn:[{family:4,internal:false,address:'100.84.1.2'},{family:'IPv4',internal:false,address:'192.168.1.2'}],public:[{family:'IPv4',internal:false,address:'8.8.8.8'}]}));
 assert.deepEqual(a,['192.168.1.2','100.84.1.2']);
 assert.deepEqual(remoteAddresses(()=>({eth:undefined})),[]);
});
test('Kekkai onboarding needs no account but binds both keys to local approval',()=>{
 const p=new Pairing({code:()=> '12345678'});p.open();const {ticket}=p.pair('12345678','Mac','127.0.0.1');
 assert.throws(()=>p.requestSSH(ticket,key(),{publicKey:'a'.repeat(64),host:'127.0.0.1'}),/unauthorized/);
 p.approve();const k=key();const first=p.requestSSH(ticket,k,{publicKey:'a'.repeat(64),host:'127.0.0.1'});
 p.requestSSH(ticket,k,{publicKey:'b'.repeat(64),host:'127.0.0.1'});
 assert.throws(()=>p.approvedSSH(first.fingerprint,first.kekkaiFingerprint),/changed_request/);
 assert.throws(()=>p.requestSSH(ticket,k,{publicKey:'0'.repeat(64),host:'8.8.8.8'}),/invalid_key/);
 assert.equal(p.approvedSSH(p.info().ssh.fingerprint,p.info().ssh.kekkaiFingerprint),k);
});

import {approveSSHGrant} from '../remote-access.mjs';
function grant(){const p=new Pairing({code:()=> '12345678'});p.open();const {ticket}=p.pair('12345678','Mac','127.0.0.1');p.approve();const approval=p.requestSSH(ticket,key(),{publicKey:'a'.repeat(64),host:'127.0.0.1'});return {p,approval};}
test('closing or replacing pairing during publication refuses activation and removes the grant',async()=>{
 for(const cancel of [p=>p.close(),p=>p.open()]){const {p,approval}=grant();let revoked=0;
  await assert.rejects(approveSSHGrant(p,approval,{publish:async()=>{cancel(p);return {authority:'fixture'};},install:()=>assert.fail('cancelled grant installed'),start:()=>assert.fail('cancelled grant started'),revoke:async()=>revoked++}),/unauthorized/);
  assert.equal(revoked,1);assert.equal(p.kekkaiProfile,null);
 }
});
test('failed Kekkai activation cannot publish a successful profile or retain an SSH key',async()=>{
 const {p,approval}=grant();let revoked=0,installed=0;
 await assert.rejects(approveSSHGrant(p,approval,{publish:async()=>({authority:'fixture'}),install:async()=>installed++,start:()=>{throw Error('kekkai_start_failed');},revoke:async()=>revoked++}),/kekkai_start_failed/);
 assert.equal(installed,1);assert.equal(revoked,1);assert.equal(p.kekkaiProfile,null);
});
test('revoke during key installation cannot restart an approved overlay',async()=>{
 const {p,approval}=grant();let revoked=0;
 await assert.rejects(approveSSHGrant(p,approval,{publish:async()=>({authority:'fixture'}),install:async()=>p.close(),start:()=>assert.fail('revoked overlay restarted'),revoke:async()=>revoked++}),/unauthorized/);
 assert.equal(revoked,1);
});

import {approveConnection} from '../remote-access.mjs';
test('one physical approval grants the frozen SSH and Kekkai keys without a second request',async()=>{
 const p=new Pairing({code:()=> '12345678'}),k=key();p.open();
 const {ticket}=p.pairWithSSH('12345678','Mac','127.0.0.1',k,{publicKey:'a'.repeat(64),host:'127.0.0.1'});
 assert.equal(p.poll(ticket).state,'pending');assert.throws(()=>p.authorize(ticket),/unauthorized/);
 const approval=p.info().ssh;let installs=0,starts=0;
 await assert.rejects(approveConnection(p,{...approval,fingerprint:'different'}),/changed_request/);
 assert.equal(p.poll(ticket).state,'pending');
 await approveConnection(p,approval,{publish:async()=>({authority:'fixture'}),install:async installed=>{assert.equal(installed,k);installs++;},start:()=>starts++,revoke:()=>assert.fail()});
 assert.equal(installs,1);assert.equal(starts,1);assert.equal(p.poll(ticket).sshReady,true);
});
test('invalid upfront SSH key preserves the code and expired requests never grant access',async()=>{
 let now=0;const p=new Pairing({now:()=>now,code:()=> '12345678'});p.open();
 assert.throws(()=>p.pairWithSSH('12345678','Mac','127.0.0.1','private key'),/invalid_key/);
 assert.equal(p.info().window.attempts,0);
 const {ticket}=p.pairWithSSH('12345678','Mac','127.0.0.1',key());now=300001;
 await assert.rejects(approveConnection(p,p.info().ssh||{}),/no_request/);
 assert.equal(p.info().ssh,null);assert.throws(()=>p.poll(ticket),/expired/);
});
test('guided Node flow watches incoming requests and needs one explicit administrative approval',async()=>{
 const calls=[],actions=['refresh','approve','back'];let phase=0;
 await showRemote({watch:(message,items)=>{assert.match(message,/\/ 3/);assert.ok(!items.some(([id])=>id==='refresh'));const action=actions.shift();assert.ok(action==='refresh'||items.some(([id])=>id===action));return action;},busy:()=>{},message:()=>assert.fail()},(_j,e)=>e,async v=>{
 calls.push(v.action);if(v.action==='info')return phase++===0?{window:{code:'12345678'},certificate:'pin'}:phase===2?{pending:{name:'Mac',address:'127.0.0.1'},ssh:{fingerprint:'SHA256:fixed'}}:{session:{name:'Mac'}};
 return {};
 },()=>['192.168.1.2']);
 assert.equal(calls.filter(x=>x==='approve').length,1);assert.ok(!calls.includes('approve-ssh'));assert.equal(actions.length,0);
});
