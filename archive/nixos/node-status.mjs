import {spawnSync} from 'node:child_process';
import {hostname,uptime,totalmem,freemem,loadavg,cpus} from 'node:os';
import {readFile} from 'node:fs/promises';
const services=['murakumo-account-link.service','murakumo-ble-controller.service','murakumo-ble-gatt.service','tailscaled.service','NetworkManager.service'];
const command=(name,args)=>{const r=spawnSync(name,args,{encoding:'utf8',timeout:3000,maxBuffer:16384});return r.status===0?r.stdout.trim():null;};
export async function collectStatus({run=command,read=readFile,host=hostname,up=uptime,memory=()=>({total:totalmem(),available:freemem()}),load=loadavg,cpu=cpus}={}) {
 const result={schema:'murakumo.node-status.v1',observedAt:new Date().toISOString(),host:host(),uptimeSeconds:Math.floor(up()),cpuCount:cpu().length,load:load(),memory:memory(),services:{},network:run('nmcli',['-t','-f','DEVICE,TYPE,STATE','device','status']),disk:run('df',['-h','/']),account:'pending',participation:'unverified'};
 for(const service of services)result.services[service]=run('systemctl',['show',service,'--property=ActiveState','--value'])||'unknown';
 try{const os=await read('/etc/os-release','utf8');result.os=os.match(/^PRETTY_NAME="?([^"\n]+)"?$/m)?.[1]||'unknown';}catch{result.os='unknown';}
 // Read only the registration receipt; never NetworkManager connection secrets.
 try{const receipt=JSON.parse(await read('/var/lib/murakumo/account-link.json','utf8'));if(typeof receipt.deviceDid==='string'&&typeof receipt.accountDid==='string')result.account='saved-unverified';}catch{}
 // Identity approval and vault unlock are different states. A local receipt
 // cannot prove server-key custody, a current authority head or vault access.
 result.identity={registration:result.account,controller:'online-verification-required',custody:'unverified'};
 result.vault='not-unlocked';
 result.update={action:'not-configured'};
 try{const u=JSON.parse(await read('/var/lib/aiueos-update/status.json','utf8'));result.update={action:typeof u.action==='string'?u.action.slice(0,64):'unknown',sequence:Number.isSafeInteger(u.sequence)?u.sequence:null,deadline:Number.isSafeInteger(u.deadline)?u.deadline:null,reason:typeof u.reason==='string'?u.reason.slice(0,200):null};}catch{}
 return result;
}
export function formatStatus(s,t=(ja,en)=>en){return [t('Nodeの詳細状態','Node details'),`${t('ホスト','Host')}: ${s.host}`,`${t('システム','System')}: ${s.os}`,`${t('取得時刻','Observed')}: ${s.observedAt}`,`${t('起動時間','Uptime')}: ${s.uptimeSeconds}s`,`CPU: ${s.cpuCount} · Load: ${s.load.map(x=>x.toFixed(2)).join(' / ')}`,`${t('メモリ','Memory')}: ${(s.memory.available/2**30).toFixed(1)} / ${(s.memory.total/2**30).toFixed(1)} GiB ${t('空き','available')}`,'',t('接続機器','Network interfaces'),s.network||t('取得できません','Unavailable'),'',t('ディスク使用量','Disk usage'),s.disk||t('取得できません','Unavailable'),'',...Object.entries(s.services).map(([name,state])=>`${name}: ${state}`),'',t('アカウント','Account')+': '+s.account,t('本人ID・管理鍵：オンラインで確認が必要','Identity and controllers: online verification required'),t('秘密情報の保管庫：このNodeでは開いていません','Secret vault: not unlocked on this Node'),t('分散ジョブ・推論・報酬：未検証','Distributed jobs, inference and rewards: unverified'),'',t('NixOS更新','NixOS updates')+': '+(s.update?.action||'not-configured'),...(s.update?.deadline?[t('更新期限','Update deadline')+': '+new Date(s.update.deadline).toISOString()]:[]),...(s.update?.reason?[s.update.reason]:[])].join('\n');}
export async function showNodeStatus(ui,t,collect=collectStatus){for(;;){const s=await collect();const action=ui.menu(formatStatus(s,t),[['refresh',t('表示を再読み込み','Refresh status')],['back',t('戻る','Back')]]);if(action!=='refresh')return;}}
