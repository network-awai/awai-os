#!/usr/bin/env node
// Eight-digit local onboarding. No account token or private key leaves this Mac.
import https from 'node:https';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,chmodSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';

export function pinnedRequest(url,fingerprint,path,payload,ticket){
 const base=new URL(url);if(base.protocol!=='https:'||base.username||base.password||base.port!=='8443')throw Error('Use the Node HTTPS URL on port 8443');
 const pin=fingerprint.trim().replace(/^SHA256 Fingerprint=/i,'').replace(/:/g,'').toLowerCase();if(!/^[a-f0-9]{64}$/.test(pin))throw Error('Certificate SHA256 fingerprint required');
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify(payload||{});
  const req=https.request(new URL(path,base),{method:'POST',rejectUnauthorized:false,agent:false,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),...(ticket?{authorization:'Bearer '+ticket}:{})}},res=>{
   const chunks=[];let size=0;res.on('data',c=>{size+=c.length;if(size>65536)res.destroy(Error('Response too large'));else chunks.push(c);});res.on('error',reject);res.on('end',()=>{try{const v=JSON.parse(Buffer.concat(chunks));if(res.statusCode>=400)throw Error(v.error);resolve(v);}catch(e){reject(e);}});
  });
  req.setTimeout(10000,()=>req.destroy(Error('Connection timeout')));req.on('error',reject);
  req.on('socket',socket=>socket.on('secureConnect',()=>{
   const actual=createHash('sha256').update(socket.getPeerCertificate().raw).digest('hex');
   if(actual!==pin){req.destroy(Error('Certificate fingerprint differs from the Node'));return;}
   req.end(body); // Send the code only after comparing the out-of-band pin.
  }));
 });
}
export function prepareSSHKey(identity){
 identity=resolve(identity);
 if(!existsSync(identity)&&!existsSync(identity+'.pub')){
  mkdirSync(dirname(identity),{recursive:true,mode:0o700});
  const generated=spawnSync('ssh-keygen',['-q','-t','ed25519','-N','','-C','Murakumo Kekkai setup','-f',identity],{encoding:'utf8'});
  if(generated.status!==0)throw Error('Could not create a local SSH key');
 }
 if(!existsSync(identity))throw Error('SSH private key is missing; existing public key was preserved');
 const key=readFileSync(identity+'.pub','utf8').trim();if(!key.startsWith('ssh-ed25519 '))throw Error('Ed25519 SSH public key required');
 return {identity,key};
}
export async function setup({url,fingerprint,identity,runtime,code,name='Mac',askApproval=console.log,sshArgs=[]}){
 const prepared=prepareSSHKey(identity);identity=prepared.identity;const key=prepared.key;
 const call=(...args)=>{const r=spawnSync(process.execPath,[join(runtime,'engine/cli.js'),'--classpath',join(runtime,'src'),join(runtime,'bootstrap.cljk'),...args],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||'Kekkai runtime failed');return JSON.parse(r.stdout);};
 const staticKey=call('client-key','unused');
 const {ticket}=await pinnedRequest(url,fingerprint,'/pair',{code,name,key,publicKey:staticKey.pub});askApproval('2 / 3 · 本体で「このPCに接続と管理を許可」を一度選んでください / Approve once on the Node.\nPC: '+name+'\nSSH: SHA256:'+createHash('sha256').update(Buffer.from(key.split(' ')[1],'base64')).digest('base64').replace(/=+$/,'')+'\nKekkai: '+createHash('sha256').update(Buffer.from(staticKey.pub,'hex')).digest('hex'));
 const until=Date.now()+300000;const delay=()=>new Promise(r=>setTimeout(r,1000));
 while((await pinnedRequest(url,fingerprint,'/poll',{},ticket)).state!=='approved'){if(Date.now()>until)throw Error('Pairing expired');await delay();}
 let profile;for(;;){profile=await pinnedRequest(url,fingerprint,'/kekkai-profile',{},ticket);if(profile.authority)break;if(Date.now()>until)throw Error('Approval expired');await delay();}
 const root=join(homedir(),'.kekkai','murakumo',createHash('sha256').update(profile.authority).digest('hex'));
 mkdirSync(root,{recursive:true,mode:0o700});chmodSync(root,0o700);const p=join(root,'profile.json');
 writeFileSync(p,JSON.stringify({...profile,static:staticKey,sshIdentity:identity}),{mode:0o600});
 chmodSync(p,0o600);
 console.log('再接続: node '+join(runtime,'setup-client.mjs')+' --runtime '+runtime+' --profile '+p);
 const r=spawnSync(process.execPath,[join(runtime,'engine/cli.js'),'--classpath',join(runtime,'src'),join(runtime,'bootstrap.cljk'),'client',root,p,...sshArgs],{stdio:'inherit'});
 if(r.status!==0)throw Error('Kekkai SSH exited '+r.status);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
 const input=createInterface({input:process.stdin,output:process.stdout});
 try{if(get('--profile')&&get('--runtime')){input.close();const p=resolve(get('--profile'));const r=spawnSync(process.execPath,[join(get('--runtime'),'engine/cli.js'),'--classpath',join(get('--runtime'),'src'),join(get('--runtime'),'bootstrap.cljk'),'client',resolve(p,'..'),p],{stdio:'inherit'});process.exitCode=r.status||0;}
 else {if(!get('--url')||!get('--fingerprint')||!get('--runtime'))throw Error('Usage: node setup-client.mjs --url https://NODE:8443 --fingerprint SHA256 --runtime PATH [--identity SSH_KEY]');
  const code=await input.question('本体の8桁コード: ');input.close();if(!/^\d{8}$/.test(code))throw Error('8 digits required');
  await setup({url:get('--url'),fingerprint:get('--fingerprint'),identity:get('--identity')||join(homedir(),'.ssh/murakumo'),runtime:get('--runtime'),code});
 }
 }catch(e){input.close();console.error(e.message);process.exitCode=1;}
}
