import {randomInt,randomBytes,timingSafeEqual,createHash,X509Certificate} from 'node:crypto';
import https from 'node:https';import net from 'node:net';
import {readFile,mkdir,writeFile,rename,chmod,unlink,lstat} from 'node:fs/promises';
import {spawnSync,execFile} from 'node:child_process';import {promisify} from 'node:util';
const execute=promisify(execFile);import {fileURLToPath} from 'node:url';
import {collectStatus} from './node-status.mjs';
const SOCKET='/run/murakumo-remote/control.sock',ROOT='/var/lib/murakumo-remote';
const secret=()=>randomBytes(32).toString('base64url');
export function localAddress(ip){ip=ip.replace(/^::ffff:/,'');return /^(127\.|10\.|192\.168\.|169\.254\.)/.test(ip)||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)||ip==='::1'||/^(fc|fd|fe80:)/i.test(ip);}
export function sshKey(value){if(typeof value!=='string'||value.length>1024||!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [^\r\n\x00-\x1f]*)?$/.test(value))throw Error('invalid_key');const blob=Buffer.from(value.split(' ')[1],'base64');if(blob.length!==51||blob.readUInt32BE(0)!==11||blob.subarray(4,15).toString()!=='ssh-ed25519'||blob.readUInt32BE(15)!==32)throw Error('invalid_key');return {key:value.split(' ').slice(0,2).join(' '),fingerprint:'SHA256:'+createHash('sha256').update(blob).digest('base64').replace(/=+$/,'')};}
export class Pairing {
 constructor({now=Date.now,code=()=>String(randomInt(100000000)).padStart(8,'0')}={}){this.now=now;this.makeCode=code;this.close();}
 close(){this.window=null;this.pending=null;this.session=null;this.ssh=null;this.kekkaiProfile=null;this.sshReady=false;}
 open(){this.close();this.window={code:this.makeCode(),expires:this.now()+300000,attempts:0};return this.window;}
 info(){this.expire();return {window:this.window,pending:this.pending?{name:this.pending.name,address:this.pending.address}:null,session:this.session?{name:this.session.name,expires:this.session.expires}:null,ssh:this.ssh?{fingerprint:this.ssh.fingerprint,kekkaiFingerprint:this.ssh.kekkaiFingerprint}:null};}
 expire(){if(this.window&&this.window.expires<=this.now())this.window=null;if(this.pending&&this.pending.expires<=this.now()){this.pending=null;this.ssh=null;}if(this.session&&this.session.expires<=this.now()){this.session=null;this.ssh=null;}}
 pair(code,name,address){this.expire();if(!this.window||this.window.attempts>=5||this.pending||this.session)throw Error('pairing_closed');this.window.attempts++;const a=Buffer.from(String(code)),b=Buffer.from(this.window.code);if(a.length!==b.length||!timingSafeEqual(a,b))throw Error('wrong_code');if(typeof name!=='string'||!name.trim()||name.length>64||/[\x00-\x1f\x7f]/.test(name))throw Error('invalid_name');this.pending={ticket:secret(),name,address,expires:this.window.expires};this.window=null;return {ticket:this.pending.ticket};}
 approve(){this.expire();if(!this.pending)throw Error('no_request');this.session={...this.pending,expires:this.now()+600000};this.pending=null;}
 poll(ticket){this.expire();if(this.pending?.ticket===ticket)return {state:'pending'};if(this.session?.ticket===ticket)return {state:'approved',expires:this.session.expires,sshReady:this.sshReady};throw Error('expired');}
 pairWithSSH(code,name,address,key,kekkai){
  // Validate and freeze both public keys before consuming the one-use code.
  const grant=key?this.parseSSH(key,kekkai):null;
  if(kekkai&&!grant)throw Error('invalid_key');
  const result=this.pair(code,name,address);this.ssh=grant;return result;
 }
 authorize(ticket){this.expire();if(!ticket||this.session?.ticket!==ticket)throw Error('unauthorized');}
 parseSSH(key,kekkai){const pending=sshKey(key);if(kekkai){if(!/^[a-f0-9]{64}$/.test(kekkai.publicKey)||/^0+$/.test(kekkai.publicKey)||!localAddress(kekkai.host))throw Error('invalid_key');pending.kekkai=kekkai;pending.kekkaiFingerprint=createHash('sha256').update(Buffer.from(kekkai.publicKey,'hex')).digest('hex');}return pending;}
 requestSSH(ticket,key,kekkai){this.authorize(ticket);this.ssh=this.parseSSH(key,kekkai);this.sshReady=false;return {state:'local_approval_required',fingerprint:this.ssh.fingerprint,kekkaiFingerprint:this.ssh.kekkaiFingerprint};}
 approvedSSH(fingerprint,kekkaiFingerprint){this.expire();if(!this.ssh||!this.session||this.ssh.fingerprint!==fingerprint||this.ssh.kekkaiFingerprint!==kekkaiFingerprint)throw Error('changed_request');const key=this.ssh.key;this.ssh=null;return key;}
}
export async function installSSH(key,run=spawnSync){const root='/etc/ssh/authorized_keys.d';await mkdir(root,{recursive:true,mode:0o755});const s=await lstat(root);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw Error('unsafe_key_directory');await chmod(root,0o755);const path=root+'/murakumo-admin';const tmp=path+'.'+secret();await writeFile(tmp,key+'\n',{mode:0o644,flag:'wx'});await chmod(tmp,0o644);await rename(tmp,path);const r=run('systemctl',['restart','sshd.service'],{encoding:'utf8',timeout:10000});if(r.status!==0)throw Error('ssh_start_failed');}
export async function revokeSSH(){
 await unlink('/etc/ssh/authorized_keys.d/murakumo-admin').catch(e=>{if(e.code!=='ENOENT')throw e;});
 spawnSync('systemctl',['stop','murakumo-kekkai.service','sshd.service']);
 await unlink('/var/lib/murakumo-remote/kekkai/node.edn').catch(e=>{if(e.code!=='ENOENT')throw e;});
}
export async function approveSSHGrant(pairing,approval,{
 publish=async requested=>{const r=await execute('murakumo-kekkai',['publish','/var/lib/murakumo-remote/kekkai',JSON.stringify(requested)],{encoding:'utf8',timeout:60000});return JSON.parse(r.stdout);},
 install=installSSH,
 start=()=>{if(spawnSync('systemctl',['restart','murakumo-kekkai.service']).status!==0)throw Error('kekkai_start_failed');},
 revoke=revokeSSH
}={}){
 const ticket=pairing.session?.ticket,requested=pairing.ssh?.kekkai;
 const key=pairing.approvedSSH(approval.fingerprint,approval.kekkaiFingerprint);
 pairing.kekkaiProfile=null;
 try{
  // Keep polling responsive while the real Kekkai publisher loads. A closed
  // or replaced pairing session must never activate an in-flight grant.
  const profile=requested?await publish(requested):null;
  pairing.authorize(ticket);
  await install(key);
  pairing.authorize(ticket);
  if(requested)await start();
  pairing.authorize(ticket);
  pairing.kekkaiProfile=profile;
  pairing.sshReady=true;
 }catch(e){pairing.kekkaiProfile=null;pairing.sshReady=false;await revoke();throw e;}
}
export async function approveConnection(pairing,approval,dependencies){
 pairing.expire();
 if(!pairing.pending)throw Error('no_request');
 if(pairing.ssh&&(pairing.ssh.fingerprint!==approval.fingerprint||pairing.ssh.kekkaiFingerprint!==approval.kekkaiFingerprint))throw Error('changed_request');
 pairing.approve();
 try{if(pairing.ssh)await approveSSHGrant(pairing,approval,dependencies);}catch(e){pairing.close();throw e;}
}
export async function control(value){return new Promise((resolve,reject)=>{const s=net.connect(SOCKET);s.setEncoding('utf8');let b='';s.setTimeout(90000,()=>s.destroy(Error('timeout')));s.on('connect',()=>s.write(JSON.stringify(value)+'\n'));s.on('error',reject);s.on('data',d=>{b+=d;if(b.length>65536)s.destroy(Error('too_large'));if(b.includes('\n')){s.end();const r=JSON.parse(b.split('\n')[0]);r.error?reject(Error(r.error)):resolve(r);}});});}
export function remoteHandler(pairing,{page,client,logo,bundle,collect=collectStatus}){return async(req,res)=>{
 const send=(status,value,type='application/json')=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(value===null?'':type==='application/json'?JSON.stringify(value):value);};
 try{
 if(!localAddress(req.socket.remoteAddress||''))return send(403,{error:'local_network_required'});
 const host=req.headers.host;if(!host||!/^([0-9.]+|\[[0-9a-f:]+\]):8443$/i.test(host))return send(403,{error:'numeric_local_url_required'});
 if(req.headers.origin&&req.headers.origin!=='https://'+host)return send(403,{error:'origin_refused'});
 if(req.method==='GET'&&req.url==='/')return send(200,page,'text/html; charset=utf-8');
 if(req.method==='GET'&&req.url==='/kekkai-client.tar.gz'&&bundle)return send(200,bundle,'application/gzip');
 if(req.method==='GET'&&req.url==='/logo.svg')return send(200,logo||'','image/svg+xml');
 if(req.method==='GET'&&req.url==='/client.js')return send(200,client,'text/javascript; charset=utf-8');
 if(req.method!=='POST'||!['/pair','/poll','/status','/ssh','/kekkai-profile'].includes(req.url))return send(404,{error:'not_found'});
 const chunks=[];let size=0;for await(const d of req){const chunk=Buffer.from(d);size+=chunk.length;if(size>4096)throw Error('too_large');chunks.push(chunk);}const v=JSON.parse(Buffer.concat(chunks).toString('utf8')),ticket=req.headers.authorization?.replace(/^Bearer /,'');
 if(req.url==='/pair')return send(202,pairing.pairWithSSH(v.code,v.name,req.socket.remoteAddress,v.key,v.publicKey?{publicKey:v.publicKey,host:req.socket.localAddress.replace(/^::ffff:/,'')}:undefined));
 if(req.url==='/poll')return send(200,pairing.poll(ticket));
 pairing.authorize(ticket);
 if(req.url==='/kekkai-profile')return send(pairing.kekkaiProfile?200:202,pairing.kekkaiProfile||{state:'pending'});
 if(req.url==='/status')return send(200,await collect());
 return send(202,pairing.requestSSH(ticket,v.key,v.publicKey?{publicKey:v.publicKey,host:req.socket.localAddress.replace(/^::ffff:/,'')}:undefined));
 }catch(e){send(403,{error:['wrong_code','pairing_closed','invalid_name','invalid_key','unauthorized','expired'].includes(e.message)?e.message:'request_refused'});}
 };}
