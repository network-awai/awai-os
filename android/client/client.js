import './domain.js';
import './catalog-data.js';
import { clientRuntimeProblems, createClientOperationBroker, createClientConsentHost } from './runtime.js';

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
let route = mode === 'home' ? 'home' : mode === 'yotei' ? 'yotei' : 'discover';
let catalog = host ? JSON.parse(host.catalog()) : window.ItonamiCatalog;
let query = '';
let filter = 'おすすめ';
let statusTimer;
const paths = { search:'android-v2-icon-search.svg', apps:'android-v2-icon-apps.svg', camera:'android-v2-icon-camera.svg',
  phone:'android-v2-icon-phone.svg', settings:'android-v2-icon-settings.svg', store:'android-v2-icon-store.svg',
  calendar:'android-v2-icon-calendar.svg', chat:'android-v2-icon-chat.svg', cloud:'store-android-v2-icon-cloud.svg', download:'store-android-v2-icon-download.svg' };

function el(tag, cls, text) { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; }
function icon(name, feature=false) { const n=el('img','static-icon'); n.alt=''; n.src='assets/'+(feature&&name==='calendar'?'store-android-v2-icon-calendar.svg':paths[name]); n.width=feature?64:24; n.height=feature?64:24; return n; }
function button(label, action, cls='button') { const n=el('button',cls,label); n.type='button'; n.addEventListener('click',e=>{if(e.isTrusted)action(e);}); return n; }
function notify(text) { status.textContent=text; clearTimeout(statusTimer); statusTimer=setTimeout(()=>status.textContent='',6000); }
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
function home() {
  const p=el('section','page home');root.append(p);
  const date=el('p','date',new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'long'}).format(new Date()));
  const time=el('h1','clock',new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()));time.tabIndex=-1;p.append(date,time);
  const w=button('',openYotei,'card');const event=nextEvent();w.append(el('span','caption primary-text',event?'次の予定':'予定を、手元に。'),el('span','',event?`${new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(event.at))}  ${event.title}`:native.installed['network.itonami.yotei']?'まだ予定はありません':'Yotei を Store から追加できます'),el('span','caption muted',event?'あとで、自分のペースで。':'この端末に保存。外部には送信しません。'));p.append(w,el('div','space'));
  const apps=el('div','app-grid');apps.append(appButton('Store','store',()=>host?host.openStore():navigate('discover')),appButton(native.installed['network.itonami.yotei']?'Yotei':'Yotei を追加','calendar',openYotei),appButton('設定','settings',()=>host?host.openSettings():notify('Android の端末設定です。')),appButton('すべて','apps',()=>navigate('apps')));p.append(apps);
  const bottom=el('div','home-bottom');const dock=el('nav','app-grid dock');dock.setAttribute('aria-label','よく使うアプリ');dock.append(appButton('電話','phone',()=>launchCategory('phone')),appButton('ブラウザ','search',()=>launchCategory('browser')),appButton('カメラ','camera',()=>launchCategory('camera')),appButton('すべて','apps',()=>navigate('apps')));bottom.append(dock);
  const sb=button('',()=>navigate('apps'),'search-box home-search');sb.append(icon('search'),el('span','muted','この端末を検索'));bottom.append(sb);p.append(bottom);
  if(host&&!native.isDefaultHome){p.append(button('Awai をホームに設定',()=>host.chooseHome(),'button tonal'));}
  let sy; p.addEventListener('touchstart',e=>sy=e.changedTouches[0].clientY,{passive:true});p.addEventListener('touchend',e=>{if(sy-e.changedTouches[0].clientY>90&&!e.target.closest('button'))navigate('apps');},{passive:true});
}
function drawer(){const p=page('すべてのアプリ',()=>navigate('home'));let grid;search(p,'アプリを検索',q=>{query=q;fill();});grid=el('div','app-grid');p.append(grid);function fill(){grid.replaceChildren();for(const a of native.apps.filter(a=>a.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))){grid.append(appButton(a.label,'apps',()=>launch(a.id),a.icon));}if(!grid.children.length)grid.append(el('p','muted','一致するアプリはありません。'));}fill();}
function currentApp(){return catalog?.apps?.find(a=>a.id==='network.itonami.yotei');}
function installedVersion(app){return native.platform==='android'?native.installed[app.id]??null:readLocal('itonami.store.enabled.v1',{})[app.id]??null;}
function appState(app){return domain.appState(JSON.stringify(app),native.platform,native.runtime,installedVersion(app));}
function nav(parent,selected){parent.classList.add('with-nav');const n=el('nav','store-nav');n.setAttribute('aria-label','Store');for(const [key,label,name]of [['discover','見つける','store'],['library','ライブラリ','apps'],['updates','更新','download']]){const b=button('',()=>navigate(key),'nav-item');if(key===selected)b.setAttribute('aria-current','page');const i=el('span','nav-icon');i.append(icon(name));b.append(i,el('span','',label));n.append(b);}parent.append(n);}
function appRow(app,desc,action){const r=button('',action,'app-row');const box=el('span','icon-box');box.append(icon('calendar'));const copy=el('span','copy');copy.append(el('span','app-name',app.name),el('span','caption muted',desc));r.append(box,copy);return r;}
function discover(){const p=page('itonami Store');p.querySelector('header').prepend(icon('store'));let results;search(p,'アプリ・できることを検索',q=>{query=q;fill();});const chips=el('div','categories');for(const label of ['おすすめ','暮らし','つながる']){const c=button(label,()=>{filter=label;for(const s of chips.children)s.setAttribute('aria-pressed',String(s===c));fill();},'chip');c.setAttribute('aria-pressed',String(label===filter));chips.append(c);}p.append(chips);results=el('section','review');p.append(results);function fill(){results.replaceChildren();const app=currentApp();if(!app||filter==='つながる'||!`${app.name} ${app.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())){results.append(el('p','empty muted','現在、この条件で追加できるアプリはありません。'));return;}const feature=el('article','card primary');const h=el('div','feature-head');const cp=el('div','copy');cp.append(el('h2','',app.name),el('p','','予定を、手元に。'));h.append(icon('calendar',true),cp);feature.append(h,el('p','','大切な時間を、自分のペースで。予定の作成・表示はこの端末で。'),button('Yotei を見る',()=>navigate('detail')));results.append(feature,el('h2','label muted','この端末で使える'),appRow(app,`v${app.versionName} · ${appState(app)==='installed'?'追加済み':'同梱アプリ'}`,()=>navigate('detail')),el('p','caption muted','同梱カタログから追加できます。オンライン配信はまだ有効になっていません。'));}fill();nav(p,'discover');}
function detail(){const app=currentApp(),p=page('アプリの詳細',()=>navigate('discover'));const h=el('div','feature-head'),cp=el('div','copy');cp.append(el('h2','',app.name),el('p','muted','予定を、手元に。'));h.append(icon('calendar',true),cp);p.append(h,el('span','badge','端末内で使える'));
  const preview=el('section','card');preview.append(el('p','caption primary-text','予定を作成・表示'),el('h2','','Yotei'),el('p','','自分の予定を、この端末に保存します。'));p.append(preview,el('h2','','このアプリについて'),el('p','muted',app.description),el('p','caption muted',`v${app.versionName} · 配布: ${app.publisher}`));const actions=el('div','actions');const state=appState(app);actions.append(button(state==='installed'?'Yotei を開く':state==='update'?'更新内容を確認':'追加内容を確認',()=>state==='installed'?openYotei():navigate('review')));p.append(actions);}
function review(){const app=currentApp(),p=page('追加する前に',()=>navigate('detail'));const card=el('section','card review');card.append(el('h2','',`${app.name} を追加しますか？`));const data=el('dl');for(const [k,v]of [['配布元',app.publisher],['取得先','この Store に同梱'],['送る情報','外部への送信なし'],['取得するもの',`Yotei v${app.versionName}`],['許可の範囲','今回の端末への追加1回']])data.append(el('dt','',k),el('dd','',v));card.append(data,el('p','muted','予定・連絡先は送信しません。同期や遠隔推論の許可は含みません。'));p.append(card);const a=el('div','actions');a.append(button('今回の追加を確認',()=>{if(host){host.prepareInstall(app.id);}else{const values=readLocal('itonami.store.enabled.v1',{});values[app.id]=app.versionCode;writeLocal('itonami.store.enabled.v1',values);navigate('library');notify('同梱のブラウザ版を有効にしました。');}}),button('今は追加しない',()=>navigate('detail'),'button tonal'));p.append(a);}
function library(updates=false){const p=page(updates?'アプリの更新':'ライブラリ');const app=currentApp(),state=appState(app);if(updates){p.append(el('p','muted','更新は、内容を確かめてから。'));if(state==='update'){p.append(appRow(app,`v${app.versionName} に更新できます`,()=>navigate('detail')),el('p','','予定データを保持して更新します。新たな権限の追加はありません。'),button('更新内容を確認',()=>navigate('review')));}else p.append(el('p','empty muted','現在、追加済みアプリの更新はありません。'));}else if(state==='installed'||state==='update'){p.append(appRow(app,`追加済み · v${installedVersion(app)}`,()=>navigate('detail')),button('Yotei を開く',openYotei),el('p','muted','同期先は未設定です。予定は外部に送信されていません。'));}else p.append(el('p','empty muted','追加したアプリがここに表示されます。'),button('アプリを見つける',()=>navigate('discover')));nav(p,updates?'updates':'library');}
function saveEvents(events){writeLocal('itonami.yotei.events.v1',events);if(host&&mode==='yotei')host.persistEvents(JSON.stringify(events));}
function yotei(){const p=page('Yotei',mode==='yotei'?null:()=>navigate('library'));p.append(el('p','muted','予定を、手元に。'),button('予定を追加',()=>eventForm()));const events=readLocal('itonami.yotei.events.v1',[]);const list=el('ul','events');for(const event of events){const li=el('li','event');li.append(el('p','label primary-text',new Intl.DateTimeFormat('ja-JP',{dateStyle:'medium',timeStyle:'short'}).format(new Date(event.at))),el('h2','',event.title),button('予定を削除',()=>{const d=document.createElement('dialog');d.append(el('h2','','この予定を削除しますか？'),button('削除',()=>{saveEvents(events.filter(x=>x.id!==event.id));d.close();d.remove();render();},'button danger'),button('残す',()=>{d.close();d.remove();},'button tonal'));document.body.append(d);d.showModal();},'button text'));list.append(li);}if(!events.length)p.append(el('p','empty muted','まだ予定はありません。追加した予定はこの端末に保存されます。'));p.append(list,el('p','caption muted','通知の配信・外部同期は、この版では行いません。'));}
function eventForm(){const d=document.createElement('dialog'),f=el('form');f.method='dialog';const heading=el('h2','','予定を追加');f.append(heading);const title=el('input');title.id='event-title';title.name='title';title.required=true;title.maxLength=160;const tf=el('div','field'),tl=el('label','','予定の名前');tl.htmlFor=title.id;tf.append(tl,title);const date=el('input');date.type='datetime-local';date.id='event-date';date.name='date';date.required=true;date.value=new Date(Date.now()+3600000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);const df=el('div','field'),dl=el('label','','日時');dl.htmlFor=date.id;df.append(dl,date);const submit=el('button','button','保存');submit.type='submit';f.append(tf,df,submit,button('キャンセル',()=>{d.close();d.remove();},'button tonal'));f.addEventListener('submit',e=>{e.preventDefault();if(!f.reportValidity())return;const entry={id:crypto.randomUUID(),title:title.value.trim(),at:new Date(date.value).getTime()};const result=JSON.parse(domain.saveEvent(JSON.stringify(readLocal('itonami.yotei.events.v1',[])),JSON.stringify(entry)));if(result.error){notify('予定の名前と日時を確認してください。');return;}try{saveEvents(result.events);d.close();d.remove();render();notify('予定を保存しました。');}catch{notify('保存できませんでした。元の予定は保持しています。');}});d.append(f);d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();title.focus();}
function render(){refresh();root.replaceChildren();if(mode==='store'&&!domain.validCatalog(JSON.stringify(catalog),Math.floor(Date.now()/1000))){const p=page('追加を停止しました');p.append(el('p','','カタログの有効期限または内容を確認できません。署名済みの Store を更新してください。'));return;}({home,apps:drawer,discover,detail,review,library,updates:()=>library(true),yotei}[route]||discover)();}
window.awaiRefresh=()=>{try{render();if(native.message)notify(native.message);}catch{notify('表示を更新できません。端末の戻る操作でやり直してください。');}};
window.awaiGoHome=()=>navigate('home');
window.awaiBack=()=>{const dialog=document.querySelector('dialog[open]');if(dialog){dialog.close();return true;}if(route==='home'||(mode==='store'&&route==='discover')||(mode==='yotei'&&route==='yotei'))return false;navigate(mode==='home'?'home':mode==='yotei'?'yotei':'discover');return true;};
async function bootstrap(){
  if(!host){
    try{
      const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
      const key=await crypto.subtle.importKey('spki',bytes(window.ItonamiPublicKey),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
      if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(window.ItonamiCatalogSignature),new TextEncoder().encode(window.ItonamiCatalogRaw)))throw new Error('catalog-signature');
    }catch{catalog={};}
  }
  render();
}
bootstrap();setInterval(()=>{if(route==='home'){const c=root.querySelector('.clock');if(c)c.textContent=new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());}},15000);
