import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync} from 'node:fs';
export function enableSignedChecks(){
 if(process.getuid?.()!==0)throw Error('root required');
 const root='/var/lib/aiueos-update';mkdirSync(root,{recursive:true,mode:0o700});
 const s=lstatSync(root);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))throw Error('unsafe update directory');
 if(existsSync(root+'/config.json'))throw Error('already configured');
 const atomic=(name,value)=>{const path=root+'/'+name+'.new',fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}renameSync(path,root+'/'+name);};
 const trust=JSON.parse(readFileSync('/etc/murakumo/production-update-trust.json','utf8'));
 if(trust.threshold!==2||Object.keys(trust.keys||{}).length!==2)throw Error('invalid production trust');
 // Never overwrite an existing anti-replay journal. A new installation starts
 // at the known production floor; real hardware recovery remains unqualified.
 if(!existsSync(root+'/journal.json'))atomic('journal.json',{revision:1,highestSequence:4,pending:null,blocked:[]});
 atomic('config.json',{schema:'aiueos.update-config.v1',enabled:true,ownerPolicyAuthorized:true,role:'standalone',initialSequence:4,sources:['https://aiueos-updates.04-feasts-minded.workers.dev/stable/'],trust,watchdogQualified:false,policy:{mode:'automatic-stable',mandatoryMode:'semi',highDeadlineHours:72,criticalDeadlineHours:24,maxApplyRisk:'medium'},healthServices:['NetworkManager.service']});
 const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
}
export function updateSummary(t){
 let status={action:'not-configured'};try{status=JSON.parse(readFileSync('/var/lib/aiueos-update/status.json','utf8'));}catch{}
 const configured=existsSync('/var/lib/aiueos-update/config.json');
 return {configured,text:[t('NixOSの更新','NixOS updates'),`${t('状態','Status')}: ${status.action}`,status.reason||'',configured?t('署名検証・適用条件・復旧条件を満たした更新だけ適用します。','Only updates passing signature, activation and recovery gates are applied.'):t('自動更新は未設定です。所有者の署名鍵・更新方針と実機の復旧検証が必要です。USBによるデータ保持更新は利用できます。','Automatic updates are not configured. Owner trust/policy and hardware recovery qualification are required. Data-preserving USB updates are available.'),t('通常の確認は約15分ごと、通常の適用は午前3〜5時です。','Normal checks run about every 15 minutes; normal application is between 03:00 and 05:00.')].filter(Boolean).join('\n')};
}
export async function showUpdates(ui,t,{enable=enableSignedChecks,run=spawnSync,summary=updateSummary}={}){
 for(;;){const s=summary(t),action=ui.menu(s.text,[...(s.configured?[['check',t('今すぐ更新を確認','Check updates now')],['resume',t('定期確認を再開','Resume periodic checks')]]:[['enable',t('署名付き更新の定期確認を有効にする','Enable periodic signed update checks')]]),['refresh',t('表示を再読み込み','Refresh status')],['back',t('戻る','Back')]]);
  if(action==='enable'){
   const consent=ui.menu(t('この端末を単独Nodeとして定期確認します。署名付き配信を確認し、実機の復旧検証が済むまで自動適用は保留します。既存の更新履歴は保持します。','Check signed releases periodically for this standalone Node. Automatic activation stays on hold until hardware recovery is qualified. Existing history is retained.'),[['enable',t('有効にする','Enable')],['back',t('戻る','Back')]]);
   if(consent==='enable'){try{enable();const started=run('systemctl',['start','aiueos-update.timer'],{encoding:'utf8',timeout:10000});if(started.status!==0)throw Error(t('設定は保存しましたが、定期確認を開始できません。再試行してください。','Settings saved, but periodic checks could not start. Please retry.')); ui.message(t('定期確認を有効にしました。自動適用は復旧検証待ちです。','Periodic checks enabled. Automatic activation awaits recovery qualification.'));}catch(e){ui.message(e.message);}}continue;
  }
  if(action==='resume'){const r=run('systemctl',['start','aiueos-update.timer'],{encoding:'utf8',timeout:10000});ui.message(r.status===0?t('定期確認を再開しました。','Periodic checks resumed.'):t('定期確認を開始できません。','Could not start periodic checks.'));continue;}
  if(action==='refresh')continue;if(action!=='check')return;
  const r=run('systemctl',['start','--no-block','aiueos-update.service'],{encoding:'utf8',timeout:5000});
  ui.message(r.status===0?t('更新確認を開始しました。所有者の更新方針と適用条件を満たす場合は、適用・再起動することがあります。条件を満たさない場合は理由を表示します。','Update check started. Owner policy and activation gates may allow installation and restart. Unmet gates are shown as a hold reason.'):t('確認を開始できませんでした。設定と更新サービスを確認してください。','Could not start the check. Verify configuration and update service.'));
 }
}
