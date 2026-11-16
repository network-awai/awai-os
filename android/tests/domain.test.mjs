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
