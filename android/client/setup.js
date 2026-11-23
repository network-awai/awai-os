// Android first-run UI. Native settings own credentials, connectivity and locale.
// Mobile (AWAI-3049): AOSP setup owns language, network, date/time and screen
// lock (indices 1, 2, 3, 6 are retired). PC (AWAI-4072) un-retires them as a
// keyboard/mouse, hardware-adaptive wizard delegating to Settings APIs.
import {createIdentity} from './identity.js';
export function createSetup({host,domain,root,button,el,icon,notify,render}) {
  let detail=false, accountLink=false, useQr=false;
  const identity=host&&JSON.parse(host.snapshot()).mode==='home'?createIdentity(render):null;
  const read=()=>{try{return host?.setupSnapshot?JSON.parse(host.setupSnapshot()):null;}catch{return null;}};
  const readPC=()=>{try{return host?.pcSetupSnapshot?JSON.parse(host.pcSetupSnapshot()):null;}catch{return null;}};
  const isPC = ()=>{const p=readPC();return !!(p&&p.isPC);};
  const canLinkAccount=()=>{const s=isPC()?(readPC()||{}):(read()||{});return s?.complete&&(s.account==='deferred');};
  const closeAccountLink=()=>{
    identity?.cancel();
    accountLink=false;detail=false;useQr=false;
    render();root.querySelector('h1')?.focus();
  };
  const movePC=action=>{
    const s=readPC();
    if(action==='linked'&&!identity?.account)return;
    const transition=accountLink&&action==='linked'?'link-after-setup':action;
    // For PC, the account link-after-setup path is never a blind transition; require deferred completion.
    const trAction = transition==='link-after-setup' ? 'linked' : transition;
    if(!s||!host.pcSetupTransition(trAction,s.stage)){
      notify('設定を完了できません。接続と画面ロック、言語と日時を確認してください。');
      return;
    }
    closeAccountLink();
  };
  const move=action=>{
    const s=read();
    if(action==='linked'&&!identity?.account)return;
    const transition=accountLink&&action==='linked'?'link-after-setup':action;
    if(!s||!host.setupTransition(transition,s.stage)){
      notify('設定を完了できません。接続と画面ロックを確認してください。');
      return;
    }
    closeAccountLink();
  };
  const settings=kind=>host.setupSettings(kind);
  const rows=(parent,items)=>items.forEach(([title,summary,action,name='settings'])=>{
    const b=button('',action||(()=>{}),'setup-row');b.disabled=!action;
    const copy=el('span','setup-labels');copy.append(el('span','',title),el('small','muted',summary));
    if(name==='lock'){const i=el('img','static-icon');i.src='assets/setup-lock.svg';i.width=24;i.height=24;i.alt='';b.append(i);}else b.append(icon(name));
    b.append(copy);parent.append(b);
  });
  function showPC(){
    const s=readPC();
    if(s?.account==='linked'&&!identity?.account){
      if(identity?.state.status==='loading'){root.append(el('p','page','アカウントを確認しています…'));return true;}
      if(!host.pcSetupTransition('relink',s.stage)){root.append(el('p','page','アカウント状態を確認できません。保存領域を確認して再起動してください。'));return true;}
      return showPC();
    }
    if(s?.complete&&!accountLink)return false;
    if(!s){root.append(el('p','page','PC の初期設定を読み取れません。ホームを開く前に再起動して確認してください。'));return true;}
    const stage=accountLink?4:s.stage;
    const english=s.locale.startsWith('en');
    const titles=english?['Your place,\nfrom here.','Choose your language','Connect to a network','Check date and time','Bring your Awai\nto this PC.','Your data,\nyour choice.','Protect this PC','You’re ready.']:['あなたの場所を、\nここから。','言語を選択','ネットワークに接続','日時を確認','いつもの Awai を、\nこの PC に。','あなたが決める、\nデータの使い方。','この PC を保護','準備ができました。'];
    const subtitles=english?['Welcome to Awai OS Meiji for PC.','Choose your system language and region.','Wi-Fi, Ethernet or phone tethering.','Use automatic time when connected.','Link your Awai account or set it up later.','Permissions are requested when needed.','Set an Android screen lock.','Start your Awai.']:['Awai OS Meiji (PC) へようこそ。','表示言語と地域を設定します。','Wi-Fi、有線 LAN、スマートフォンから。','接続できるときは自動で合わせます。','いつものアカウントを連携するか、あとで設定できます。','必要な権限は、機能を使うときに確認します。','画面ロックを設定して、安全にはじめましょう。','あなたの Awai を、はじめましょう。'];
    document.documentElement.lang=english?'en':'ja';
    const tr=(ja,en)=>english?en:ja;
    const page=el('section','setup-page pc');page.dataset.stage=domain.setupStage(stage);root.append(page);
    const bg=el('img','setup-background');bg.src='assets/awai-original-source-wallpaper.png';bg.alt='';page.append(bg);
    const hero=el('div','setup-context'+(stage===0?' welcome':''));page.append(hero);
    const mark=el('img','setup-mark');mark.src='assets/setup-logo.png';mark.width=stage===0?200:104;mark.height=mark.width;mark.alt='';
    const heading=el('h1','',titles[stage]);heading.tabIndex=-1;
    hero.append(mark,el('p','muted','Awai OS Meiji'),heading,el('p','setup-subtitle muted',subtitles[stage]));
    const panel=el('div','setup-panel');page.append(panel);panel.append(el('h2','',stage===0?tr('ようこそ','Welcome'):tr('設定','Setup')));
    const network=s.validated?tr('接続済み · インターネット利用可能','Connected · Internet available'):s.captive?tr('ネットワークのログインが必要','Network sign-in required'):s.connected?tr('接続済み · インターネット未確認','Connected · Internet not verified'):tr('未接続','Not connected');
    const honestNote=s.profileTransferNote||'プロフィールの転送はまだ利用できません。この端末で続けるか、あとで設定してください。';

    // Welcome: language, accessibility, wallpaper/screensaver, network summary
    if(stage===0)rows(panel,[
      [tr('言語','Language'),s.locale,()=>settings('language')],
      [tr('ユーザー補助','Accessibility'),tr('文字・読み上げ・操作をサポート','Display, reading and input'),()=>settings('accessibility')],
      [tr('壁紙とスクリーンセーバー','Wallpaper & screensaver'),tr('デスクトップとロック画面を Awai に','Awai on desktop and lock'),(host.setAwaiWallpaper?()=>host.setAwaiWallpaper('both'):()=>settings('wallpaper'))],
    ]);
    // Language step (PC-visible): Settings opens native locale.
    if(stage===1)rows(panel,[
      [tr('言語・地域','Language and region'),s.locale+' · '+s.timeZone,()=>settings('language')],
      [tr('ユーザー補助','Accessibility'),tr('文字・読み上げ','Display and speech'),()=>settings('accessibility')],
    ]);
    // Network step: hardware-adaptive transports.
    if(stage===2){
      const transports=[];
      if(s.hasEthernet)transports.push([tr('有線 LAN (Ethernet)','Ethernet'),tr('プラグを挿して設定で確認','Plug in and confirm in Settings'),()=>settings('ethernet')]);
      if(s.hasWifi)transports.push([tr('Wi-Fi','Wi-Fi'),tr('近くのネットワークから選択','Choose from nearby networks'),()=>settings('wifi')]);
      if(s.hasTethering||s.hasWifi)transports.push([tr('スマートフォンから (テザリング)','Phone tethering'),tr('必要なら設定で接続','Open Settings to connect'),()=>settings('tether')]);
      if(!transports.length)transports.push([tr('ネットワーク','Network'),s.connected?network:tr('未接続','Not connected'),()=>settings('network')]);
      rows(panel,transports);
      const note=el('p','muted',tr('接続状態は Android が判定します。','Android validates connectivity.'));
      note.role='status';panel.append(note);
    }
    // Date-time
    if(stage===3)rows(panel,[
      [tr('日時','Date and time'),s.timeZone,()=>settings('datetime')],
      [tr('タイムゾーン','Time zone'),s.timeZone,()=>settings('datetime')],
    ]);
    if(stage===4){
      panel.append(el('p','',honestNote));
      if(!detail)panel.append(button(tr('この端末で続ける','Continue on this device'),()=>{detail=true;render();},'button'));
      if(detail){
        const state=identity.state;
        const message=identity.account?tr('署名を確認しました。この端末にアカウントを連携できます。','Signature verified. Link this device to your account.'):state.status==='waiting'?tr('ブラウザで承認し、Awai Home に戻ってください。','Approve in your browser, then return to Awai Home.'):state.status==='asking'?tr('中継への接続を確認しています。','Waiting for connection approval.'):['expired','unavailable','denied-or-unavailable','storage-error'].includes(state.status)?tr('連携を完了できませんでした。接続を確認して、もう一度お試しください。','Linking did not complete. Check your connection and retry.'):tr('この端末でアカウント連携を始めます。','Link your account on this device.');
        const p=el('p','',message);p.role='status';panel.append(p);
        if(state.status==='waiting'){
          panel.append(button(tr('この端末のブラウザで承認','Approve in this device’s browser'),()=>identity.continueHere(),'button'));
          if(state.browserFailed)panel.append(el('p','muted',tr('ブラウザを開けませんでした。操作の承認を確認してください。','The browser did not open. Check operation approval.')));
          const alternate=button(tr('別端末で QR を使う','Use a QR code on another device'),()=>{
            useQr=!useQr;render();root.querySelector('#account-qr-toggle')?.focus();
          },'button text');
          alternate.id='account-qr-toggle';
          alternate.setAttribute('aria-expanded',String(useQr));panel.append(alternate);
          if(useQr){
            const qr=el('img','setup-qr');qr.src=state.qr;qr.alt=tr('スマートフォン連携用 QR コード','QR code for phone approval');qr.width=256;qr.height=256;
            panel.append(qr,el('p','',tr('端末間で確認コードを照合：','Compare the code on both devices: ')+state.code));
          }
        }
        if(identity.account)panel.append(button(tr('このアカウントで続ける','Continue with this account'),()=>movePC('linked'),'button'));
        else if(!['asking','waiting','loading'].includes(state.status))panel.append(button(tr('連携を開始','Start linking'),()=>identity.begin(),'button'));
        panel.append(button(tr('ネットワークを確認','Check network'),()=>settings('network'),'button text'));
      }
    }
    if(stage===5)rows(panel,[[tr('位置情報','Location'),tr('必要なときに確認','Ask when needed')],[tr('診断データの送信','Diagnostics'),tr('送信しない','Not sent')],[tr('アカウント','Account'),identity.account?tr('署名を確認済み · データ同期は別に設定','Signature verified · configure sync separately'):tr('未連携 · あとで設定','Not linked · set up later')]]);
    if(stage===6)rows(panel,[[tr('画面ロック','Screen lock'),s.secure?tr('設定済み','Set'):tr('未設定','Not set'),()=>settings('lock'),'lock']]);
    if(stage===7){
      rows(panel,[[tr('言語・地域','Language and region'),s.locale+' · '+s.timeZone],[tr('ネットワーク','Network'),network],[tr('画面ロック','Screen lock'),s.secure?tr('設定済み','Set'):tr('未設定','Not set')],[tr('アカウント','Account'),identity.account?tr('署名を確認済み','Signature verified'):tr('あとで設定','Set up later')]]);
      panel.append(button(tr('壁紙とスクリーンセーバーを設定','Set wallpaper and screensaver'),()=>host.openScreensaverSettings&&host.openScreensaverSettings(),'button tonal'));
    }
    const nav=el('div','setup-actions');panel.append(nav);
    nav.append(button(stage===0?tr('ユーザー補助','Accessibility'):tr('戻る','Back'),()=>accountLink?closeAccountLink():stage===0?settings('accessibility'):movePC('back'),'button text'));
    if(accountLink)return true;
    const nextAction = ()=>{
      // PC depth: account missing stays refused until defer/linked.
      if(stage===4) return 'defer';
      if(stage===7) return s.secure && (s.account==='deferred'||s.account==='linked') ? 'finish' : 'refused';
      return 'next';
    };
    const nextBtnLabel = stage===0?tr('はじめる','Get started'):stage===4?tr('あとで設定','Set up later'):stage===7?tr('Awai をひらく','Open Awai'):tr('次へ','Next');
    const next=button(nextBtnLabel,()=>{ movePC(nextAction()); });
    nav.append(next);
    if(stage===7&&!s.secure){next.disabled=true;const why=el('p','setup-lock-note muted',tr('Awai をひらくには、PIN・パターン・パスワードのいずれかの画面ロックが必要です。','To open Awai, set a PIN, pattern or password screen lock.'));why.id='setup-lock-note';next.setAttribute('aria-describedby',why.id);panel.append(why,button(tr('画面ロックを設定','Set screen lock'),()=>settings('lock'),'button'));}
    const foot=el('p','setup-status muted',network+' · Awai OS Meiji');foot.role='status';page.append(foot);
    page.dataset.motionReduced=String(JSON.parse(host.snapshot()).motionReduced);
    return true;
  }
  function show(){
    // Route to PC on PC hardware; otherwise mobile.
    if(isPC()) return showPC();
    const s=read();
    if(s?.account==='linked'&&!identity?.account){
      if(identity?.state.status==='loading'){root.append(el('p','page','アカウントを確認しています…'));return true;}
      if(!host.setupTransition('relink',s.stage)){root.append(el('p','page','アカウント状態を確認できません。保存領域を確認して再起動してください。'));return true;}return show();
    }
    if(s?.complete&&!accountLink)return false;
    if(!s){root.append(el('p','page','Android の初期設定を読み取れません。ホームを開く前に再起動して確認してください。'));return true;}
    const stage=accountLink?4:s.stage;
    const english=s.locale.startsWith('en');
    const titles=english?['Your place,\nfrom here.','Choose your language','Connect to a network','Check date and time','Bring your Awai\nto this PC.','Your data,\nyour choice.','Protect this PC','You’re ready.']:['あなたの場所を、\nここから。','言語を選択','ネットワークに接続','日時を確認','いつもの Awai を、\nこの PC に。','あなたが決める、\nデータの使い方。','この PC を保護','準備ができました。'];
    const subtitles=english?['Welcome to Awai OS Meiji.','Choose your system language and region.','Wi-Fi, Ethernet or phone tethering.','Use automatic time when connected.','Link your Awai account or set it up later.','Permissions are requested when needed.','Set an Android screen lock.','Start your Awai.']:['Awai OS Meiji へようこそ。','表示言語と地域を設定します。','Wi-Fi、有線 LAN、スマートフォンから。','接続できるときは自動で合わせます。','いつものアカウントを連携するか、あとで設定できます。','必要な権限は、機能を使うときに確認します。','画面ロックを設定して、安全にはじめましょう。','あなたの Awai を、はじめましょう。'];
    document.documentElement.lang=english?'en':'ja';
    const tr=(ja,en)=>english?en:ja;
    const page=el('section','setup-page');page.dataset.stage=domain.setupStage(stage);root.append(page);
    const bg=el('img','setup-background');bg.src='assets/awai-original-source-wallpaper.png';bg.alt='';page.append(bg);
    const hero=el('div','setup-context'+(stage===0?' welcome':''));page.append(hero);
    const mark=el('img','setup-mark');mark.src='assets/setup-logo.png';mark.width=stage===0?200:104;mark.height=mark.width;mark.alt='';
    const heading=el('h1','',titles[stage]);heading.tabIndex=-1;
    hero.append(mark,el('p','muted','Awai OS Meiji'),heading,el('p','setup-subtitle muted',subtitles[stage]));
    const panel=el('div','setup-panel');page.append(panel);panel.append(el('h2','',stage===0?tr('ようこそ','Welcome'):tr('設定','Setup')));
    const network=s.validated?tr('接続済み · インターネット利用可能','Connected · Internet available'):s.captive?tr('ネットワークのログインが必要','Network sign-in required'):s.connected?tr('接続済み · インターネット未確認','Connected · Internet not verified'):tr('未接続','Not connected');
    if(stage===0)rows(panel,[[tr('言語','Language'),s.locale,()=>settings('language')],[tr('ユーザー補助','Accessibility'),tr('文字・読み上げ・操作をサポート','Display, reading and input'),()=>settings('accessibility')]]);
    if(stage===4){
      if(!detail)panel.append(button(tr('この端末で続ける','Continue on this device'),()=>{detail=true;render();},'button'));
      if(detail){
        const state=identity.state;
        const message=identity.account?tr('署名を確認しました。この端末にアカウントを連携できます。','Signature verified. Link this device to your account.'):state.status==='waiting'?tr('ブラウザで承認し、Awai Home に戻ってください。','Approve in your browser, then return to Awai Home.'):state.status==='asking'?tr('中継への接続を確認しています。','Waiting for connection approval.'):['expired','unavailable','denied-or-unavailable','storage-error'].includes(state.status)?tr('連携を完了できませんでした。接続を確認して、もう一度お試しください。','Linking did not complete. Check your connection and retry.'):tr('この端末でアカウント連携を始めます。','Link your account on this device.');
        const p=el('p','',message);p.role='status';panel.append(p);
        if(state.status==='waiting'){
          panel.append(button(tr('この端末のブラウザで承認','Approve in this device’s browser'),()=>identity.continueHere(),'button'));
          if(state.browserFailed)panel.append(el('p','muted',tr('ブラウザを開けませんでした。操作の承認を確認してください。','The browser did not open. Check operation approval.')));
          const alternate=button(tr('別端末で QR を使う','Use a QR code on another device'),()=>{
            useQr=!useQr;render();root.querySelector('#account-qr-toggle')?.focus();
          },'button text');
          alternate.id='account-qr-toggle';
          alternate.setAttribute('aria-expanded',String(useQr));panel.append(alternate);
          if(useQr){
            const qr=el('img','setup-qr');qr.src=state.qr;qr.alt=tr('スマートフォン連携用 QR コード','QR code for phone approval');qr.width=256;qr.height=256;
            panel.append(qr,el('p','',tr('端末間で確認コードを照合：','Compare the code on both devices: ')+state.code));
          }
        }
        if(identity.account)panel.append(button(tr('このアカウントで続ける','Continue with this account'),()=>move('linked'),'button'));
        else if(!['asking','waiting','loading'].includes(state.status))panel.append(button(tr('連携を開始','Start linking'),()=>identity.begin(),'button'));
        panel.append(button(tr('ネットワークを確認','Check network'),()=>settings('network'),'button text'));
      }
    }
    if(stage===5)rows(panel,[[tr('位置情報','Location'),tr('必要なときに確認','Ask when needed')],[tr('診断データの送信','Diagnostics'),tr('送信しない','Not sent')],[tr('アカウント','Account'),identity.account?tr('署名を確認済み · データ同期は別に設定','Signature verified · configure sync separately'):tr('未連携 · あとで設定','Not linked · set up later')]]);
    if(stage===7)rows(panel,[[tr('言語・地域','Language and region'),s.locale+' · '+s.timeZone],[tr('ネットワーク','Network'),network],[tr('画面ロック','Screen lock'),s.secure?tr('設定済み','Set'):tr('未設定','Not set')],[tr('アカウント','Account'),identity.account?tr('署名を確認済み','Signature verified'):tr('あとで設定','Set up later')]]);
    const nav=el('div','setup-actions');panel.append(nav);
    nav.append(button(stage===0?tr('ユーザー補助','Accessibility'):tr('戻る','Back'),()=>accountLink?closeAccountLink():stage===0?settings('accessibility'):move('back'),'button text'));
    if(accountLink)return true;
    let action=domain.setupNext(JSON.stringify(s));
    const next=button(stage===0?tr('はじめる','Get started'):stage===4?tr('あとで設定','Set up later'):stage===7?tr('Awai をひらく','Open Awai'):tr('次へ','Next'),()=>{
      move(stage===4?'defer':action);
    });nav.append(next);
    if(stage===7&&!s.secure){next.disabled=true;const why=el('p','setup-lock-note muted',tr('Awai をひらくには、PIN・パターン・パスワードのいずれかの画面ロックが必要です。','To open Awai, set a PIN, pattern or password screen lock.'));why.id='setup-lock-note';next.setAttribute('aria-describedby',why.id);panel.append(why,button(tr('画面ロックを設定','Set screen lock'),()=>settings('lock'),'button'));}
    const foot=el('p','setup-status muted',network+' · Awai OS Meiji');foot.role='status';page.append(foot);
    page.dataset.motionReduced=String(JSON.parse(host.snapshot()).motionReduced);
    return true;
  }
  return {
    render:show,
    canLinkAccount,
    openAccountLink(){
      if(!canLinkAccount())return;
      accountLink=true;detail=true;
      render();root.querySelector('h1')?.focus();
    },
    back(){
      if(accountLink){closeAccountLink();return true;}
      const s=isPC()?(readPC()||{}):(read()||{});
      if(!s||s.complete)return false;
      if(detail){detail=false;identity?.cancel();render();}
      else if(s.stage>0) isPC()?movePC('back'):move('back');
      return true;
    },
  };
}
