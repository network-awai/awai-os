// Local-only HTTPS/manifest tests. Run in a Nix shell with node, openssl, minisign, jq and curl.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
const output = resolve(process.argv[2]);
mkdirSync(output, {recursive:true});
const tmp = mkdtempSync(join(output, 'update-https-'));
const fixtures = resolve('nixos/otehon/fixtures/update');
const run = (p,a) => {const r=spawnSync(p,a,{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr}`);};
run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',join(tmp,'key.pem'),'-out',join(tmp,'cert.pem')]);
const manifest=join(tmp,'manifest.json'), sig=join(tmp,'manifest.json.minisig');
writeFileSync(manifest,JSON.stringify({version:2,system:`/nix/store/${'a'.repeat(32)}-test`}));
run('minisign',['-S','-q','-W','-s',join(fixtures,'test-manifest.key'),'-m',manifest,'-x',sig]);
const body=readFileSync(manifest), signature=readFileSync(sig);
let redirected=0, requests=0;
const server=createServer({key:readFileSync(join(tmp,'key.pem')),cert:readFileSync(join(tmp,'cert.pem'))},(req,res)=>{
 requests++;
 if(req.url.startsWith('/redirect/')) {res.writeHead(302,{location:'/escaped'}).end();return;}
 if(req.url==='/escaped'){redirected++;res.writeHead(200).end('unexpected');return;}
 if(req.url.startsWith('/oversized/')){res.writeHead(200).end(Buffer.alloc(65537, 65));return;}
 if(req.url.endsWith('/manifest.json.minisig')){res.writeHead(200).end(signature);return;}
 if(req.url.endsWith('/manifest.json')){res.writeHead(200).end(req.url.startsWith('/tampered/') ? Buffer.from('{"version":3}') : body);return;}
 res.writeHead(404).end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const env={...process.env,OTEHON_UPDATE_BASE_VERSION:'1',OTEHON_UPDATE_PUBLIC_KEY:join(fixtures,'test-manifest.pub'),OTEHON_UPDATE_CACHE_KEY:join(fixtures,'test-cache.pub'),OTEHON_UPDATE_FEED:'none',CURL_CA_BUNDLE:join(tmp,'cert.pem')};
async function execute(url,extra={},action='check-https'){return await new Promise((ok,no)=>{const p=spawn('bash',['nixos/otehon/update.sh',action,url],{env:{...env,...extra}});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',no);p.on('close',code=>ok({code,out,err}));});}
async function localCheck(){return await new Promise((ok,no)=>{const p=spawn('bash',['nixos/otehon/update.sh','check',tmp],{env});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',no);p.on('close',code=>ok({code,out,err}));});}
try {
 const esp=join(tmp,'esp'); mkdirSync(esp);
 let espCheck=spawnSync('bash',['nixos/otehon/update.sh','check-esp',esp],{env,encoding:'utf8'});
 assert.equal(espCheck.status,0,espCheck.stderr);
 for (const name of ['other.efi','other.EFI','other.eFi']) {
   const file=join(esp,name); writeFileSync(file,'unrelated boot entry');
   espCheck=spawnSync('bash',['nixos/otehon/update.sh','check-esp',esp],{env,encoding:'utf8'});
   assert.equal(espCheck.status,2); assert.match(espCheck.stdout,/REFUSED unmanaged-uki/);
   assert.equal(readFileSync(file,'utf8'),'unrelated boot entry');
   unlinkSync(file);
 }
 const own=join(esp,'awai-owned.efi'), marker=join(tmp,'initial-uki.sha256');
 writeFileSync(own,'owned image');
 writeFileSync(marker,`${createHash('sha256').update('owned image').digest('hex')} awai-owned.efi\n`);
 espCheck=spawnSync('bash',['nixos/otehon/update.sh','check-esp',esp,marker],{env,encoding:'utf8'});
 assert.equal(espCheck.status,0,espCheck.stdout+espCheck.stderr);
 writeFileSync(own,'tampered image');
 espCheck=spawnSync('bash',['nixos/otehon/update.sh','check-esp',esp,marker],{env,encoding:'utf8'});
 assert.equal(espCheck.status,2); assert.equal(readFileSync(own,'utf8'),'tampered image');
 writeFileSync(own,'owned image'); writeFileSync(join(esp,'other.eFi'),'unrelated');
 espCheck=spawnSync('bash',['nixos/otehon/update.sh','check-esp',esp,marker],{env,encoding:'utf8'});
 assert.equal(espCheck.status,2); assert.equal(readFileSync(join(esp,'other.eFi'),'utf8'),'unrelated');
 const base=`https://localhost:${port}`;
 let r=await localCheck();assert.equal(r.code,0,r.err+r.out);assert.match(r.out,/^2 \/nix\/store\//);
 r=await execute(`${base}/good`);assert.equal(r.code,0,r.err+r.out);assert.match(r.out,/^2 \/nix\/store\//);
 r=await execute(`${base}/good`,{OTEHON_UPDATE_BASE_VERSION:'2'},'apply-https');assert.equal(r.code,3);assert.match(r.out,/REFUSED old-version 2/);
 r=await execute(`${base}/good`,{OTEHON_UPDATE_BASE_VERSION:'3'},'apply-https');assert.equal(r.code,2);assert.match(r.out,/REFUSED old-version 2/);
 r=await execute(`${base}/tampered`);assert.equal(r.code,2);assert.match(r.out,/REFUSED bad-signature/);
 r=await execute(`${base}/tampered`,{},'apply-https');assert.equal(r.code,2);assert.match(r.out,/REFUSED bad-signature/);
 r=await execute(`${base}/redirect`);assert.equal(r.code,2);assert.match(r.out,/REFUSED feed-http-status/);assert.equal(redirected,0);
 r=await execute(`${base}/good`,{CURL_CA_BUNDLE:join(tmp,'missing.pem')});assert.equal(r.code,2);assert.match(r.out,/REFUSED feed-unavailable/);
 r=await execute(`${base}/oversized`);assert.equal(r.code,2);assert.match(r.out,/REFUSED feed-unavailable/);
 const before=requests;
 for(const url of [`http://localhost:${port}/good`,`${base}/../good`,`${base}/good?token=x`,`https://user@localhost:${port}/good`,`${base}/good#fragment`]) {
   r=await execute(url);assert.equal(r.code,2);assert.match(r.out,/REFUSED bad-feed-url/);assert.equal(requests,before);
 }
 console.log('PASS: ESP ownership guard, local and signed HTTPS feeds, tamper, redirect, TLS, size, and invalid URL controls');
} finally {server.close();}
