// Operator-only bounded boot log receiver. No command or application endpoint.
import net from 'node:net';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const [output,mode='physical']=process.argv.slice(2);assert(output&&['physical','fixture'].includes(mode));
const host=mode==='physical'?'10.77.0.1':'127.0.0.1',peer=mode==='physical'?'10.77.0.2':'127.0.0.1';
const fd=fs.openSync(output,'wx',0o600);let bytes=0,client,done=false;
const server=net.createServer(socket=>{
 if(socket.remoteAddress!==peer||client){socket.destroy();return;}
 client=socket;socket.setTimeout(120000,()=>socket.destroy());
 socket.on('data',chunk=>{if(done)return;if(bytes+chunk.length>8388608){socket.destroy();return;}fs.writeSync(fd,chunk);bytes+=chunk.length;});
 socket.on('error',()=>{});socket.on('close',()=>finish('connection-closed'));
});
function finish(reason){if(done)return;done=true;clearTimeout(timer);client?.destroy();server.close();fs.fsyncSync(fd);fs.closeSync(fd);console.log(JSON.stringify({reason,bytes,output}));}
const timer=setTimeout(()=>finish('bounded-capture-expired'),600000);
server.on('error',error=>{finish('listen-failed');process.exitCode=1;});
server.listen(18095,host,()=>console.log(JSON.stringify({listening:18095,host,acceptedPeer:peer,maxBytes:8388608,maxSeconds:600})));
