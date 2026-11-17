#!/usr/bin/env node
// Release-bundle screen test in an isolated, test-owned Chrome profile.
// Only a loopback TLS fixture relay may be approved. Never connects an account.
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { createHash } from 'node:crypto';

const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
if(!args.includes('--dist')||!args.includes('--output')||!process.env.OTEHON_BROWSER)throw Error('Set OTEHON_BROWSER; use --dist DIR --output NEW_DIR');
const dist=resolve(arg('--dist')),output=resolve(arg('--output'));await mkdir(output,{mode:0o700});
const profile=join(output,'profile');await mkdir(profile,{mode:0o700});
const key=join(output,'fixture.key'),cert=join(output,'fixture.crt');
const ssl=(a,input)=>{const r=spawnSync('openssl',a,{input,maxBuffer:1024*1024});if(r.status!==0)throw Error('fixture TLS setup failed');return r.stdout;};
ssl(['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',key,'-out',cert]);
const {chmod}=await import('node:fs/promises');await chmod(key,0o600);
const spki=createHash('sha256').update(ssl(['pkey','-pubin','-outform','DER'],ssl(['x509','-in',cert,'-pubkey','-noout']))).digest('base64');
const streams=new Set();let subscriptions=0,forbiddenWrites=0;
const relay=httpsServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{
 const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type','cache-control':'no-store'};
 if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return;}
 if(req.method!=='GET'||!/^\/[0-9a-f]{32}\/json$/.test(req.url)){forbiddenWrites++;res.writeHead(405,headers);res.end();return;}
 subscriptions++;streams.add(res);res.on('close',()=>streams.delete(res));res.writeHead(200,{...headers,'content-type':'application/x-ndjson'});res.write('{"event":"open"}\n');
});
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));await listen(relay);
const relayOrigin=`https://localhost:${relay.address().port}`;
const html=(await readFile(join(dist,'index.html'),'utf8')).replaceAll('https://relay.awai.network',relayOrigin);
const site=httpServer(async(req,res)=>{
 try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 if(!/^\/assets\/[A-Za-z0-9._-]+$/.test(path)){res.writeHead(404);res.end();return;}
 const mime={'.js':'text/javascript','.css':'text/css','.png':'image/png'};
 res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.end(await readFile(join(dist,path)));
 }catch{res.writeHead(404);res.end();}
});await listen(site);const origin=`http://127.0.0.1:${site.address().port}`;
const browserArgs=['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--ignore-certificate-errors-spki-list=${spki}`,...(process.env.OTEHON_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),origin];
const chrome=spawn(process.env.OTEHON_BROWSER,browserArgs,{stdio:['ignore','ignore','ignore']});
let ws,proof={fixtureOnly:true,accountConnected:false,steps:[],exceptions:[]};let pending=new Map(),seq=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(read,label,ms=10000){const end=Date.now()+ms;while(Date.now()<end){const v=await read();if(v)return v;await sleep(100);}throw Error(label);}
const call=(method,params={})=>new Promise((r,j)=>{const id=++seq;pending.set(id,{r,j});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))j(Error('cdp-timeout'));},10000).unref();});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error('evaluation-error');return r.result?.value;};
async function click(selector){const box=await until(()=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`),'missing-control');await call('Input.dispatchMouseEvent',{type:'mousePressed',...box,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...box,button:'left',clickCount:1});}
async function checkpoint(name){proof.steps.push(name);const image=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(output,name+'.png'),Buffer.from(image.data,'base64'),{mode:0o600});}
try{
 const port=await until(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{return null;}},'browser-start',30000);
 const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const page=tabs.find(t=>t.type==='page'&&new URL(t.url).origin===origin);if(!page)throw Error('fixture-page-missing');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.j(Error('cdp-error')):p.r(m.result);}if(m.method==='Runtime.exceptionThrown'){const name=m.params.exceptionDetails.exception?.className;proof.exceptions.push(['TypeError','Error','ReferenceError'].includes(name)?name:'other');}};
 await call('Runtime.enable');await until(()=>evaluate('!!document.querySelector(".setup-card button.primary")'),'hello');
 await click('.setup-card button.primary');await click('[data-language=ja]');await click('[data-next]');await click('[data-next]');
 await click('#local-start');await until(()=>evaluate('!!document.querySelector("#local-address")'),'wallet-form');await checkpoint('wallet-form');
 await click('[data-network-back]');await until(()=>evaluate('document.querySelector(".setup")?.dataset.step==="network"'),'wallet-back');
 await click('[data-next]');await click('#link-start');
 await until(()=>evaluate('!!document.querySelector("dialog[open]")'),'fixture-consent');
 const scope=await evaluate('document.querySelector("dialog[open]")?.textContent');
 if(!scope.includes(relayOrigin)||scope.includes('https://relay.awai.network'))throw Error('refusing-nonfixture-approval');
 await sleep(750);await click('dialog[open] button:last-of-type');
 await until(()=>evaluate('!!document.querySelector("svg[data-link-url] path[d]")'),'qr-render');
 await sleep(500);if(proof.exceptions.length)throw Error('uncaught-browser-exception');await checkpoint('phone-qr');
 await click('[data-network-back]');await until(()=>evaluate('document.querySelector(".setup")?.dataset.step==="network"'),'phone-back');await checkpoint('network-return');
 if(subscriptions!==1||forbiddenWrites!==0)throw Error('unexpected-fixture-traffic');
 proof.success=true;
}catch(error){proof.success=false;proof.failure=error.message;process.exitCode=1;}
finally{
 proof.subscriptions=subscriptions;proof.forbiddenWrites=forbiddenWrites;proof.bundleSha256=createHash('sha256').update(await readFile(join(dist,'assets/main.js'))).digest('hex');
 await writeFile(join(output,'proof.json'),JSON.stringify(proof,null,2),{mode:0o600});console.log(JSON.stringify(proof));ws?.close();chrome.kill('SIGTERM');for(const res of streams)res.destroy();site.closeAllConnections();relay.closeAllConnections();site.close();relay.close();
}

// Bound shutdown even if a test-owned streaming TLS socket retains a handle.
// Proof is already flushed. Only this isolated browser child is signalled.
setTimeout(()=>{chrome.kill('SIGKILL');process.exit(process.exitCode??0);},1000).unref();
