import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const context=vm.createContext({window:{},console});
vm.runInContext(readFileSync(new URL('../client/generated/domain.js',import.meta.url),'utf8'),context);
const d=context.window.ItonamiDomain;
const apk={platform:'android',runtime:'android',kind:'apk',asset:'packages/yotei.apk',bytes:100,sha256:'a'.repeat(64),signerSha256:'b'.repeat(64)};
const app={id:'network.itonami.yotei',name:'Yotei',versionName:'0.1.0',versionCode:2,artifacts:[apk]};
const c={schema:d.schema,revision:1,expiresAt:200,apps:[app]};
test('compiled shared schema and exact platform decisions',()=>{
  assert.equal(d.validCatalog(JSON.stringify(c),100),true);
  assert.equal(d.validCatalog(JSON.stringify(c),200),false);
  assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,app]}),100),false);
  assert.equal(d.appState(JSON.stringify(app),'android','android',null),'available');
  assert.equal(d.appState(JSON.stringify(app),'android','android',1),'update');
  assert.equal(d.appState(JSON.stringify(app),'android','android',3),'installed');
  assert.equal(d.appState(JSON.stringify(app),'nixos','browser',null),'unavailable');
});
test('untrusted paths and signer fields are refused by actual browser core',()=>{
  for(const asset of ['../yotei.apk','https://example.com/yotei.apk','packages/../../x.apk']){
    const bad={...app,artifacts:[{...apk,asset}]};
    assert.equal(d.appState(JSON.stringify(bad),'android','android',null),'unavailable');
  }
});
test('multi-app catalog admits a Tauri-sized artifact within the shared ceiling',()=>{
  const big={...apk,asset:'packages/itonami.apk',bytes:32644749};
  const second={...app,id:'network.itonami.app',artifacts:[big]};
  assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,second]}),100),true);
  const over={...app,artifacts:[{...apk,bytes:64*1024*1024+1}]};
  assert.equal(d.validCatalog(JSON.stringify({...c,apps:[over]}),100),false);
});
test('the Torihiki Bot Tauri artifact fits the shared ceiling and keeps its own asset name',()=>{
  const bot={...app,id:'network.itonami.torihiki.bot',versionCode:1000,artifacts:[{...apk,asset:'packages/torihiki-bot.apk',bytes:29506324}]};
  assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,bot]}),100),true);
  for(const asset of ['packages/torihiki.bot.apk','packages/Torihiki-Bot.apk','packages/torihiki-bot.apk/../x.apk']){
    const bad={...bot,artifacts:[{...apk,asset,bytes:29506324}]};
    assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,bad]}),100),false,asset);
  }
});
test('the Tabi Mikake Tauri artifact fits the shared ceiling and keeps its own asset name',()=>{
  const tabi={...app,id:'network.itonami.tabimikake',versionCode:1000,artifacts:[{...apk,asset:'packages/tabi-mikake.apk',bytes:29621276}]};
  assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,tabi]}),100),true);
  for(const asset of ['packages/tabi_mikake.apk','packages/Tabi-Mikake.apk','packages/tabi-mikake.apk/../x.apk']){
    const bad={...tabi,artifacts:[{...apk,asset,bytes:29621276}]};
    assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,bad]}),100),false,asset);
  }
});
test('the Deai Tauri artifact fits the shared ceiling and keeps its own asset name',()=>{
  const deai={...app,id:'network.itonami.deai',versionCode:1000,artifacts:[{...apk,asset:'packages/deai.apk',bytes:30*1024*1024}]};
  assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,deai]}),100),true);
  for(const asset of ['packages/Deai.apk','packages/deai.apk/../x.apk','packages/deai.APK']){
    const bad={...deai,artifacts:[{...apk,asset,bytes:30*1024*1024}]};
    assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,bad]}),100),false,asset);
  }
});
test('the Hiring Tauri artifact fits the shared ceiling and keeps its own asset name',()=>{
  const hiring={...app,id:'network.itonami.hiring',versionCode:1000,artifacts:[{...apk,asset:'packages/hiring.apk',bytes:20583441}]};
  assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,hiring]}),100),true);
  for(const asset of ['packages/Hiring.apk','packages/hiring_.apk','packages/hiring.apk/../x.apk']){
    const bad={...hiring,artifacts:[{...apk,asset,bytes:20583441}]};
    assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,bad]}),100),false,asset);
  }
});
test('the Kumade Tauri artifact fits the shared ceiling and keeps its own asset name',()=>{
  const kumade={...app,id:'network.itonami.kumade',versionCode:1000,artifacts:[{...apk,asset:'packages/kumade.apk',bytes:21000000}]};
  assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,kumade]}),100),true);
  for(const asset of ['packages/Kumade.apk','packages/kumade_.apk','packages/kumade.apk/../x.apk']){
    const bad={...kumade,artifacts:[{...apk,asset,bytes:21000000}]};
    assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,bad]}),100),false,asset);
  }
});
test('an AWAI-3502 local Tauri app fits the shared ceiling under its own asset name',()=>{
  const local={...app,id:'network.itonami.icc',versionCode:1000,artifacts:[{...apk,asset:'packages/icc.apk',bytes:20*1024*1024}]};
  assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,local]}),100),true);
  for(const asset of ['packages/ICC.apk','packages/icc.apk/../x.apk','packages/icc.APK']){
    const bad={...local,artifacts:[{...apk,asset,bytes:20*1024*1024}]};
    assert.equal(d.validCatalog(JSON.stringify({...c,apps:[app,bad]}),100),false,asset);
  }
});
test('local event lifecycle is shared and bounded',()=>{
  const e={id:'1',title:'散歩 <img src=x onerror=alert(1)>',at:200};
  const saved=JSON.parse(d.saveEvent('[]',JSON.stringify(e)));
  assert.equal(saved.events[0].title,e.title);
  assert.equal(d.nextEvent(JSON.stringify(saved.events),100).title,e.title);
  assert.equal(d.nextEvent(JSON.stringify(saved.events),300),null);
  assert.equal(JSON.parse(d.saveEvent('[]',JSON.stringify({...e,title:''}))).error,'invalid-event');
  const many=Array.from({length:200},(_,n)=>({...e,id:String(n)}));
  assert.equal(JSON.parse(d.saveEvent(JSON.stringify(many),JSON.stringify({...e,id:'new'}))).error,'event-limit');
});

test('only the matching offline preview artifact admits a dual-ABI APK',()=>{
 const artifact={...apk,asset:'packages/itonami-preview.apk',bytes:120*1024*1024};
 const candidate={...app,id:'network.itonami.client.preview',artifacts:[artifact]};
 assert.equal(d.appState(JSON.stringify(candidate),'android','android',null),'available');
 assert.equal(d.appState(JSON.stringify({...candidate,id:'network.itonami.app'}),'android','android',null),'unavailable');
 assert.equal(d.appState(JSON.stringify({...candidate,artifacts:[{...artifact,asset:'packages/itonami.apk'}]}),'android','android',null),'unavailable');
 for(const bytes of [0,268435457,1.5])assert.equal(d.appState(JSON.stringify({...candidate,artifacts:[{...artifact,bytes}]}),'android','android',null),'unavailable');
});