async function serve(){
 await mkdir(ROOT,{recursive:true,mode:0o700});await mkdir('/run/murakumo-remote',{recursive:true,mode:0o700});
 try{await readFile(ROOT+'/tls.key');}catch(e){if(e.code!=='ENOENT')throw e;const r=spawnSync('openssl',['req','-x509','-newkey','rsa:3072','-nodes','-keyout',ROOT+'/tls.key','-out',ROOT+'/tls.crt','-days','3650','-subj','/CN=Awai Node local management'],{stdio:'ignore',timeout:30000});if(r.status!==0)throw Error('tls_failed');await chmod(ROOT+'/tls.key',0o600);}
 const tls={key:await readFile(ROOT+'/tls.key'),cert:await readFile(ROOT+'/tls.crt')},pairing=new Pairing();
 const certificate='SHA256 Fingerprint='+new X509Certificate(tls.cert).fingerprint256;
 const page=await readFile(new URL('./remote-access.html',import.meta.url));
 const server=https.createServer(tls,remoteHandler(pairing,{page,client:await readFile(new URL('./remote-client.js',import.meta.url)),logo:await readFile(new URL('./murakumo-logo.svg',import.meta.url)),bundle:await readFile(new URL('./kekkai-client.tar.gz',import.meta.url))}));server.requestTimeout=10000;server.headersTimeout=10000;server.listen(8443,'::');
 let approvalBusy=false;await unlink(SOCKET).catch(e=>{if(e.code!=='ENOENT')throw e;});const ipc=net.createServer(s=>{s.setEncoding('utf8');let b='';s.setTimeout(90000,()=>s.destroy());s.on('data',async d=>{b+=d;if(b.length>4096)return s.destroy();if(!b.includes('\n'))return;const line=b.split('\n')[0];b='';try{const v=JSON.parse(line);let result={};if(v.action==='open')result=pairing.open();else if(v.action==='info')result={...pairing.info(),certificate};else if(v.action==='approve'){if(approvalBusy)throw Error('approval_busy');approvalBusy=true;try{await approveConnection(pairing,v);}finally{approvalBusy=false;}}else if(v.action==='close')pairing.close();else if(v.action==='approve-ssh'){if(approvalBusy)throw Error('approval_busy');approvalBusy=true;try{await approveSSHGrant(pairing,v);}finally{approvalBusy=false;}}else if(v.action==='revoke-ssh'){pairing.close();await revokeSSH();}else throw Error('invalid_action');s.end(JSON.stringify(result)+'\n');}catch{s.end('{"error":"operation_failed"}\n');}});});ipc.listen(SOCKET,()=>chmod(SOCKET,0o600));
}
if(process.argv[1]===fileURLToPath(import.meta.url))serve().catch(()=>{console.error('Remote management service unavailable');process.exitCode=1;});
