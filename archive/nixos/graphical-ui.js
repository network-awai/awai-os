#!/usr/bin/env gjs
imports.gi.versions.Gtk='4.0';
const {Gtk,Gdk,Gio,GLib,Pango,GdkPixbuf}=imports.gi;
const ByteArray=imports.byteArray;
const app=new Gtk.Application({application_id:'cloud.murakumo.Setup'});
let content,window,steps,footer,active=null,backend=null,language='ja',audio=null,musicEnabled=true,musicButton=null,audioKind=null;
let voiceConnection=null,voiceInput=null,voiceRevision=0,voiceState=null,voiceActions={},voiceCaption=null,voiceStatus=null;
function voiceWrite(value){try{voiceConnection?.get_output_stream().write_all(ByteArray.fromString(JSON.stringify(value)+'\n'),null);}catch{}}
function voiceInvalidate(){voiceRevision++;voiceState=null;voiceActions={};voiceWrite({kind:'invalidate'});}
function voicePublish(screen,actions){voiceState={revision:++voiceRevision,language,...screen};voiceActions=actions;voiceWrite({kind:'screen',screen:voiceState});}
function voiceListen(){
  voiceInput.read_line_async(GLib.PRIORITY_DEFAULT,null,(stream,result)=>{
    try{const [line]=stream.read_line_finish_utf8(result);if(!line||line.length>65536)throw Error('Voice disconnected');const value=JSON.parse(line);
      if(value.kind==='action'&&voiceState&&value.revision===voiceState.revision){
        if(value.action==='control')voiceSetting(value.value);
        else if(value.action==='choose')voiceActions.choose?.(value.value);
        else if(value.action==='input')voiceActions.input?.(value.value);
        else if(value.action==='erase'&&value.value===voiceState.target)voiceActions.erase?.();
        else if(['back','continue','send_code'].includes(value.action))voiceActions[value.action]?.();
      }else if(value.kind==='speech'||value.kind==='transcript'){voiceCaption.set_label((value.kind==='speech'?'AI: ':'')+String(value.text).slice(0,1200));}
      else if(value.kind==='status'){
        const states={warming:['AIを準備しています','Preparing local AI'],listening:['お話しください','Your turn to speak'],thinking:['考えています…','Thinking…'],speaking:['AIが話しています','AI is speaking'],unavailable:['AI会話を起動できません。画面で続けられます','AI unavailable. Continue using the screen'],microphone_unavailable:['マイクを利用できません。画面で続けられます','Microphone unavailable. Continue using the screen'],audio_unavailable:['音声出力を利用できません','Audio output unavailable'],playback:['音を再生しています。終了後にお話しください','Playing audio. Speak when it finishes'],retry:['聞き取れませんでした。もう一度お話しください','Could not understand. Please try again']};
        if(states[value.status])voiceStatus.set_label(tr(...states[value.status]));if(['listening','thinking','speaking'].includes(value.status)&&audioKind==='startup')stopAudio();
      }
      voiceListen();
    }catch{voiceCaption?.set_label(tr('音声会話は停止しています。画面で続けられます','Voice stopped. Continue using the screen'));voiceInvalidate();}
  });
}
function connectVoice(){
  const path=GLib.getenv('MURAKUMO_VOICE_SOCKET');if(!path)return;
  try{voiceConnection=new Gio.SocketClient().connect(new Gio.UnixSocketAddress({path}),null);voiceInput=new Gio.DataInputStream({base_stream:voiceConnection.get_input_stream()});voiceListen();}catch{voiceCaption.set_label(tr('音声会話を起動できません。画面で続けられます','Voice unavailable. Continue using the screen'));}
}
const tr=(ja,en)=>language==='ja'?ja:en;
function backKey(keyval){
  if(keyval!==Gdk.KEY_Escape)return false;
  // The backend owns the previous step. Busy/progress screens deliberately
  // have no back action: Esc must never acknowledge or interrupt a disk write.
  active?.back?.();
  return true;
}
const label=(text,cls='body')=>{const w=new Gtk.Label({label:text,wrap:cls!=='brand',wrap_mode:Pango.WrapMode.WORD_CHAR,max_width_chars:44,xalign:0,selectable:false});w.add_css_class(cls);return w;};
const box=(orientation=Gtk.Orientation.VERTICAL,spacing=16)=>new Gtk.Box({orientation,spacing});
function button(text,callback,cls='secondary'){
  const w=new Gtk.Button({label:text});w.add_css_class(cls);w.connect('clicked',callback);return w;
}
function stopAudio(){if(audio){try{audio.force_exit();}catch{}audio=null;audioKind=null;voiceWrite({kind:'playback',playing:false});}}
function voiceSetting(value){
  if(value==='music_off'){musicEnabled=false;stopAudio();musicButton?.set_label(tr('BGMを再生','Play BGM'));}
  else if(value==='music_on'){musicEnabled=true;musicButton?.set_label(tr('BGMを停止','Stop BGM'));playAudio('/etc/murakumo/startup.wav');}
  else if(['volume_up','volume_down'].includes(value)){
    const child=Gio.Subprocess.new(['amixer','-q','sset','Master',value==='volume_up'?'5%+':'5%-'],Gio.SubprocessFlags.STDOUT_SILENCE|Gio.SubprocessFlags.STDERR_SILENCE);
    child.wait_async(null,(p,r)=>{try{p.wait_finish(r);if(!p.get_successful())voiceStatus.set_label(tr('この音声出力は音量変更に対応していません','This audio output does not support volume control'));}catch{}});
  }
}
function playAudio(path,onDone=()=>{},kind='music'){
  stopAudio();
  try{const child=Gio.Subprocess.new(['aplay','-q',path],Gio.SubprocessFlags.STDOUT_SILENCE|Gio.SubprocessFlags.STDERR_SILENCE);audio=child;audioKind=kind;voiceWrite({kind:'playback',playing:true});child.wait_async(null,(p,r)=>{try{p.wait_finish(r);if(audio===p){audio=null;audioKind=null;voiceWrite({kind:'playback',playing:false});onDone(p.get_successful());}}catch{}});}catch{onDone(false);}
}
function clear(){stopAudio();while(content.get_first_child())content.remove(content.get_first_child());}
function show(title,message){clear();content.append(label(title,'heading'));if(message)content.append(label(message));}
function heading(type,message,args){
  if(type==='--menu'){
    const ids=args.slice(args.indexOf(type)+5).filter((_,i)=>i%2===0);
    if(ids.includes('wifi')&&ids.includes('wired'))return tr('ネットに接続','Connect to a network');
    if(ids.some(x=>x.startsWith('/dev/')))return tr('インストール先を選ぶ','Choose an installation disk');
    if(ids.includes('retry'))return tr('アカウントの連携を確認','Check account linking');
    if(ids.includes('local'))return tr('使い方を選ぶ','Choose how to use this device');
    if(ids.includes('network'))return tr('Murakumo Clientのセットアップ','Set up Murakumo Client');
  }
  if(/1 \/ 3|2 \/ 3|3 \/ 3/.test(message))return tr('別のPCから接続','Connect from another computer');
  if(type==='--textbox')return tr('アカウントを連携','Link an account');
  if(type==='--passwordbox')return tr('Wi-Fiに接続','Connect to Wi-Fi');
  if(message.includes('ERASE /dev/'))return tr('このディスクにインストール','Install on this disk');
  if(/\/dev\/(nvme|sd|vd|mmcblk)/.test(message))return tr('インストール先を選ぶ','Choose an installation disk');
  if(type==='--msgbox'&&/インストールが完了|Installation completed/.test(message))return tr('準備ができました','Ready to continue');
  if(/停止|stopped|できません|見つかりません|unavailable|failed/i.test(message))return tr('操作を確認してください','Check this operation');
  if(/インストールしています|Installing/.test(message))return tr('NixOSをインストール','Install NixOS');
  if(/準備しています|Preparing|確認しています|Checking|Verifying/.test(message))return tr('準備しています','Getting ready');
  return tr('Murakumoへようこそ','Welcome to Murakumo');
}
function serve(request,connection,input){
  const args=request.args;
  if(!Array.isArray(args)||args.some(x=>typeof x!=='string'))throw Error('Invalid UI request');
  const types=['--menu','--inputbox','--passwordbox','--msgbox','--infobox','--pause','--textbox'];
  const type=types.find(x=>args.includes(x));if(!type)throw Error('Unsupported UI request');
  const i=args.indexOf(type);let message=args[i+1]||'';
  const token={connection,type};active=token;
  let voice={kind:'message',message,canBack:false,canContinue:false},actions={};
  const respond=(status,value='')=>{
    if(active!==token)return;
    if(type!=='--infobox')voiceInvalidate();
    try{connection.get_output_stream().write_all(ByteArray.fromString(JSON.stringify({status,value})+'\n'),null);}catch{}
    connection.close(null);active=null;stopAudio();
  };
  show(heading(type,message,args),type==='--textbox'?tr('スマホでQRを読むか、別のPCで表示されたURLを開いてください。\nPasskeyでログインし、端末IDとコードを確認して承認してください。','Scan the QR on a phone, or open the link on another computer.\nSign in with a Passkey, check the Device ID and code, then approve.'):message.replace(/(?:次の文字をそのまま入力してください：|Type exactly: )ERASE \/dev\/[^\n]+/,'').replace(/↑↓で選択、Enterで決定。/,'接続方法を選んでください。'));
  if(type==='--menu'){
    const choices=args.slice(i+5);
    voice={kind:'menu',message,choices:[],canBack:true};const keys=new Set();
    actions={choose:key=>{if(keys.has(key))respond(0,key);},back:()=>respond(1)};
    const list=box(Gtk.Orientation.VERTICAL,10);
    for(let n=0;n<choices.length;n+=2){
      const key=choices[n],text=choices[n+1]||key;
      keys.add(key);voice.choices.push({id:key,label:text});
      const b=new Gtk.Button();b.add_css_class('choice');
      const row=box(Gtk.Orientation.HORIZONTAL,16);
      const disk=key.startsWith('/dev/');
      const icon=new Gtk.Label({label:disk?'▤':key==='wifi'?'◎':key==='wired'?'↔':'›'});icon.add_css_class('choice-icon');row.append(icon);
      const words=box(Gtk.Orientation.VERTICAL,4);words.hexpand=true;words.append(label(disk?text.split('|')[0].trim():text,'choice-title'));
      if(disk)words.append(label(text.split('|').slice(1).join(' · ')+' · '+key,'muted'));
      row.append(words);row.append(new Gtk.Label({label:'›'}));b.set_child(row);b.connect('clicked',()=>respond(0,key));list.append(b);
    }
    const scroll=new Gtk.ScrolledWindow({child:list,propagate_natural_height:true,min_content_height:240,max_content_height:400,hscrollbar_policy:Gtk.PolicyType.NEVER});content.append(scroll);list.get_first_child()?.grab_focus();
    content.append(button(tr('戻る · Esc','Back · Esc'),actions.back));
  }else if(type==='--inputbox'||type==='--passwordbox'){
    const phrase=message.match(/ERASE \/dev\/(?:nvme\d+n\d+|sd[a-z]+|vd[a-z]+|mmcblk\d+)/)?.[0];
    if(phrase){
      const target=phrase.slice(6),serial=message.match(/(?:製造番号：|Serial: )([^\n]+)/)?.[1]?.trim();
      voice={kind:'erase',message,target,serial:serial&&!['不明','not available'].includes(serial)?serial:null,canBack:true};
      actions={erase:()=>respond(0,phrase),back:()=>respond(1)};
      const agree=new Gtk.CheckButton({label:tr('このディスクの全データを消去することを確認しました','I confirm that all data on this disk will be erased')});content.append(agree);
      const controls=box(Gtk.Orientation.HORIZONTAL,12);controls.halign=Gtk.Align.END;
      controls.append(button(tr('戻る','Back'),()=>respond(1)));
      const erase=button(tr('消去してインストール','Erase and install'),()=>respond(0,phrase),'destructive');erase.sensitive=false;
      agree.connect('toggled',()=>erase.sensitive=agree.active);controls.append(erase);content.append(controls);agree.grab_focus();
    }else{
      const entry=type==='--passwordbox'?new Gtk.PasswordEntry({show_peek_icon:true}):new Gtk.Entry();entry.add_css_class('input');content.append(entry);
      voice={kind:type==='--passwordbox'?'secret':'input',message,canBack:true};
      actions={input:value=>{if(typeof value==='string'&&value.length<=128){entry.set_text('');respond(0,value);}},back:()=>{entry.set_text('');respond(1);}};
      const submit=()=>{const value=entry.get_text();entry.set_text('');respond(0,value);};entry.connect('activate',submit);
      const controls=box(Gtk.Orientation.HORIZONTAL,12);controls.halign=Gtk.Align.END;controls.append(button(tr('戻る','Back'),()=>{entry.set_text('');respond(1);}));controls.append(button(type==='--passwordbox'?tr('接続する','Connect'):tr('次へ','Continue'),submit,'primary'));content.append(controls);entry.grab_focus();
    }
  }else if(type==='--textbox'&&message==='/run/murakumo-ble/pair.json'){
    const [ok,bytes]=GLib.file_get_contents(message);if(!ok)throw Error('BLE session missing');
    const pair=JSON.parse(ByteArray.toString(bytes));if(pair.v!==1||Date.now()>=pair.expires)throw Error('BLE session expired');
    const pairToken=GLib.base64_encode(ByteArray.fromString(JSON.stringify(pair))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    show(tr('BluetoothでWi-Fiを設定','Set up Wi-Fi by Bluetooth'),tr('対応する設定アプリでQRを読み取ってください。\nMacの設定画面では、一時キーを入力できます。受付は10分間です。','Scan the QR with a compatible companion app.\nThe Mac companion also accepts the temporary key. Setup expires in 10 minutes.'));
    const png=(GLib.getenv('MURAKUMO_UI_SESSION')||'/run/murakumo-ui')+'/ble-pair.png';const qr=Gio.Subprocess.new(['qrencode','-o',png,'-s','5','-m','2',pairToken],Gio.SubprocessFlags.NONE);if(!qr.wait_check(null))throw Error('BLE QR failed');
    const pixels=GdkPixbuf.Pixbuf.new_from_file(png).scale_simple(280,280,GdkPixbuf.InterpType.NEAREST);const picture=Gtk.Picture.new_for_paintable(Gdk.Texture.new_for_pixbuf(pixels));picture.set_size_request(280,280);picture.can_shrink=true;content.append(picture);
    const key=new Gtk.Entry({text:pairToken,visibility:false,editable:false});content.append(key);
    const reveal=new Gtk.CheckButton({label:tr('一時キーを表示する','Show temporary key')});reveal.connect('toggled',()=>{key.visibility=reveal.active;});content.append(reveal);
    const state=label(tr('近くの端末からの設定を待っています…','Waiting for a nearby companion…'));content.append(state);
    const back=button(tr('戻る','Back'),()=>respond(1));content.append(back);
    voice={kind:'message',message:tr('BluetoothでWi-Fi設定を待っています。対応する設定画面を使うか、戻って音声でWi-Fiを設定できます。','Waiting for Wi-Fi settings by Bluetooth. Use a compatible companion, or go back to set up Wi-Fi by voice.'),canBack:true};actions={back:()=>respond(1)};
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,1,()=>{
      if(active!==token){GLib.unlink(png);return GLib.SOURCE_REMOVE;}
      try{const client=new Gio.SocketClient({timeout:2});const c=client.connect(new Gio.UnixSocketAddress({path:'/run/murakumo-ble/control.sock'}),null);c.get_output_stream().write_all(ByteArray.fromString('{"op":"status"}\n'),null);const [line]=new Gio.DataInputStream({base_stream:c.get_input_stream()}).read_line_utf8(null);c.close(null);const s=JSON.parse(line).state;
        if(s==='connected'){key.set_text('');GLib.unlink(png);respond(0);return GLib.SOURCE_REMOVE;}
        if(['expired','closed','failed'].includes(s)){key.set_text('');GLib.unlink(png);respond(1);return GLib.SOURCE_REMOVE;}
        state.set_label(s==='connecting'?tr('Wi-Fiに接続しています…','Connecting to Wi-Fi…'):tr('近くの端末からの設定を待っています…','Waiting for a nearby companion…'));
      }catch{}
      if(Date.now()>=pair.expires){key.set_text('');GLib.unlink(png);respond(1);return GLib.SOURCE_REMOVE;}
      return GLib.SOURCE_CONTINUE;
    });
  }else if(type==='--textbox'){
    // Only the existing registration controller's private file is accepted.
    if(!/^\/run\/murakumo-ui\/approval\.[A-Za-z0-9]+\/qr\.txt$/.test(message))throw Error('Invalid approval path');
    const [ok,bytes]=GLib.file_get_contents(message);if(!ok)throw Error('Approval missing');
    const text=ByteArray.toString(bytes),uri=text.trim().split('\n').pop();
    if(!/^https:\/\/[^\s]+$/.test(uri))throw Error('Invalid approval URI');
    const png=message+'.png';
    const qr=Gio.Subprocess.new(['qrencode','-o',png,'-s','7','-m','2',uri],Gio.SubprocessFlags.NONE);
    if(!qr.wait_check(null))throw Error('QR generation failed');
    // Fixed-size, crisp QR modules keep long approval URIs within the page.
    const pixels=GdkPixbuf.Pixbuf.new_from_file(png).scale_simple(300,300,GdkPixbuf.InterpType.NEAREST);
    const picture=Gtk.Picture.new_for_paintable(Gdk.Texture.new_for_pixbuf(pixels));picture.set_size_request(300,300);picture.can_shrink=true;
    const row=box(Gtk.Orientation.HORIZONTAL,24),details=box(Gtk.Orientation.VERTICAL,16);details.hexpand=true;details.valign=Gtk.Align.CENTER;
    row.append(picture);row.append(details);
    for(const line of text.split('\n').filter(x=>/^(Code:|Device ID:)/.test(x)))details.append(label(line,'muted'));
    const acousticStatus=label('', 'muted');
    const sendSound=button(tr('音でコードを送る','Send code by sound'),()=>{
      musicEnabled=false;musicButton?.set_label(tr('BGMを再生','Play BGM'));
      const code=text.split('\n').find(x=>x.startsWith('Code: '))?.slice(6);
      if(!/^[A-Z0-9_-]{10}$/.test(code||''))return;
      const path=message+'.wav';
      try{const generator=Gio.Subprocess.new(['node','/etc/murakumo/setup-sound.mjs','code',code,path],Gio.SubprocessFlags.STDERR_SILENCE);if(!generator.wait_check(null))throw Error('Audio generation');
        acousticStatus.set_label(tr('コードを送信中… 読み取り後にPasskeyで承認してください。','Sending code… Approve with a Passkey after reading.'));
        playAudio(path,ok=>{acousticStatus.set_label(ok?tr('送信完了。必要ならもう一度送信できます。','Sent. You can send again.'):tr('音声出力を利用できません。QRまたはURLを使えます。','Audio unavailable. Use the QR or URL.'));},'code');
      }catch{acousticStatus.set_label(tr('音声出力を利用できません。QRまたはURLを使えます。','Audio unavailable. Use the QR or URL.'));}
    });details.append(sendSound);voice={kind:'approval',message:tr('Passkeyでログインし、端末IDとコードを確認して承認してください。音でコードを送れます。','Sign in with a Passkey, compare the device identity and code, then approve. You can send the code by sound.'),canBack:true};actions={send_code:()=>sendSound.emit('clicked'),back:()=>respond(1)};details.append(label(tr('音の読み取りには専用ページが必要です（公開準備中）。','Sound reading needs the companion page (public release pending).'),'muted'));details.append(acousticStatus);
    const address=new Gtk.Label({label:uri,wrap:true,wrap_mode:Pango.WrapMode.WORD_CHAR,max_width_chars:28,xalign:0,selectable:true});address.add_css_class('muted');details.append(address);
    details.append(label(tr('承認待ち · 有効期限5分','Waiting for approval · Expires in 5 minutes'),'muted'));const later=button(tr('あとで登録','Link later'),()=>respond(1));details.append(later);content.append(row);later.grab_focus();
  }else if(type==='--infobox'||type==='--pause'){
    voice={kind:'busy',message};
    const spinner=new Gtk.Spinner({spinning:true,width_request:40,height_request:40,halign:Gtk.Align.START});content.append(spinner);
    // Busy updates are acknowledged immediately; installation runs separately
    // from the UI event loop. Pauses retain the caller's retry pacing.
    if(type==='--pause')GLib.timeout_add(GLib.PRIORITY_DEFAULT,2000,()=>{respond(0);return GLib.SOURCE_REMOVE;});else {voicePublish(voice,{});respond(0);}
  }else{
    voice={kind:'message',message,canContinue:true};actions={continue:()=>respond(0)};
    const next=button(/再起動|restart/i.test(message)?tr('再起動する','Restart'):tr('続ける','Continue'),()=>respond(0),'primary');content.append(next);next.grab_focus();
  }
  if(active===token){token.back=actions.back;voicePublish(voice,actions);}
  if(type==='--menu'&&args.includes('--remote-watch')){
    let previous=args[args.indexOf('--remote-state')+1]||null;
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,1,()=>{
      if(active!==token)return GLib.SOURCE_REMOVE;
      try{
        const client=new Gio.SocketClient({timeout:2});
        const c=client.connect(new Gio.UnixSocketAddress({path:'/run/murakumo-remote/control.sock'}),null);
        c.get_output_stream().write_all(ByteArray.fromString('{"action":"info"}\n'),null);
        const [line]=new Gio.DataInputStream({base_stream:c.get_input_stream()}).read_line_utf8(null);c.close(null);
        const info=JSON.parse(line);
        const state=JSON.stringify([Boolean(info.window),info.pending,info.session,info.ssh]);
        if(previous!==null&&state!==previous){respond(0,'refresh');return GLib.SOURCE_REMOVE;}
        previous=state;
      }catch{respond(0,'refresh');return GLib.SOURCE_REMOVE;}
      return GLib.SOURCE_CONTINUE;
    });
  }
  if(active===token){
    input.read_line_async(GLib.PRIORITY_DEFAULT,null,(stream,result)=>{
      try{stream.read_line_finish_utf8(result);}catch{}
      if(active===token){active=null;voiceInvalidate();stopAudio();show(tr('準備しています','Getting ready'),tr('次の画面へ進んでいます…','Continuing to the next screen…'));}
      try{connection.close(null);}catch{}
    });
  }
}
app.connect('activate',()=>{
  const css=new Gtk.CssProvider();css.load_from_string(`
    .choice-icon { font-size: 28px; min-width: 28px; color: #6776a0; }
window { background: linear-gradient(125deg,#f1efff,#f8faff 48%,#edf4ff); color:#20232d; }
    .card { background:rgba(255,255,255,0.97); border:1px solid #ffffff; border-radius:28px; padding:38px; box-shadow:0 20px 60px rgba(40,50,100,0.12); }

    .steps { font-size:13px; color:#777e92; }
    .heading { font-size:30px; font-weight:700; margin-top:12px; margin-bottom:6px; }
    .body { font-size:15px; color:#4f5668; }
    .muted { font-size:12px; color:#7a8193; }
    .choice-title { font-size:16px; font-weight:600; }
    button { border-radius:12px; padding:12px 18px; font-size:15px; border:1px solid #e5e8ef; background:#f8f9fc; box-shadow:none; }
    button:hover { background:#eef1ff; border-color:#b8c4f8; }
    .choice { padding:18px; background:#ffffff; }
    .primary { background:#4361e8; color:white; border-color:#4361e8; font-weight:600; }
    .primary:hover { background:#314ed7; }
    .destructive { background:#d74350; color:white; border-color:#d74350; }
    .destructive:disabled { background:#f3e7e9; color:#bba0a5; border-color:#f3e7e9; }
    .input { font-size:18px; padding:12px; border-radius:12px; }
    checkbutton { font-size:14px; padding:12px 0; }
  `);
  Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
  window=new Gtk.ApplicationWindow({application:app,title:'Awai Node Setup',default_width:1024,default_height:768});window.connect('close-request',()=>true);
  const outer=box(Gtk.Orientation.VERTICAL,20);outer.halign=Gtk.Align.CENTER;outer.valign=Gtk.Align.CENTER;outer.set_size_request(760,-1);outer.margin_top=30;outer.margin_bottom=30;
  const card=box(Gtk.Orientation.VERTICAL,20);card.add_css_class('card');
  const header=box(Gtk.Orientation.HORIZONTAL,0);header.halign=Gtk.Align.START;header.add_css_class('brand-logo');
  const logoPixels=GdkPixbuf.Pixbuf.new_from_file('/etc/murakumo/logo.png').scale_simple(240,37,GdkPixbuf.InterpType.BILINEAR);
  const logo=Gtk.Picture.new_for_paintable(Gdk.Texture.new_for_pixbuf(logoPixels));logo.set_size_request(240,37);logo.can_shrink=true;logo.set_alternative_text('Murakumo');header.append(logo);card.append(header);
  steps=label('ネット接続    ›    NixOS    ›    Murakumo Client','steps');card.append(steps);
  content=box(Gtk.Orientation.VERTICAL,18);card.append(content);outer.append(card);footer=label('NixOS · インストールはオフラインでも完了できます','muted');outer.append(footer);
  voiceStatus=label(tr('AIとの音声会話を準備しています','Preparing AI voice conversation'),'muted');outer.append(voiceStatus);
  voiceCaption=label('','muted');outer.append(voiceCaption);connectVoice();
  musicButton=button('BGM 停止 / Stop music',()=>{musicEnabled=!musicEnabled;if(musicEnabled)playAudio('/etc/murakumo/startup.wav',ok=>{if(!ok)musicButton.set_label(tr('音声出力なし','Audio unavailable'));});else stopAudio();musicButton.set_label(musicEnabled?tr('BGMを停止','Stop BGM'):tr('BGMを再生','Play BGM'));});outer.append(musicButton);
  const viewport=new Gtk.ScrolledWindow({child:outer,hscrollbar_policy:Gtk.PolicyType.NEVER});window.set_child(viewport);show(tr('Murakumoへようこそ','Welcome to Murakumo'),'セットアップを準備しています…');window.fullscreen();window.present();
  const keys=new Gtk.EventControllerKey();keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
  keys.connect('key-pressed',(_controller,keyval)=>backKey(keyval));window.add_controller(keys);
  const socketPath=GLib.getenv('MURAKUMO_UI_SOCKET');
  if(!socketPath||!socketPath.startsWith('/run/murakumo-ui/'))throw Error('Missing private socket');
  const service=new Gio.SocketService();service.add_address(new Gio.UnixSocketAddress({path:socketPath}),Gio.SocketType.STREAM,Gio.SocketProtocol.DEFAULT,null);Gio.File.new_for_path(socketPath).set_attribute_uint32('unix::mode',0o600,Gio.FileQueryInfoFlags.NONE,null);
  service.connect('incoming',(_,connection)=>{
    const input=new Gio.DataInputStream({base_stream:connection.get_input_stream()});
    input.read_line_async(GLib.PRIORITY_DEFAULT,null,(stream,result)=>{
      try{const [line]=stream.read_line_finish_utf8(result);if(!line||line.length>1048576)throw Error('Invalid request');serve(JSON.parse(line),connection,input);}
      catch(e){logError(e);try{connection.close(null);}catch{}show(tr('画面を表示できません','Unable to display the screen'),tr('操作を停止しました。電源を切らず、保守担当者にご連絡ください。','Operation stopped. Keep power connected and contact maintenance.'));}
    });return true;
  });service.start();
  const startBackend=selected=>{
  if(backend)return;
  voiceInvalidate();
  language=selected;steps.set_label(tr('ネット接続    ›    NixOS    ›    Murakumo Client','Network    ›    NixOS    ›    Murakumo Client'));footer.set_label(tr('NixOS · インストールはオフラインでも完了できます','NixOS · Installation works offline'));
  show(tr('Murakumoへようこそ','Welcome to Murakumo'),tr('セットアップを準備しています…','Preparing setup…'));
  const launcher=new Gio.SubprocessLauncher({flags:Gio.SubprocessFlags.NONE});launcher.set_stdout_file_path(GLib.getenv('MURAKUMO_UI_SESSION')+'/backend.log');launcher.set_stderr_file_path(GLib.getenv('MURAKUMO_UI_SESSION')+'/backend-error.log');
  launcher.setenv('MURAKUMO_UI_LANG',language,true);launcher.setenv('MURAKUMO_UI_LANGUAGE_SELECTED','1',true);
  // Marker precedes spawn: compositor failure must never trigger a second erase.
  GLib.file_set_contents(GLib.getenv('MURAKUMO_UI_SESSION')+'/started','1');backend=launcher.spawnv(ARGV);
  backend.wait_async(null,(child,result)=>{child.wait_finish(result);GLib.file_set_contents(GLib.getenv('MURAKUMO_UI_SESSION')+'/result',String(child.get_if_exited()?child.get_exit_status():1));if(!active){const ok=child.get_successful();show(ok?tr('セットアップを完了しました','Setup completed'):tr('セットアップを停止しました','Setup stopped'),ok?tr('まもなく再起動または電源の終了を行います。','Restart or shutdown will follow shortly.'):tr('再インストールを繰り返さず、状態を確認してください。','Check the device status before reinstalling.'));if(!ok)content.append(button(tr('電源を切る','Shut down'),()=>Gio.Subprocess.new(['systemctl','poweroff'],Gio.SubprocessFlags.NONE)));}});
  };
  show('言語を選択 / Choose your language','日本語 または English を選んでください。 / Select Japanese or English.');
  let preferred='ja';
  try{const [ok,data]=GLib.file_get_contents('/var/lib/murakumo/ui-language');const value=ByteArray.toString(data).trim();if(ok&&['ja','en'].includes(value))preferred=value;}catch{}
  playAudio('/etc/murakumo/startup.wav',ok=>{if(!ok)musicButton.set_label('音声出力なし / Audio unavailable');},'startup');
  for(const value of [preferred,preferred==='ja'?'en':'ja'])content.append(button(value==='ja'?'日本語':'English',()=>startBackend(value),'choice'));
  voicePublish({kind:'language',message:'Choose Japanese or English. 日本語か英語でお話しください。',choices:[{id:'ja',label:'日本語'},{id:'en',label:'English'}]}, {choose:value=>{if(['ja','en'].includes(value)){voiceInvalidate();startBackend(value);}}});
});
app.connect('shutdown',stopAudio);
app.run([]);
