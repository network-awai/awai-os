import {control,localAddress} from './remote-access.mjs';
import {networkInterfaces} from 'node:os';
export function remoteAddresses(interfaces=networkInterfaces){
 return [...new Set(Object.values(interfaces()).flat().filter(a=>a&&!a.internal&&(a.family==='IPv4'||a.family===4)&&localAddress(a.address)).map(a=>a.address))];
}
export async function showRemote(ui,t,request=control,addresses=remoteAddresses){
 try{
 await request({action:'open'});
 let completed=false;
 for(;;){
 const info=await request({action:'info'}),ips=addresses();
 const stage=info.pending?'approve':info.session?(completed?'ready':'connected'):info.window?'code':'expired';
 const titles={code:t('1 / 3 · PCでコードを入力','1 / 3 · Enter the code on your computer'),approve:t('2 / 3 · このPCの接続を許可','2 / 3 · Approve this computer'),connected:t('3 / 3 · PCと接続しました','3 / 3 · Computer connected'),ready:t('3 / 3 · SSH接続の準備ができました','3 / 3 · SSH is ready'),expired:t('コードの有効期限が切れました','Code expired')};
 const message=[titles[stage],
 ...(stage==='code'?[t('PCで次のURLを開き、8桁コードを入力してください。入力後、この画面は自動で切り替わります。','Open this URL on your computer and enter the code. This screen changes automatically.'),...ips.map(ip=>'https://'+ip+':8443/'),t('接続コード：','Connection code: ')+info.window.code,t('コードは5分間有効。Passkey・アカウント登録は不要です。','Code valid for 5 minutes. No Passkey or account required.'),t('接続先を確認する証明書指紋：','Certificate fingerprint to verify the Node:'),info.certificate]:[]),
 ...(info.pending?[t('接続元のPC：','Computer: ')+info.pending.name,t('接続元IP：','Source IP: ')+info.pending.address]:[]),
 ...(info.ssh?[t('SSH公開鍵：','SSH public key: ')+info.ssh.fingerprint,...(info.ssh.kekkaiFingerprint?[t('Kekkai機器鍵：','Kekkai device key: ')+info.ssh.kekkaiFingerprint]:[]),t('許可すると、このPCはsudoで本体を管理できます。鍵は削除するまで保持されます。秘密鍵はPCに保存されます。','Approval lets this computer administer the Node with sudo. The key remains until removed. Private keys stay on the computer.')]:[]),
 ...(info.session?[t('接続中：','Connected: ')+info.session.name,completed?t('本体での操作は完了です。PCの画面に戻ってください。再接続用コマンドはPCに表示されます。','You are done on this Node. Return to the computer; it shows the reconnect command.'):t('PCの画面で続きを操作してください。本体で更新ボタンを押す必要はありません。','Continue on your computer. No manual refresh is needed here.')]:[]),
 ...(stage==='expired'?[t('新しいコードを発行し、PCでもう一度入力してください。','Generate a new code and enter it on your computer.')]:[])].join('\n');
 const items=[...(info.pending?[['approve',info.ssh?t('このPCに接続と管理を許可','Allow this computer to connect and administer'):t('このPCに状態確認を許可','Allow this computer to view status')]]:[]),
 ...(info.ssh&&!info.pending?[['ssh',t('このPCにSSH管理を許可','Allow this computer to administer by SSH')]]:[]),
 ...(!ui.watch?[['refresh',t('接続状況を更新','Refresh connection status')]]:[]),
 ...(!info.session?[['new',t('新しいコードを発行','Generate a new code')]]:[]),
 ...(info.session?[['back',t('完了 · 本体の設定に戻る','Done · Return to Node settings')],['revoke',t('このPCのSSH権限を削除','Remove this computer’s SSH access')]]:[['back',t('接続をやめて戻る','Cancel and go back')]])];
 const action=(ui.watch||ui.menu)(message,items,JSON.stringify([Boolean(info.window),info.pending,info.session,info.ssh]));if(!action||action==='back')break;
 if(action==='approve'){
  ui.busy?.(t('接続を準備しています… PCはそのままお待ちください','Preparing the connection… Leave the computer open'));
  await request({action:'approve',fingerprint:info.ssh?.fingerprint,kekkaiFingerprint:info.ssh?.kekkaiFingerprint});completed=Boolean(info.ssh);
 }else if(action==='ssh'){
  ui.busy?.(t('SSH接続を準備しています…','Preparing SSH…'));
  await request({action:'approve-ssh',fingerprint:info.ssh.fingerprint,kekkaiFingerprint:info.ssh.kekkaiFingerprint});completed=true;
 }else if(action==='new'){await request({action:'open'});completed=false;}
 else if(action==='revoke'){if(ui.menu(t('保存済みSSH鍵を削除しますか？既存SSHセッションの強制終了は行いません。','Remove the saved SSH key? Existing SSH sessions are not forcibly terminated.'),[['yes',t('削除する','Remove')],['no',t('戻る','Back')]])==='yes')await request({action:'revoke-ssh'});}
 }

 }catch{ui.message(t('遠隔管理サービスを利用できません。本体の画面で続けられます。','Remote management unavailable. Continue using this screen.'));}
 finally{await request({action:'close'}).catch(()=>{});}
}
