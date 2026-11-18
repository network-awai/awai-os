import './domain.js';
import {createSetup} from './setup.js';
import './catalog-data.js';
import './online-data.js';
import {createOnline,authenticateCatalog} from './online.js';
import { clientRuntimeProblems, createClientOperationBroker, createClientConsentHost } from './runtime.js';
import { createTorihiki, renderTorihiki } from './torihiki.js';

const domain = window.ItonamiDomain;
const root = document.getElementById('app');
const status = document.getElementById('status');
const host = window.AwaiHost;
const problems = clientRuntimeProblems(domain.descriptor, [], location.origin);
if (problems.length) throw new Error('Invalid shared runtime descriptor');
// No external operations or app-origin APIs. The original canonical broker is used unchanged.
const broker = createClientOperationBroker({ runtime: domain.descriptor, requestedCapabilities: [],
  approvedOperations: [], hostSupportedOperations: [], consentHost:createClientConsentHost() });
void broker;
let native = host ? JSON.parse(host.snapshot()) : { mode:'store', platform:'nixos', runtime:'browser', apps:[], installed:{}, agenda:[] };
let mode = native.mode;
let route = mode === 'home' ? 'home' : mode === 'yotei' ? 'yotei' : mode === 'torihiki' ? 'torihiki' : 'discover';
let torihikiClient = null;
if (mode === 'torihiki') { try { torihikiClient = createTorihiki(domain.descriptor); } catch { torihikiClient = null; } }
const torihikiState = {};
let selectedId = 'network.itonami.yotei';
const presentations = {
  'network.itonami.yotei': { icon:'calendar', category:'暮らし', tagline:'予定を、手元に。', lead:'大切な時間を、自分のペースで。予定の作成・表示はこの端末で。', badge:'端末内で使える', previewCaption:'予定を作成・表示', previewText:'自分の予定を、この端末に保存します。', sends:'外部への送信なし', sendsOnline:'配信先に IP・要求 URL 等（予定・連絡先は送信なし）', note:'予定・連絡先は送信しません。同期や遠隔推論の許可は含みません。', libraryNote:'同期先は未設定です。予定は外部に送信されていません。', updateNote:'予定データを保持して更新します。新たな権限の追加はありません。' },
  'network.itonami.torihiki': { icon:'cloud', category:'つながる', tagline:'取引所 devnet を、手元で試す。', lead:'devnet の価格と板を表示し、端末の鍵で署名して devnet に発注できます。実際の資産は扱いません。', badge:'devnet・デモ専用', previewCaption:'価格・板・発注', previewText:'通信のたびに確認画面が開き、拒否すると何も送信しません。', sends:'追加時の送信なし。使用時は devnet ノードへ読み取り要求と、署名した devnet 取引（口座番号・公開鍵・注文内容。毎回確認）', sendsOnline:'配信先に IP・要求 URL 等。使用時は devnet ノードへ読み取り要求と、署名した devnet 取引（毎回確認）', note:'実際の資産は扱いません。鍵の秘密部分は端末から出しません。通信は毎回確認し、拒否すると送信しません。', libraryNote:'devnet ノードへの通信は、毎回確認します。', updateNote:'更新内容を確認してから追加します。' },
  'network.itonami.torihiki.bot': { icon:'apps', category:'しごと', tagline:'市場運営 bot を、見守る。', lead:'Torihiki の市場運営 bot（ISIC 6611）の profile と稼働状況、devnet の価格と板を読み取り専用で表示します。発注・鍵・入出金はありません。', badge:'読み取り専用・devnet', previewCaption:'bot・価格・板', previewText:'通信のたびに確認画面が開き、拒否すると何も送信しません。', sends:'追加時の送信なし。使用時は bot 一覧・活動記録（bots.itonami.cloud）と devnet ノードへの読み取り要求のみ（毎回確認）', sendsOnline:'配信先に IP・要求 URL 等。使用時は bot 一覧と devnet ノードへの読み取り要求のみ（毎回確認）', note:'発注・署名・入出金・bot の起動はできません。通信は毎回確認し、拒否すると送信しません。', libraryNote:'bot 一覧と devnet ノードへの通信は、毎回確認します。', updateNote:'更新内容を確認してから追加します。' },
  'network.itonami.deai': { icon:'apps', category:'暮らし', tagline:'出会いの準備を、手元で。', lead:'プロフィールの下書きを作り、自分で入力した候補を関心ごとの重なりで並べて、その理由を示します。すべてこの端末の中で行います。', badge:'端末内で使える', previewCaption:'プロフィール・候補の並び順', previewText:'候補はあなたがこの端末で入力したものだけです。誰にも送信されず、ほかの利用者の情報は使いません。', sends:'外部への送信なし', sendsOnline:'配信先に IP・要求 URL 等（プロフィール・候補は送信なし）', note:'利用者どうしの連絡はまだ提供していません。外部への送信や遠隔推論はなく、ネットワークの権限もありません。', libraryNote:'外部への送信はありません。', updateNote:'更新内容を確認してから追加します。' },
  'network.itonami.tabimikake': { icon:'apps', category:'暮らし', tagline:'旅の価格を、手元で比べる。', lead:'航空券と宿の価格を、この端末で比べます。並び順は価格だけで、報酬のあるリンクには広告と表示します。予約・支払いは予約先のサイトで行い、このアプリは予約しません。', badge:'端末内で使える・架空データ', previewCaption:'比較・監視', previewText:'この版は架空のデータだけを使います。値下がりの監視の条件は、この端末にだけ保存します。', sends:'外部への送信なし', sendsOnline:'配信先に IP・要求 URL 等（検索条件・監視の条件は送信なし）', note:'予約・支払い・個人情報の入力はしません。外部への送信はなく、ネットワークの権限もありません。', libraryNote:'外部への送信はありません。', updateNote:'更新内容を確認してから追加します。' },
  'network.itonami.hiring': { icon:'apps', category:'しごと', tagline:'求職・求人の下書きを、手元で確かめる。', lead:'bot が作った応募文と求人告知の下書きを、この端末で確かめます。本文が bot の記録と一致したときだけ承認でき、差し戻すときは理由を残します。応募・投稿・送信はしません。', badge:'端末内で使える・送信なし', previewCaption:'確認・承認・差し戻し', previewText:'下書きと本文は、この端末にだけ保存します。応募は自分で応募先に行います。', sends:'外部への送信なし', sendsOnline:'配信先に IP・要求 URL 等（下書き・応募の記録は送信なし）', note:'応募・投稿・メッセージの送信はしません。外部への送信はなく、ネットワークの権限もありません。', libraryNote:'外部への送信はありません。', updateNote:'更新内容を確認してから追加します。' },
};
function presentation(app) { return presentations[app.id] || { icon:'apps', category:'暮らし', tagline:app.description, lead:app.description, badge:'開発版', previewCaption:app.name, previewText:app.description, sends:'追加時の送信なし', sendsOnline:'配信先に IP・要求 URL 等', note:'追加後の通信や権限は、アプリの説明を確認してください。', libraryNote:'', updateNote:'更新内容を確認してから追加します。' }; }
let catalog = host ? JSON.parse(host.catalog()) : window.ItonamiCatalog;
const online=window.ItonamiOnlinePins?createOnline(domain.descriptor,window.ItonamiOnlinePins):null;
let onlineEnvelope=null;
let query = '';
let filter = 'おすすめ';
let statusTimer;
const paths = { search:'android-v2-icon-search.svg', apps:'android-v2-icon-apps.svg', camera:'android-v2-icon-camera.svg',
  phone:'android-v2-icon-phone.svg', wifi:'android-v2-icon-wifi.svg', settings:'android-v2-icon-settings.svg', store:'android-v2-icon-store.svg',
  calendar:'android-v2-icon-calendar.svg', chat:'android-v2-icon-chat.svg', cloud:'store-android-v2-icon-cloud.svg', download:'store-android-v2-icon-download.svg' };

