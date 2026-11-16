// Android first-run UI. Native settings own credentials, connectivity and locale.
export function createSetup({host,domain,root,button,el,icon,notify,render}) {
  let detail=false;
  const read=()=>{try{return host?.setupSnapshot?JSON.parse(host.setupSnapshot()):null;}catch{return null;}};
  const move=action=>{const s=read();if(!s||!host.setupTransition(action,s.stage))notify('設定を完了できません。接続と画面ロックを確認してください。');detail=false;render();root.querySelector('h1')?.focus();};
  const settings=kind=>host.setupSettings(kind);
  const rows=(parent,items)=>items.forEach(([title,summary,action,name='settings'])=>{
    const b=button('',action||(()=>{}),'setup-row');b.disabled=!action;
    const copy=el('span','setup-labels');copy.append(el('span','',title),el('small','muted',summary));
    if(name==='lock'){const i=el('img','static-icon');i.src='assets/setup-lock.svg';i.width=24;i.height=24;i.alt='';b.append(i);}else b.append(icon(name));
    b.append(copy);parent.append(b);
  });
  function show(){
    const s=read();if(s?.complete)return false;
    if(!s){root.append(el('p','page','Android の初期設定を読み取れません。ホームを開く前に再起動して確認してください。'));return true;}
    const english=s.locale.startsWith('en');
    const titles=english?['Your place,\nfrom here.','Choose your language','Connect to a network','Check date and time','Bring your Awai\nto this PC.','Your data,\nyour choice.','Protect this PC','You’re ready.']:['あなたの場所を、\nここから。','言語を選択','ネットワークに接続','日時を確認','いつもの Awai を、\nこの PC に。','あなたが決める、\nデータの使い方。','この PC を保護','準備ができました。'];
    const subtitles=english?['Welcome to Awai OS Meiji.','Choose your system language and region.','Wi-Fi, Ethernet or phone tethering.','Use automatic time when connected.','Link your profile or set it up later.','Permissions are requested when needed.','Set an Android screen lock.','Start your Awai.']:['Awai OS Meiji へようこそ。','表示言語と地域を設定します。','Wi-Fi、有線 LAN、スマートフォンから。','接続できるときは自動で合わせます。','プロフィールを引き継ぐか、あとで設定できます。','必要な権限は、機能を使うときに確認します。','画面ロックを設定して、安全にはじめましょう。','あなたの Awai を、はじめましょう。'];
    document.documentElement.lang=english?'en':'ja';
    const tr=(ja,en)=>english?en:ja;
    const page=el('section','setup-page');page.dataset.stage=domain.setupStage(s.stage);root.append(page);
    const bg=el('img','setup-background');bg.src='assets/awai-original-source-wallpaper.png';bg.alt='';page.append(bg);
    const hero=el('div','setup-context'+(s.stage===0?' welcome':''));page.append(hero);
    const mark=el('img','setup-mark');mark.src='assets/setup-logo.png';mark.width=s.stage===0?200:104;mark.height=mark.width;mark.alt='';
    const heading=el('h1','',titles[s.stage]);heading.tabIndex=-1;
    hero.append(mark,el('p','muted','Awai OS Meiji'),heading,el('p','setup-subtitle muted',subtitles[s.stage]));
    const panel=el('div','setup-panel');page.append(panel);panel.append(el('h2','',s.stage===0?tr('ようこそ','Welcome'):s.stage===6?tr('Android の画面ロック','Android screen lock'):tr('設定','Setup')));
    const network=s.validated?tr('接続済み · インターネット利用可能','Connected · Internet available'):s.captive?tr('ネットワークのログインが必要','Network sign-in required'):s.connected?tr('接続済み · インターネット未確認','Connected · Internet not verified'):tr('未接続','Not connected');
    if(s.stage===0)rows(panel,[[tr('言語','Language'),s.locale,()=>settings('language')],[tr('ユーザー補助','Accessibility'),tr('文字・読み上げ・操作をサポート','Display, reading and input'),()=>settings('accessibility')]]);
    if(s.stage===1)rows(panel,[[tr('言語と地域','Language and region'),s.locale,()=>settings('language')]]);
    if(s.stage===2)rows(panel,[[tr('Wi-Fi','Wi-Fi'),network,()=>settings('wifi'),'wifi'],[tr('有線 LAN・端末の接続','Ethernet and connections'),tr('Android のネットワーク設定','Android network settings'),()=>settings('network'),'wifi'],[tr('スマートフォンの共有','Phone tethering'),tr('Wi-Fi ／ USB · 対応機器のみ','Wi-Fi / USB · supported hardware'),()=>settings('tether'),'phone']]);
    if(s.stage===3)rows(panel,[[new Date().toLocaleString(s.locale),s.timeZone,()=>settings('datetime')]]);
    if(s.stage===4){rows(panel,[[tr('スマートフォンから','From your phone'),tr('iPhone ／ Android で承認','Approve on iPhone / Android'),()=>{detail=true;render();},'phone'],[tr('新しくはじめる','Create a profile'),tr('新しい Awai プロフィール','New Awai profile'),()=>{detail=true;render();},'phone']]);if(detail){const p=el('p','setup-error',tr('端末へのアカウント連携は準備中です。既存の登録は変更していません。接続を確認するか、あとで設定できます。','Device account enrollment is not available yet. Your existing registration is unchanged. Check connections or set up later.'));p.role='status';panel.append(p,button(tr('ネットワークを確認','Check network'),()=>settings('network'),'button text'));}}
    if(s.stage===5)rows(panel,[[tr('位置情報','Location'),tr('必要なときに確認','Ask when needed')],[tr('診断データの送信','Diagnostics'),tr('送信しない','Not sent')],[tr('プロフィールの同期','Profile sync'),tr('未連携 · あとで設定','Not linked · set up later')]]);
    if(s.stage===6)rows(panel,[[s.secure?tr('画面ロック設定済み','Screen lock is set'):tr('PIN を設定','Set a PIN'),tr('この PC のロック解除に使用','Unlock this PC'),()=>settings('lock'),'lock'],[tr('別のロック方法','Other lock methods'),tr('Android の画面ロック設定を開く','Open Android screen lock settings'),()=>settings('lock'),'lock']]);
    if(s.stage===7)rows(panel,[[tr('言語・地域','Language and region'),s.locale+' · '+s.timeZone],[tr('ネットワーク','Network'),network],[tr('画面ロック','Screen lock'),s.secure?tr('設定済み','Set'):tr('未設定','Not set')],[tr('アカウント','Account'),tr('あとで設定','Set up later')]]);
    const nav=el('div','setup-actions');panel.append(nav);
    nav.append(button(s.stage===0?tr('ユーザー補助','Accessibility'):tr('戻る','Back'),()=>s.stage===0?settings('accessibility'):move('back'),'button text'));
    let action=domain.setupNext(JSON.stringify(s));
    const next=button(s.stage===0?tr('はじめる','Get started'):s.stage===4?tr('あとで設定','Set up later'):s.stage===6&&!s.secure?tr('ロックを設定','Set screen lock'):s.stage===7?tr('Awai をひらく','Open Awai'):tr('次へ','Next'),()=>{
      if(action==='network-required'){notify(tr('インターネット接続を確認するか、オフラインで続けてください。','Check your Internet connection or continue offline.'));return;}
      if(action==='lock-required'){settings('lock');return;}
      move(s.stage===4?'defer':action);
    });nav.append(next);
    if(s.stage===2&&!s.validated)panel.append(button(tr('オフラインで続ける','Continue offline'),()=>move('offline'),'button text'));
    if(s.stage===7&&!s.secure){next.disabled=true;panel.append(button(tr('画面ロックを設定','Set screen lock'),()=>settings('lock'),'button'));}
    const foot=el('p','setup-status muted',network+' · Awai OS Meiji');foot.role='status';page.append(foot);
    page.dataset.motionReduced=String(JSON.parse(host.snapshot()).motionReduced);
    return true;
  }
  return {render:show,back(){const s=read();if(!s||s.complete)return false;if(detail){detail=false;render();}else if(s.stage>0)move('back');return true;}};
}
