import {randomBytes, hkdfSync, createCipheriv, createDecipheriv} from 'node:crypto';
export const SERVICE='7c710100-8e98-4d7b-a9d1-5ec677086001';
export const INFO='7c710101-8e98-4d7b-a9d1-5ec677086001';
export const WRITE='7c710102-8e98-4d7b-a9d1-5ec677086001';
export const STATUS='7c710103-8e98-4d7b-a9d1-5ec677086001';
const domain='murakumo-ble-wifi-v1';
export function session(now=Date.now()) {
  return {v:1,id:randomBytes(16).toString('hex'),key:randomBytes(32).toString('base64url'),expires:now+600000};
}
function key(s) {return hkdfSync('sha256',Buffer.from(s.key,'base64url'),Buffer.from(s.id),Buffer.from(domain),32);}
export function seal(s, command) {
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(s),iv);
  c.setAAD(Buffer.from(s.id));
  const data=Buffer.concat([c.update(JSON.stringify(command)),c.final(),c.getAuthTag()]);
  return {v:1,id:s.id,iv:iv.toString('base64'),data:data.toString('base64')};
}
export function open(s, envelope, now=Date.now()) {
  if(!s||now>=s.expires||envelope?.v!==1||envelope.id!==s.id)throw Error('not-authorized');
  if(typeof envelope.iv!=='string'||typeof envelope.data!=='string'||envelope.data.length>700)throw Error('invalid-envelope');
  const iv=Buffer.from(envelope.iv,'base64'),data=Buffer.from(envelope.data,'base64');
  if(iv.length!==12||data.length<17)throw Error('invalid-envelope');
  const c=createDecipheriv('aes-256-gcm',key(s),iv);c.setAAD(Buffer.from(s.id));c.setAuthTag(data.subarray(-16));
  const command=JSON.parse(Buffer.concat([c.update(data.subarray(0,-16)),c.final()]).toString());
  if(command.op!=='wifi'||typeof command.ssid!=='string'||!command.ssid||Buffer.byteLength(command.ssid)>32||/[\x00-\x1f\x7f]/.test(command.ssid)||typeof command.password!=='string'||!/^([\x20-\x7e]{8,63})$/.test(command.password))throw Error('invalid-command');
  return {ssid:command.ssid,password:command.password};
}
export class Receiver {
  constructor(connect, now=()=>Date.now()){this.connect=connect;this.now=now;this.buffers=new Map();this.state='closed';this.failures=0;}
  start(){if(this.state==='connecting')throw Error('busy');this.current=session(this.now());this.buffers.clear();this.failures=0;this.state='ready';return this.current;}
  info(){return this.current&&this.now()<this.current.expires&&this.state==='ready'?{v:1,id:this.current.id,expires:this.current.expires}:null;}
  frame(peer,chunk){
    if(!this.info()||this.failures>=5||typeof peer!=='string'||!peer.startsWith('/org/bluez/'))throw Error('not-authorized');
    for(const [k,v] of this.buffers)if(this.now()-v.at>10000)this.buffers.delete(k);
    if(!this.buffers.has(peer)&&this.buffers.size>=4)throw Error('busy');
    if(typeof chunk!=='string'||!chunk.length||chunk.length>512||/[^\x20-\x7e\n]/.test(chunk))throw Error('invalid-frame');
    const prior=this.buffers.get(peer)?.text||'',text=prior+chunk;
    if(text.length>1024){this.buffers.delete(peer);throw Error('too-large');}
    if(!text.endsWith('\n')){this.buffers.set(peer,{text,at:this.now()});return {state:'receiving'};}
    this.buffers.delete(peer);
    let credentials;
    try{credentials=open(this.current,JSON.parse(text),this.now());}catch{this.failures++;if(this.failures>=5)this.state='closed';throw Error('not-authorized');}
    // Consume before any asynchronous operation: duplicates and competing peers cannot apply twice.
    this.state='connecting';this.current=null;this.buffers.clear();
    Promise.resolve().then(()=>this.connect(credentials)).then(result=>{this.state=result?'connected':'failed';},()=>{this.state='failed';});
    return {state:'connecting'};
  }
}
