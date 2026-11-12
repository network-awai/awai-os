// Owner-private Unix socket, read-only QGA commands only. No guest exec/shell.
import net from 'node:net';
import {lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomInt} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const allowed = new Set(['guest-sync','guest-sync-delimited','guest-ping','guest-info',
  'guest-get-osinfo','guest-get-time','guest-network-get-interfaces']);

export async function observeGuest(socketPath, timeoutMs=10000) {
  const [directory,socket] = await Promise.all([lstat(dirname(socketPath)),lstat(socketPath)]);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077)
      || directory.uid !== process.getuid() || !socket.isSocket() || socket.uid !== process.getuid())
    throw Error('owner-private guest observation socket required');
  const conn = net.createConnection(socketPath);
  let buffer=Buffer.alloc(0), pending=null;
  const timer=setTimeout(()=>conn.destroy(Error('guest observation deadline exceeded')),timeoutMs);
  const failures = error=>{if(pending){pending.reject(error);pending=null;}};
  conn.on('error',failures);
  conn.on('close',()=>failures(Error('guest observation channel closed')));
  conn.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    if(buffer.length>65536){conn.destroy(Error('guest response limit exceeded'));return;}
    let end;
    while((end=buffer.indexOf(10))>=0){
      let line=buffer.subarray(0,end);buffer=buffer.subarray(end+1);
      const delimiter=line.lastIndexOf(255);if(delimiter>=0)line=line.subarray(delimiter+1);
      // QGA may reply to the input flush byte with an old/parser-error frame.
      // During synchronization ignore all pre-sentinel data and wrong nonces.
      if(pending?.command==='guest-sync-delimited'&&delimiter<0)continue;
      if(!line.length)continue;
      try{
        const response=JSON.parse(line.toString('utf8'));
        if(!pending)throw Error('unsolicited guest response');
        if(pending.command==='guest-sync-delimited'&&response.return!==pending.nonce)continue;
        const current=pending;pending=null;
        if(response.error)current.reject(Error(`guest ${current.command} refused (${String(response.error.class??'unknown').slice(0,64)})`));
        else if(!Object.hasOwn(response,'return'))current.reject(Error('invalid guest response'));
        else current.resolve(response.return);
      }catch{conn.destroy(Error('invalid guest response'));}
    }
  });
  const query=(command,args)=>new Promise((resolve,reject)=>{
    if(!allowed.has(command)||pending){reject(Error('unsupported observation command'));return;}
    pending={resolve,reject,command,nonce:args?.id};
    conn.write(JSON.stringify({execute:command,...(args?{arguments:args}:{})})+'\n');
  });
  try{
    await new Promise((resolve,reject)=>{conn.once('connect',resolve);conn.once('error',reject);});
    const nonce=randomInt(0x7fffffff);conn.write(Buffer.from([255]));
    if(await query('guest-sync-delimited',{id:nonce})!==nonce)throw Error('guest synchronization refused');
    await query('guest-ping');
    const info=await query('guest-info');
    if(!Array.isArray(info.supported_commands)
        || info.supported_commands.some(c=>c.enabled===true&&!allowed.has(c.name)))
      throw Error('unrestricted guest agent refused');
    const os=await query('guest-get-osinfo');
    const interfaces=await query('guest-network-get-interfaces');
    if(!Array.isArray(interfaces))throw Error('invalid guest network observation');
    return {schema:'awai.guest-observation.v1',observedAt:new Date().toISOString(),
      guestAgentVersion:info.version??'unknown',os:{id:os.id??'unknown',version:os['version-id']??'unknown'},
      interfaceCount:interfaces.length,
      nonLoopbackInterfaces:interfaces.filter(i=>i.name!=='lo'&&i.name!=='lo0').length,
      executionAuthority:false,peerConnectivity:'unverified',distributedExecution:'unverified'};
  }finally{clearTimeout(timer);conn.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3)throw Error('usage: node observe-guest.mjs PRIVATE_GUEST_SOCKET');
  console.log(JSON.stringify(await observeGuest(process.argv[2]),null,2));
}
