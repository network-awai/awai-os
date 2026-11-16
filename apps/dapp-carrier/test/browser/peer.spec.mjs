import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
const peer='12D3KooWJxXy9juQKbQW8wSCuW7oGiNTJWmfg3ZkCqfaRoiLBM4P';
const cid='bafyreifxwjkaji62sdkwexji2cwtqqzqtim4yusgmc33zal2kbemqxdtja';
async function nativeFixture(page,storageKind="app-private"){await page.addInitScript((storageKind)=>{
 window.peerCalls=[];window.sessionFixture=[];
 window.__TAURI__={core:{invoke:async(command,args)=>{
  window.peerCalls.push({command,args});
  if(command==='awai_host_info')return {schema:'awai.shell.host.v1'};
  if(command==='peer_host_info')return {schema:'awai.shell.peer.v1',peerId:'local-fixture',storageKind};
  if(command==='peer_sessions')return window.sessionFixture;
  if(command==='peer_reserve')return 'fixture-operation';
  if(command==='peer_snapshot_execute'){if(args.endpoint.action==='receive-snapshot'){window.sessionFixture=[{id:'fixture-session',state:'receiving',until:Math.floor(Date.now()/1000)+600}];return {sessionId:'fixture-session',state:'receiving',until:window.sessionFixture[0].until};}return {snapshot:args.endpoint.scope['snapshot-cid'],verified:true};}if(command==='peer_stop'){window.sessionFixture=[];return;}
 }}};
 },storageKind);}
test('canonical scope is visible and denial dispatches no native transfer',async({page})=>{
 await nativeFixture(page);await page.goto('/yataverse/');await expect(page.locator('#awai-local-peer')).toHaveText('local-fixture');
 await page.locator('#awai-snapshot').fill(cid);await page.locator('#awai-address').fill(`/ip4/127.0.0.1/tcp/40213/p2p/${peer}`);
 await page.getByRole('button',{name:'Review send',exact:true}).click();await expect(page.getByRole('dialog')).toContainText(cid);
 await page.getByRole('button',{name:'Deny',exact:true}).click();await expect(page.locator('#awai-peer-status')).toHaveText('Operation was denied');
 expect(await page.evaluate(()=>window.peerCalls.filter(c=>['peer_reserve','peer_snapshot_execute'].includes(c.command)))).toEqual([]);
 await page.getByRole('button',{name:'Review send',exact:true}).click();const allow=page.getByRole('button',{name:'Allow once',exact:true});await expect(allow).toBeEnabled();await allow.click();
 await expect(page.locator('#awai-peer-status')).toHaveText('Sent and retention verified');
 const calls=await page.evaluate(()=>window.peerCalls.filter(c=>['peer_reserve','peer_snapshot_execute','peer_cancel'].includes(c.command)));expect(calls.map(c=>c.command)).toEqual(['peer_reserve','peer_snapshot_execute','peer_cancel']);expect(calls[1].args.endpoint.scope).toEqual({'snapshot-cid':cid,'max-transfer-bytes':16777216});
});
test('phone layout and identifier input preserve keyboard and wrapping',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'ja-JP'});const page=await context.newPage();await nativeFixture(page);await page.goto('/yataverse/');await page.locator('#awai-snapshot').fill(cid);
 expect(await page.locator('#awai-snapshot').getAttribute('autocapitalize')).toBe('none');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const output=fileURLToPath(new URL('../../../../.agent-output/',import.meta.url));await mkdir(output,{recursive:true});await page.screenshot({path:output+'dapp-peer-phone.png',fullPage:true});await context.close();
});
test('all five profiles load offline without external requests',async({browser})=>{
 for(const key of ['aozora','dougaka','ongakuka','itonami','yataverse']){
  const context=await browser.newContext();const page=await context.newPage();const external=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!=='http://127.0.0.1:4179'){external.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto('/'+key+'/');await expect(page.locator('#awai-peer-panel')).toBeAttached();if(key==='aozora')await expect(page.locator('#peer-help')).not.toBeEmpty();if(key==='dougaka')await expect(page.locator('#studio-model option')).not.toHaveCount(0);expect(external).toEqual([]);expect(errors).toEqual([]);await context.close();
 }
});

test('receive read-back is a separate choice and Stop closes the named session',async({page})=>{
 await nativeFixture(page);await page.goto('/yataverse/');await expect(page.locator('#awai-local-peer')).toHaveText('local-fixture');
 await page.locator('#awai-snapshot').fill(cid);await page.getByText('Connection and receive details',{exact:true}).click();await page.locator('#awai-source-peer').fill(peer);
 await expect(page.locator('#awai-read-back')).not.toBeChecked();await page.getByRole('button',{name:'Start receiving',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('"allow-read-back":false');await page.getByRole('button',{name:'Deny',exact:true}).click();
 expect(await page.evaluate(()=>window.peerCalls.filter(c=>['peer_reserve','peer_snapshot_execute'].includes(c.command)))).toEqual([]);
 await page.locator('#awai-read-back').check();await page.getByRole('button',{name:'Start receiving',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('"allow-read-back":true');
 const allow=page.getByRole('button',{name:'Allow once',exact:true});await expect(allow).toBeEnabled();await allow.click();await expect(page.locator('#awai-session-status')).toContainText('Receiving');
 await page.getByRole('button',{name:'Stop receiving',exact:true}).click();await expect(page.locator('#awai-session-status')).toHaveText('Not receiving');
 const stop=await page.evaluate(()=>window.peerCalls.find(c=>c.command==='peer_stop'));expect(stop.args).toEqual({sessionId:'fixture-session'});
});

test('known temporary native storage is visible before using a snapshot',async({browser})=>{
 const context=await browser.newContext({locale:'ja-JP',viewport:{width:390,height:844}});const page=await context.newPage();await nativeFixture(page,'temporary');await page.goto('/yataverse/');await expect(page.getByRole('note')).toContainText('再起動すると');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/aozora/');await expect(page.locator('body > .awai-storage-notice')).toBeVisible();await page.locator('#awai-open-peer').click();await expect(page.getByRole('dialog').getByRole('note')).toContainText('失われます');await context.close();
});
