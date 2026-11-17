const el=id=>document.getElementById(id);let ticket=null,timer=null,requestedSSH=false;
const errors={wrong_code:'コードが一致しません。本体の8桁を確認して入力してください。',pairing_closed:'受付が終了しています。本体で「新しいコードを発行」を選んでください。',invalid_name:'このPCの名前を入力してください。',invalid_key:'Ed25519の公開鍵を入力してください。秘密鍵は使いません。',expired:'接続期限が切れました。本体で新しいコードを発行してください。',unauthorized:'接続が終了しました。本体で新しいコードを発行してください。'};
async function api(path,body={}){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json',...(ticket?{authorization:'Bearer '+ticket}:{})},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
function failed(e){clearTimeout(timer);ticket=null;el('pairing').hidden=false;el('controls').hidden=true;el('pair').disabled=false;el('message').textContent=errors[e.message]||'接続を確認できませんでした。ネット接続を確認して再試行してください。';}
async function poll(){try{const p=await api('/poll');if(p.state==='approved'&&(!requestedSSH||p.sshReady)){
 el('pairing').hidden=true;el('controls').hidden=false;el('message').textContent='接続できました。本体での操作は完了です。このPCで続けてください。';
 el('ssh-result').textContent=requestedSSH?'SSH管理権限も有効になりました。ユーザーは murakumo-admin です。':'状態確認用に接続しました。SSHを使う場合は公開鍵を指定して新しく接続してください。';
 await refresh();return;
 }el('message').textContent=p.state==='approved'?'本体がSSH接続を準備しています。この画面のままお待ちください。':'2 / 3 · 本体でPC名と権限を確認し「許可」を一度選んでください。承認後、この画面は自動で切り替わります。';timer=setTimeout(poll,1000);
 }catch(e){failed(e);}}
el('pair').onclick=async()=>{if(!/^\d{8}$/.test(el('code').value)){el('message').textContent='本体に表示された8桁の数字を入力してください。';return;}el('pair').disabled=true;
 try{const key=el('key').value.trim();requestedSSH=Boolean(key);const r=await api('/pair',{code:el('code').value,name:el('name').value,key:key||undefined});ticket=r.ticket;el('code').value='';el('pairing').hidden=true;await poll();}catch(e){failed(e);}};
async function refresh(){const s=await api('/status');el('details').textContent=['ホスト: '+s.host,'システム: '+s.os,'稼働時間: '+s.uptimeSeconds+'秒','CPU: '+s.cpuCount,'空きメモリ: '+(s.memory?.available/2**30).toFixed(1)+' GiB','ネット接続:\n'+(s.network||'確認できません'),'更新: '+(s.update?.action||'not-configured'),'アカウント: '+s.account].join('\n');}
el('status').onclick=()=>refresh().catch(failed);