function el(tag, cls, text) { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; }
function icon(name, feature=false) { const n=el('img','static-icon'); n.alt=''; n.src='assets/'+(feature&&name==='calendar'?'store-android-v2-icon-calendar.svg':paths[name]); n.width=feature?64:24; n.height=feature?64:24; return n; }
function button(label, action, cls='button') { const n=el('button',cls,label); n.type='button'; n.addEventListener('click',e=>{if(e.isTrusted)action(e);}); return n; }
function notify(text,persistent=false) { status.textContent=text; clearTimeout(statusTimer); if(!persistent)statusTimer=setTimeout(()=>status.textContent='',6000); }
function readLocal(key,fallback) { try { const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; } catch { notify('保存した内容を読み取れません。元のデータは保持しています。'); return fallback; } }
function writeLocal(key,data) { localStorage.setItem(key,JSON.stringify(data)); }
function refresh() { if(host){native=JSON.parse(host.snapshot()); catalog=JSON.parse(host.catalog());} }
function navigate(next) { route=next; query=''; render(); root.querySelector('h1')?.focus(); window.scrollTo(0,0); }
function page(title, back) { const p=el('section','page'); const bar=el('header','app-bar'); if(back){const b=button('‹',back,'back'); b.setAttribute('aria-label','戻る');bar.append(b);} const h=el('h1','',title); h.tabIndex=-1;bar.append(h);p.append(bar);root.append(p);return p; }
function search(parent,label,onInput) { const box=el('search','search-box'); const id='search-'+Math.random().toString(36).slice(2); const input=el('input');input.id=id;input.name='query';input.type='search';input.placeholder=label;input.setAttribute('aria-label',label);input.enterKeyHint='search';input.spellcheck=false;input.autocapitalize='none';input.addEventListener('input',()=>onInput(input.value));box.append(icon('search'),input);parent.append(box);return input; }
function appButton(label,name,action,realIcon) { const b=button('',action,'app-button');const box=el('span','icon-box'); if(realIcon){const i=el('img','system-app-icon');i.src=realIcon;i.alt='';i.width=32;i.height=32;box.append(i);}else box.append(icon(name));b.append(box,el('span','app-label',label));return b; }
function launch(id) { if(host){host.launch(id);return;} if(id==='network.itonami.yotei')navigate('yotei');else notify('この操作には Android のホストが必要です。'); }
function launchCategory(category) { if(host)host.launchCategory(category);else notify('Android の端末操作です。'); }
function openYotei(){if(native.platform==='nixos'&&readLocal('itonami.store.enabled.v1',{})['network.itonami.yotei'])navigate('yotei');else if(native.installed['network.itonami.yotei'])launch('network.itonami.yotei');else mode==='home'&&host?host.openStore():navigate('detail');}
function nextEvent() { const events=mode==='yotei'?readLocal('itonami.yotei.events.v1',[]):(native.agenda||[]);return domain.nextEvent(JSON.stringify(events),Date.now()); }
let firstHomeAppearance=true;
let motionEnabled=readLocal('awai.home.motion.v1',true)!==false;
let hostHidden=false;
function syncMotion(){
  document.documentElement.dataset.homeMotion=String(motionEnabled&&!native.motionReduced&&!hostHidden&&!document.hidden&&route==='home');
}
document.addEventListener('visibilitychange',syncMotion);
window.awaiVisibility=hidden=>{hostHidden=hidden;syncMotion();};
function home() {
  const p=el('section','page home');root.append(p);
  if(firstHomeAppearance&&!native.motionReduced){p.classList.add('first-appearance');firstHomeAppearance=false;}
  const atmosphere=el('div','home-atmosphere');atmosphere.setAttribute('aria-hidden','true');
  const artwork=el('img');artwork.src='assets/awai-original-source-wallpaper.png';artwork.alt='';atmosphere.append(artwork);p.append(atmosphere);
  const date=el('p','date',new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'long'}).format(new Date()));
  const time=el('h1','clock',new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()));time.tabIndex=-1;
  const heading=el('div','home-heading');const motion=button('',()=>{
    motionEnabled=!motionEnabled;
    try{writeLocal('awai.home.motion.v1',motionEnabled);}catch{notify('この回の設定を反映しました。設定の保存はできませんでした。');}
    labelMotion();syncMotion();
  },'motion-control');
  function labelMotion(){motion.textContent=native.motionReduced?'背景は静止':motionEnabled?'背景を停止':'背景を再生';motion.disabled=!!native.motionReduced;}
  labelMotion();heading.append(date,motion);p.append(heading,time);
  const w=button('',openYotei,'card');const event=nextEvent();w.append(el('span','caption primary-text',event?'次の予定':'予定を、手元に。'),el('span','',event?`${new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(event.at))}  ${event.title}`:native.installed['network.itonami.yotei']?'まだ予定はありません':'Yotei を Store から追加できます'),el('span','caption muted',event?'あとで、自分のペースで。':'この端末に保存。外部には送信しません。'));p.append(w,el('div','space'));
  const apps=el('div','app-grid');apps.append(appButton('Store','store',()=>host?host.openStore():navigate('discover')),appButton(native.installed['network.itonami.yotei']?'Yotei':'Yotei を追加','calendar',openYotei),appButton('設定','settings',()=>host?host.openAppearance():notify('Android の端末設定です。')),appButton('すべて','apps',()=>navigate('apps')));p.append(apps);
  const bottom=el('div','home-bottom');const dock=el('nav','app-grid dock');dock.setAttribute('aria-label','よく使うアプリ');dock.append(appButton('電話','phone',()=>launchCategory('phone')),appButton('ブラウザ','search',()=>launchCategory('browser')),appButton('カメラ','camera',()=>launchCategory('camera')),appButton('すべて','apps',()=>navigate('apps')));bottom.append(dock);
  const sb=button('',()=>navigate('apps'),'search-box home-search');sb.append(icon('search'),el('span','muted','この端末を検索'));bottom.append(sb);p.append(bottom);
  if(host&&!native.isDefaultHome){p.append(button('Awai をホームに設定',()=>host.chooseHome(),'button tonal'));}
  let sy; p.addEventListener('touchstart',e=>sy=e.changedTouches[0].clientY,{passive:true});p.addEventListener('touchend',e=>{if(sy-e.changedTouches[0].clientY>90&&!e.target.closest('button'))navigate('apps');},{passive:true});
}
function drawer(){const p=page('すべてのアプリ',()=>navigate('home'));let grid;search(p,'アプリを検索',q=>{query=q;fill();});grid=el('div','app-grid');p.append(grid);function fill(){grid.replaceChildren();for(const a of native.apps.filter(a=>a.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))){grid.append(appButton(a.label,'apps',()=>launch(a.id),a.icon));}if(!grid.children.length)grid.append(el('p','muted','一致するアプリはありません。'));}fill();}
function storeApps(){return Array.isArray(catalog?.apps)?catalog.apps:[];}
function currentApp(){const apps=storeApps();return apps.find(a=>a.id===selectedId)||apps[0];}
function choose(app,next='detail'){selectedId=app.id;navigate(next);}
function openApp(app){if(app.id==='network.itonami.yotei')openYotei();else launch(app.id);}
function installedVersion(app){return native.platform==='android'?native.installed[app.id]??null:readLocal('itonami.store.enabled.v1',{})[app.id]??null;}
function appState(app){return domain.appState(JSON.stringify(app),native.platform,native.runtime,installedVersion(app));}
function nav(parent,selected){parent.classList.add('with-nav');const n=el('nav','store-nav');n.setAttribute('aria-label','Store');for(const [key,label,name]of [['discover','見つける','store'],['library','ライブラリ','apps'],['updates','更新','download']]){const b=button('',()=>navigate(key),'nav-item');if(key===selected)b.setAttribute('aria-current','page');const i=el('span','nav-icon');i.append(icon(name));b.append(i,el('span','',label));n.append(b);}parent.append(n);}
function appRow(app,desc,action){const r=button('',action,'app-row');const box=el('span','icon-box');box.append(icon(presentation(app).icon));const copy=el('span','copy');copy.append(el('span','app-name',app.name),el('span','caption muted',desc));r.append(box,copy);return r;}
function discover(){const p=page('itonami Store');if(online)p.append(button('オンラインカタログを確認',()=>updateOnline(),'button tonal'));const brand=el('img','static-icon');brand.src='assets/store-android-v2-icon-store1.svg';brand.alt='';brand.width=28;brand.height=28;p.querySelector('header').prepend(brand);let results;search(p,'アプリ・できることを検索',q=>{query=q;fill();});const chips=el('div','categories');for(const label of ['おすすめ','暮らし','つながる']){const c=button(label,()=>{filter=label;for(const s of chips.children)s.setAttribute('aria-pressed',String(s===c));fill();},'chip');c.setAttribute('aria-pressed',String(label===filter));chips.append(c);}p.append(chips);results=el('section','review');p.append(results);function fill(){results.replaceChildren();const q=query.toLocaleLowerCase();const apps=storeApps().filter(a=>appState(a)!=='unavailable'&&(filter==='おすすめ'||presentation(a).category===filter)&&`${a.name} ${a.description}`.toLocaleLowerCase().includes(q));if(!apps.length){results.append(el('p','empty muted','現在、この条件で追加できるアプリはありません。'));return;}const first=apps[0],info=presentation(first);const feature=el('article','card primary');const h=el('div','feature-head');const cp=el('div','copy');cp.append(el('h2','',first.name),el('p','',info.tagline));h.append(icon(info.icon,true),cp);feature.append(h,el('p','',info.lead),button(`${first.name} を見る`,()=>choose(first)));results.append(feature,el('h2','label muted','この端末で使える'));for(const app of apps)results.append(appRow(app,`v${app.versionName} · ${appState(app)==='installed'?'追加済み':(onlineEnvelope||native.catalogOnline)?'オンライン配信':'同梱アプリ'}`,()=>choose(app)));results.append(el('p','caption muted','同梱アプリはオフラインで追加できます。オンライン確認では取得ごとに確認画面が開きます。'));}fill();nav(p,'discover');}
function detail(){const app=currentApp(),p=page('アプリの詳細',()=>navigate('discover'));if(!app){p.append(el('p','empty muted','アプリが見つかりません。'));return;}const info=presentation(app);const h=el('div','feature-head'),cp=el('div','copy');cp.append(el('h2','',app.name),el('p','muted',info.tagline));h.append(icon(info.icon,true),cp);p.append(h,el('span','badge',info.badge));
  const preview=el('section','card');preview.append(el('p','caption primary-text',info.previewCaption),el('h2','',app.name),el('p','',info.previewText));p.append(preview,el('h2','','このアプリについて'),el('p','muted',app.description),el('p','caption muted',`v${app.versionName} · 配布: ${app.publisher}`));const actions=el('div','actions');const state=appState(app);if(state==='unavailable')actions.append(el('p','muted','この端末向けの配布物はありません。'));else actions.append(button(state==='installed'?`${app.name} を開く`:state==='update'?'更新内容を確認':'追加内容を確認',()=>state==='installed'?openApp(app):navigate('review')));p.append(actions);}
