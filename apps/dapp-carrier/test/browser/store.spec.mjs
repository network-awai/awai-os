import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const repo=new URL('../../../../',import.meta.url);
const ids=['network.itonami.yotei','app.aozora.awai.preview','network.itonami.dougaka.preview','network.itonami.ongakuka.preview','network.itonami.client.preview','network.itonami.yataverse.preview'];
const names=['Yotei','Aozora','Dougaka','Ongakuka','Itonami','Yataverse'];
const keys=['yotei','aozora','dougaka','ongakuka','itonami','yataverse'];
const catalog={schema:'itonami.store.bundled.v1',revision:1001,expiresAt:4102444800,apps:ids.map((id,i)=>({id,name:names[i],description:i===0?'この端末の予定':'選んだ Peer との接続プレビュー',publisher:'Awai fixture',versionCode:1000,versionName:'0.1.0',artifacts:[{platform:'android',runtime:'android',kind:'apk',asset:`packages/${keys[i]}.apk`,bytes:i===0?1000:120*1024*1024,sha256:'a'.repeat(64),signerSha256:'b'.repeat(64)}]}))};
async function fixture(page,installed={}){
 await page.addInitScript(({catalog,installed})=>{window.installCalls=[];window.launchCalls=[];window.AwaiHost={snapshot:()=>JSON.stringify({mode:'store',platform:'android',runtime:'android',installed,apps:[],agenda:[]}),catalog:()=>JSON.stringify(catalog),prepareInstall:id=>window.installCalls.push(id),launch:id=>window.launchCalls.push(id)};},{catalog,installed});
 const files={'index.html':'android/client/index.html','client.js':'android/client/client.js','client.css':'android/client/client.css','domain.js':'android/client/generated/domain.js','runtime.js':'nixos/otehon/shell/vendor/kotoba-client-runtime.js','runtime-consent.css':'nixos/otehon/shell/vendor/kotoba-client-consent.css'};
 await page.route('**/store/**',async route=>{
  const path=new URL(route.request().url()).pathname.slice('/store/'.length)||'index.html';
  if(path==='catalog-data.js')return route.fulfill({contentType:'text/javascript',body:'window.ItonamiCatalog={apps:[]};'});
  if(path==='online-data.js')return route.fulfill({contentType:'text/javascript',body:'window.ItonamiOnlinePins=null;'});
  if(path==='online.js')return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('android/client/online.js',repo),'utf8')});
  if(path==='tokens.css')return route.fulfill({contentType:'text/css',body:':root{--background:#fff;--surface:#f5f6f8;--text:#182332;--primary:#1e50a2}'});
  const file=files[path]||(path.startsWith('assets/')&&!path.includes('..')?'android/client/'+path:null);
  if(!file)return route.abort();try{return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.png')?'image/png':'text/html',body:await readFile(new URL(file,repo))});}catch{return route.abort();}
 });await page.goto('/store/');
}
test('six-app Store selects exact package, cancellation installs nothing',async({page})=>{
 await fixture(page);await expect(page.locator('.app-row')).toHaveCount(6);
 await page.locator('.app-row').filter({hasText:'Aozora'}).click();await expect(page.locator('h2').first()).toHaveText('Aozora');
 await page.getByRole('button',{name:'追加内容を確認',exact:true}).click();await expect(page.locator('dl')).toContainText('Aozora v0.1.0');await expect(page.locator('dl')).not.toContainText('Yotei v');
 await page.getByRole('button',{name:'今は追加しない',exact:true}).click();expect(await page.evaluate(()=>window.installCalls)).toEqual([]);
 await page.getByRole('button',{name:'追加内容を確認',exact:true}).click();await page.getByRole('button',{name:'今回の追加を確認',exact:true}).click();expect(await page.evaluate(()=>window.installCalls)).toEqual([ids[1]]);
});
test('library and connection filter keep per-app identity',async({page})=>{
 await fixture(page,{[ids[1]]:1000,[ids[5]]:1000});await page.getByRole('button',{name:'つながる',exact:true}).click();await expect(page.locator('.app-row')).toHaveCount(5);
 await page.getByRole('button',{name:'ライブラリ',exact:true}).click();await expect(page.locator('.app-row')).toHaveCount(2);await page.getByRole('button',{name:'Yataverse を開く',exact:true}).click();expect(await page.evaluate(()=>window.launchCalls)).toEqual([ids[5]]);
});
