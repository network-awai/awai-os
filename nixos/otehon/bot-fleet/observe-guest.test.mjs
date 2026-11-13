import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdir,mkdtemp,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {observeGuest} from './observe-guest.mjs';
async function fixture(unsafe=false){
  const parent=resolve('.agent-output');await mkdir(parent,{recursive:true});
  const dir=await mkdtemp(join(parent,'qga-test-'));await chmod(dir,0o700);
  const path=join(dir,'g.sock'),commands=[];
  const server=net.createServer(socket=>{
    let buffer='';socket.on('data',data=>{
      buffer+=data.toString().replaceAll('\ufffd','');let i;
      while((i=buffer.indexOf('\n'))>=0){
        const message=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);commands.push(message.execute);
        let result={};
        if(message.execute==='guest-sync-delimited'){
          result=message.arguments.id;
          socket.write(JSON.stringify({error:{class:'GenericError'}})+'\n');
          socket.write(Buffer.from([255]));
          socket.write(JSON.stringify({return:result+1})+'\n');
          socket.write(Buffer.from([255]));
        }
        if(message.execute==='guest-info')result={version:'fixture',supported_commands:[
          {name:'guest-ping',enabled:true},{name:'guest-exec',enabled:unsafe}]};
        if(message.execute==='guest-get-osinfo')result={id:'nixos','version-id':'fixture'};
        if(message.execute==='guest-network-get-interfaces')result=[{name:'lo'}];
        socket.write(JSON.stringify({return:result})+'\n');
      }
    });
  });
  await new Promise(r=>server.listen(path,r));
  return{path,dir,commands,close:()=>new Promise(r=>server.close(r))};
}
test('observes through a private socket without granting execution authority',async()=>{
  const f=await fixture();try{
    const r=await observeGuest(f.path);assert.equal(r.os.id,'nixos');
    assert.equal(r.executionAuthority,false);assert.equal(r.distributedExecution,'unverified');
    assert(!f.commands.includes('guest-exec'));
  }finally{await f.close();}
});
test('refuses a guest agent with broader enabled commands',async()=>{
  const f=await fixture(true);try{
    await assert.rejects(observeGuest(f.path),/unrestricted/);
    assert(!f.commands.includes('guest-get-osinfo'));
  }finally{await f.close();}
});
test('refuses non-private socket directories before sending a command',async()=>{
  const f=await fixture();try{
    await chmod(f.dir,0o755);await assert.rejects(observeGuest(f.path),/owner-private/);
    assert.equal(f.commands.length,0);
  }finally{await f.close();}
});
