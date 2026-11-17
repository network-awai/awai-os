import net from 'node:net';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Receiver} from './ble-protocol.mjs';
const dir=process.env.MURAKUMO_BLE_DIR||'/run/murakumo-ble';
export function request(value){return new Promise((resolve,reject)=>{
  const s=net.connect(`${dir}/control.sock`),t=setTimeout(()=>s.destroy(Error('timeout')),3000);let data='';
  s.on('connect',()=>s.write(JSON.stringify(value)+'\n'));s.on('data',b=>{data+=b;if(data.length>4096)s.destroy(Error('large-response'));if(data.includes('\n')){clearTimeout(t);s.end();try{resolve(JSON.parse(data));}catch(e){reject(e);}}});s.on('error',reject);
});}
const run=(p,a)=>spawnSync(p,a,{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
async function connect({ssid,password}){
  if(process.env.MURAKUMO_BLE_BACKEND==='networkmanager'){
    const device=process.env.MURAKUMO_BLE_WIFI||run('nmcli',['-t','-f','DEVICE,TYPE','device','status']).stdout?.split('\n').find(x=>x.endsWith(':wifi'))?.split(':')[0];
    if(!device)return false;
    const r=spawnSync('nmcli',['--ask','--wait','25','device','wifi','connect',ssid,'ifname',device],{input:password+'\n',encoding:'utf8',timeout:35000});
    return r.status===0;
  }
  const path='/etc/netplan/90-murakumo-wifi.yaml',dev=process.env.MURAKUMO_BLE_WIFI||'wlp2s0';
  const old=fs.existsSync(path)?fs.readFileSync(path):null;
  const config={network:{version:2,wifis:{[dev]:{dhcp4:true,optional:true,'dhcp4-overrides':{'route-metric':600},'access-points':{[ssid]:{password}}}}}};
  const write=data=>{fs.writeFileSync(path+'.new',data,{mode:0o600});fs.chmodSync(path+'.new',0o600);fs.renameSync(path+'.new',path);};
  write(JSON.stringify(config));password=null;
  const generate=run('netplan',['generate']);
  const apply=generate.status===0?run('netplan',['apply']):null;
  let good=generate.status===0&&apply?.status===0;
  if(!good) console.error(JSON.stringify({event:'network-apply-failed',generate:generate.status,apply:apply?.status,readonly:/Read-only file system/.test((generate.stderr||'')+(apply?.stderr||'')),permission:/Permission denied|Operation not permitted/.test((generate.stderr||'')+(apply?.stderr||''))}));
  if(good){good=false;for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,2000));
    const link=run('iw',['dev',dev,'link']),addr=run('ip',['-j','address','show','dev',dev]);
    try{if(link.stdout?.split('\n').some(x=>x.trim()===`SSID: ${ssid}`)&&JSON.parse(addr.stdout)[0]?.addr_info?.some(a=>a.family==='inet')){good=true;break;}}catch{}
  }}
  if(!good){if(old)write(old);else fs.unlinkSync(path);run('netplan',['generate']);run('netplan',['apply']);}
  return good;
}
function serve(){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);
  const receiver=new Receiver(connect),socket=`${dir}/control.sock`;try{fs.unlinkSync(socket);}catch{}
  const server=net.createServer(s=>{s.setTimeout(3000,()=>s.destroy());let input='';let answered=false;
    s.on('data',b=>{if(answered)return;input+=b;if(input.length>2048){s.destroy();return;}if(!input.includes('\n'))return;answered=true;
      let result;try{const v=JSON.parse(input);if(v.op==='start'){
        const pair=receiver.start();fs.writeFileSync(`${dir}/pair.json`,JSON.stringify(pair),{mode:0o600});result={state:'ready',expires:pair.expires};
      }else if(v.op==='info')result=receiver.info();
      else if(v.op==='status')result={state:receiver.state==='ready'&&!receiver.info()?'expired':receiver.state};
      else if(v.op==='frame')result=receiver.frame(v.peer,v.chunk);
      else if(v.op==='stop'){if(receiver.state==='connecting')throw Error('busy');receiver.current=null;receiver.state='closed';receiver.buffers.clear();result={state:'closed'};}
      else throw Error('invalid-operation');
      if(!receiver.info())try{fs.unlinkSync(`${dir}/pair.json`);}catch{}
      }catch{result={error:'refused'};}s.end(JSON.stringify(result)+'\n');
    });s.on('error',()=>{});
  });server.listen(socket,()=>{fs.chmodSync(socket,0o600);console.log('BLE controller ready');});
  setInterval(()=>{if(!receiver.info())try{fs.unlinkSync(`${dir}/pair.json`);}catch{}},1000).unref();
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='serve')serve();
  else {const op=process.argv[2]||'status';console.log(JSON.stringify(await request({op})));}
}