async function updateOnline(){try{const bytes=await online.download('catalog');const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));const savedFloor=Number(localStorage.getItem('itonami.catalog.highest.v1')||1);if(!Number.isSafeInteger(savedFloor)||savedFloor<1)throw Error('保存済みのカタログ履歴を確認できません。データは保持しています。');const floor=Math.max(catalog?.revision||1,savedFloor);const value=await authenticateCatalog(envelope,window.ItonamiPublicKey,domain,floor);if(host&&host.admitOnlineCatalog(envelope.raw,envelope.signature)!=='ok')throw Error('端末でカタログを検証できません。');onlineEnvelope=envelope;catalog=value;if(!host)localStorage.setItem('itonami.catalog.envelope.v1',JSON.stringify(envelope));localStorage.setItem('itonami.catalog.highest.v1',String(value.revision));render();notify('署名済みオンラインカタログを確認しました。');}catch(error){notify('取得を完了できません。'+error.message,true);}}
async function prepareAddition(app){try{if(host&&native.catalogOnline&&!host.hasOnlineApk(app.id)){const artifact=app.artifacts.find(a=>a.platform==='android');if(!online||!artifact||artifact.sha256!==window.ItonamiOnlinePins?.apks?.[app.id]?.sha256)throw Error('このアプリはオンライン配信の固定対象ではありません。');const bytes=await online.download(app.id);let raw='';for(let start=0;start<bytes.length;start+=16384)raw+=String.fromCharCode(...bytes.subarray(start,start+16384));if(host.stageOnlineApk(app.id,btoa(raw))!=='ok')throw Error('端末でファイルを検証できません。');}host.prepareInstall(app.id);}catch(error){notify('追加を停止しました。'+error.message);}}
function review(){const app=currentApp(),p=page('追加する前に',()=>navigate('detail'));if(!app)return;const info=presentation(app),viaOnline=onlineEnvelope||native.catalogOnline;const card=el('section','card review');card.append(el('h2','',`${app.name} を追加しますか？`));const data=el('dl');for(const [k,v]of [['配布元',app.publisher],['取得先',viaOnline?'GitHub / 固定リビジョン':'この Store に同梱'],['送る情報',viaOnline?info.sendsOnline:info.sends],['取得するもの',`${app.name} v${app.versionName}`],['許可の範囲','今回の端末への追加1回']])data.append(el('dt','',k),el('dd','',v));card.append(data,el('p','muted',info.note));p.append(card);const a=el('div','actions');a.append(button('今回の追加を確認',()=>{if(host){prepareAddition(app);}else{const values=readLocal('itonami.store.enabled.v1',{});values[app.id]=app.versionCode;writeLocal('itonami.store.enabled.v1',values);navigate('library');notify('同梱のブラウザ版を有効にしました。');}}),button('今は追加しない',()=>navigate('detail'),'button tonal'));p.append(a);}
function library(updates=false){const p=page(updates?'アプリの更新':'ライブラリ');const apps=storeApps();if(updates){p.append(el('p','muted','更新は、内容を確かめてから。'));const pending=apps.filter(a=>appState(a)==='update');for(const app of pending)p.append(appRow(app,`v${app.versionName} に更新できます`,()=>choose(app)),el('p','',presentation(app).updateNote),button('更新内容を確認',()=>choose(app,'review')));if(!pending.length)p.append(el('p','empty muted','現在、追加済みアプリの更新はありません。'));}else{const added=apps.filter(a=>['installed','update'].includes(appState(a)));for(const app of added){p.append(appRow(app,`追加済み · v${installedVersion(app)}`,()=>choose(app)),button(`${app.name} を開く`,()=>openApp(app)));if(presentation(app).libraryNote)p.append(el('p','muted',presentation(app).libraryNote));}if(!added.length)p.append(el('p','empty muted','追加したアプリがここに表示されます。'),button('アプリを見つける',()=>navigate('discover')));}nav(p,updates?'updates':'library');}
function saveEvents(events){writeLocal('itonami.yotei.events.v1',events);if(host&&mode==='yotei')host.persistEvents(JSON.stringify(events));}
function yotei(){const p=page('Yotei',mode==='yotei'?null:()=>navigate('library'));p.append(el('p','muted','予定を、手元に。'),button('予定を追加',()=>eventForm()));const events=readLocal('itonami.yotei.events.v1',[]);const list=el('ul','events');for(const event of events){const li=el('li','event');li.append(el('p','label primary-text',new Intl.DateTimeFormat('ja-JP',{dateStyle:'medium',timeStyle:'short'}).format(new Date(event.at))),el('h2','',event.title),button('予定を削除',()=>{const d=document.createElement('dialog');d.append(el('h2','','この予定を削除しますか？'),button('削除',()=>{saveEvents(events.filter(x=>x.id!==event.id));d.close();d.remove();render();},'button danger'),button('残す',()=>{d.close();d.remove();},'button tonal'));document.body.append(d);d.showModal();},'button text'));list.append(li);}if(!events.length)p.append(el('p','empty muted','まだ予定はありません。追加した予定はこの端末に保存されます。'));p.append(list,el('p','caption muted','通知の配信・外部同期は、この版では行いません。'));}
function eventForm(){const d=document.createElement('dialog'),f=el('form');f.method='dialog';const heading=el('h2','','予定を追加');f.append(heading);const title=el('input');title.id='event-title';title.name='title';title.required=true;title.maxLength=160;const tf=el('div','field'),tl=el('label','','予定の名前');tl.htmlFor=title.id;tf.append(tl,title);const date=el('input');date.type='datetime-local';date.id='event-date';date.name='date';date.required=true;date.value=new Date(Date.now()+3600000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);const df=el('div','field'),dl=el('label','','日時');dl.htmlFor=date.id;df.append(dl,date);const submit=el('button','button','保存');submit.type='submit';f.append(tf,df,submit,button('キャンセル',()=>{d.close();d.remove();},'button tonal'));f.addEventListener('submit',e=>{e.preventDefault();if(!f.reportValidity())return;const entry={id:crypto.randomUUID(),title:title.value.trim(),at:new Date(date.value).getTime()};const result=JSON.parse(domain.saveEvent(JSON.stringify(readLocal('itonami.yotei.events.v1',[])),JSON.stringify(entry)));if(result.error){notify('予定の名前と日時を確認してください。');return;}try{saveEvents(result.events);d.close();d.remove();render();notify('予定を保存しました。');}catch{notify('保存できませんでした。元の予定は保持しています。');}});d.append(f);d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();title.focus();}
const setup = createSetup({host,domain,root,button,el,icon,notify,render:()=>render()});
function render(){refresh();syncMotion();root.replaceChildren();if(mode==='home'&&setup.render())return;if(mode==='store'&&!domain.validCatalog(JSON.stringify(catalog),Math.floor(Date.now()/1000))){const p=page('追加を停止しました');p.append(el('p','','カタログの有効期限または内容を確認できません。署名済みの Store を更新してください。'));return;}({home,apps:drawer,discover,detail,review,library,updates:()=>library(true),yotei,torihiki:()=>renderTorihiki({root,page,el,button,notify,client:torihikiClient,state:torihikiState})}[route]||discover)();}
window.awaiRefresh=()=>{try{render();if(native.message)notify(native.message);}catch{notify('表示を更新できません。端末の戻る操作でやり直してください。');}};
window.awaiGoHome=()=>navigate('home');
window.awaiBack=()=>{if(mode==='home'&&setup.back())return true;const dialog=document.querySelector('dialog[open]');if(dialog){dialog.close();return true;}if(route==='home'||(mode==='store'&&route==='discover')||(mode==='yotei'&&route==='yotei')||(mode==='torihiki'&&route==='torihiki'))return false;navigate(mode==='home'?'home':mode==='yotei'?'yotei':mode==='torihiki'?'torihiki':'discover');return true;};
async function bootstrap(){
  if(!host){
    try{
      const stored=localStorage.getItem('itonami.catalog.envelope.v1');
      const envelope=stored?JSON.parse(stored):{raw:window.ItonamiCatalogRaw,signature:window.ItonamiCatalogSignature};
      const floor=Number(localStorage.getItem('itonami.catalog.highest.v1')||1);
      catalog=await authenticateCatalog(envelope,window.ItonamiPublicKey,domain,floor);
      if(stored)onlineEnvelope=envelope;
    }catch{catalog={};}
  }
  render();
}
bootstrap();setInterval(()=>{if(route==='home'){const c=root.querySelector('.clock');if(c)c.textContent=new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());}},15000);
