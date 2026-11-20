// Local, root-private IPC. No network listener or privileged HTTP API.
import {connect} from 'node:net';
const socket=process.env.MURAKUMO_UI_SOCKET;
if (!socket?.startsWith('/run/murakumo-ui/')) process.exit(1);
const client=connect(socket);
let data='';
client.on('connect',()=>client.write(JSON.stringify({args:process.argv.slice(2)})+'\n'));
client.on('data',chunk=>{
  data+=chunk;
  if(data.length>1024*1024)process.exit(1);
  const end=data.indexOf('\n');
  if(end<0)return;
  try{
    const result=JSON.parse(data.slice(0,end));
    process.stdout.write(typeof result.value==='string'?result.value:'');
    client.end();process.exit(result.status===0?0:1);
  }catch{process.exit(1);}
});
client.on('error',()=>process.exit(1));
client.on('end',()=>process.exit(1));
