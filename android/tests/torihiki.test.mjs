import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const runtime=new URL('../../otehon/shell/vendor/kotoba-client-runtime.js',import.meta.url);
const text=readFileSync(new URL('../client/torihiki.js',import.meta.url),'utf8').replace("'./runtime.js'",JSON.stringify(runtime.href));
const t=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const {clientRuntimeProblems,clientEndpointAllowsRequest,clientRuntimeConnectSrc}=await import(runtime.href);
const ctx=vm.createContext({window:{}});vm.runInContext(readFileSync(new URL('../client/generated/domain.js',import.meta.url),'utf8'),ctx);
const domain=ctx.window.ItonamiDomain, app='https://appassets.androidplatform.net';

const vec=JSON.parse(readFileSync(new URL('./torihiki-vectors.json',import.meta.url),'utf8'));
const caps=['torihiki-read','torihiki-devnet-trade'];

test('declares the devnet reads and the three signed writes, each with each-operation consent and one origin',()=>{
  const r=t.torihikiRuntime(domain.descriptor);
  assert.deepEqual(clientRuntimeProblems(r,caps,app),[]);
  assert.deepEqual(r.operations.map(o=>o.operation),['read-head','read-market','read-book','read-account','read-trades','read-candles-1','read-candles-10','read-candles-50','request-devnet-funds','submit-order','cancel-all']);
  for(const o of r.operations){assert.equal(o.consent,'each-operation');assert.equal(o.endpoint.origin,t.TORIHIKI_NODE);assert.equal(o.endpoint.routes.length,1);
    const route=o.endpoint.routes[0];assert.equal(route.method,o.capability==='torihiki-read'?'GET':'POST');if(route.method==='POST')assert.equal(route.path,'/tx');}
  assert.match(clientRuntimeConnectSrc(r,caps,[],app),/torihiki-node\.04-feasts-minded\.workers\.dev/);
  // No withdrawal, agent, transfer or other money-moving operation is declared.
  assert(!r.operations.some(o=>/withdraw|agent|transfer|vault/.test(o.operation)));
});

test('only the exact declared URLs match; other paths, values, methods and hosts are refused',()=>{
  const ops=Object.fromEntries(t.torihikiRuntime(domain.descriptor).operations.map(o=>[o.operation,o.endpoint]));
  for(const [op,url] of Object.entries(t.torihikiUrls))assert(clientEndpointAllowsRequest(ops[op],url),url);
  const n=t.TORIHIKI_NODE;
  for(const [op,url,method] of [['read-head',n+'/tx','GET'],['read-head',n+'/head','POST'],['read-head',n+'/head?x=1','GET'],
    ['read-market',n+'/market?id=2','GET'],['read-market',n+'/market','GET'],['read-book',n+'/book?market=1&depth=500','GET'],
    ['read-book','https://evil.test/book?market=1&depth=15','GET'],['read-head',n+'/account?id=1','GET'],
    ['read-account',n+'/account?id=123456','POST'],['read-account',n+'/account?id=1&x=2','GET'],['read-account',n+'/accounts?id=1','GET'],
    ['submit-order',n+'/tx','GET'],['submit-order',n+'/tx?x=1','POST'],['submit-order',n+'/head','POST'],['cancel-all','https://evil.test/tx','POST']])
    assert(!clientEndpointAllowsRequest(ops[op],url,method),`${method} ${url}`);
  assert(clientEndpointAllowsRequest(ops['read-account'],t.accountUrl(123456),'GET'));
  for(const op of ['request-devnet-funds','submit-order','cancel-all'])assert(clientEndpointAllowsRequest(ops[op],t.TX_URL,'POST'),op);
  assert.throws(()=>t.accountUrl(99999));assert.throws(()=>t.accountUrl('123456'));
});

test('signing payload and account derivation match the engine golden vectors, with negative controls',async()=>{
  assert.match(vec.about,/f0\.\.f49/);assert.equal(t.FIELD_COUNT,50);
  for(const d of vec.derive)assert.equal(await t.deriveAccount(d.pubkey),d.account,d.pubkey);
  for(const p of vec.payloads)assert.equal(t.signingPayload(p.chain,p.account,p.nonce,p.tx),p.payload,JSON.stringify(p.tx));
  for(const kind of ['order','cancel-all','deposit'])assert(vec.payloads.some(p=>p.tx.tx===kind),kind);
  const p0=vec.payloads[0];
  assert.notEqual(t.signingPayload(p0.chain,p0.account,p0.nonce,{...p0.tx,side:1-p0.tx.side}),p0.payload);
  assert.notEqual(t.signingPayload(p0.chain,p0.account,p0.nonce+1,p0.tx),p0.payload);
  assert.notEqual(t.signingPayload('torihiki-mainnet-1',p0.account,p0.nonce,p0.tx),p0.payload);
  // One field fewer (the engine before :cid-free pins) must not match either.
  assert.notEqual(p0.payload.replace('f49=\n',''),p0.payload);
  assert.notEqual(await t.deriveAccount(vec.derive[0].pubkey.replace('AAA=','AAE=')),vec.derive[0].account);
  // Fields the client does not build are refused rather than silently left unsigned.
  assert.throws(()=>t.signingPayload(p0.chain,p0.account,p0.nonce,{...p0.tx,builder:100001}));
  assert.throws(()=>t.signingPayload(p0.chain,p0.account,p0.nonce,{tx:'withdraw',amount:1}));
  assert.throws(()=>t.signingPayload(p0.chain,p0.account,0,p0.tx));
});

test('buildTx keeps orders, cancel-all and the faucet inside the engine ranges',()=>{
  assert.deepEqual(t.buildTx('order',{side:0,level:68000,qty:2,flags:1}),{tx:'order',market:1,side:0,level:68000,qty:2,flags:1});
  assert.deepEqual(t.buildTx('cancel-all'),{tx:'cancel-all',market:1});
  assert.deepEqual(t.buildTx('deposit',{amount:1000000}),{tx:'deposit',amount:1000000});
  for(const f of [{side:2,level:1,qty:1},{side:0,level:0,qty:1},{side:0,level:1048576,qty:1},{side:0,level:1,qty:0},{side:0,level:1,qty:1.5},{side:0,level:1,qty:1,flags:8},{side:'0',level:1,qty:1}])
    assert.throws(()=>t.buildTx('order',f),JSON.stringify(f));
  assert.throws(()=>t.buildTx('deposit',{amount:0}));assert.throws(()=>t.buildTx('withdraw',{amount:1}));
});

test('a signed envelope verifies with the exported raw key and its account is the derived id',async()=>{
  const pair=await crypto.subtle.generateKey({name:'Ed25519'},false,['sign','verify']);
  const pubkey=t.b64(await crypto.subtle.exportKey('raw',pair.publicKey));
  const key={privateKey:pair.privateKey,pubkey,account:await t.deriveAccount(pubkey)};
  assert(key.account>=100000);assert.equal(pair.privateKey.extractable,false);
  const order=t.buildTx('order',{side:1,level:68010,qty:1});
  const env=await t.signEnvelope(key,'torihiki-devnet-1',3,order);
  assert.deepEqual(Object.keys(env).sort(),['account','nonce','pubkey','sig','tx']);
  const payload=new TextEncoder().encode(t.signingPayload('torihiki-devnet-1',key.account,3,order));
  assert(await crypto.subtle.verify({name:'Ed25519'},pair.publicKey,Buffer.from(env.sig,'base64'),payload));
  assert(!await crypto.subtle.verify({name:'Ed25519'},pair.publicKey,Buffer.from(env.sig,'base64'),new TextEncoder().encode(t.signingPayload('torihiki-devnet-1',key.account,4,order))));
  // An in-memory store stands in for IndexedDB: the key round-trips and a tampered account is not loaded.
  const mem=new Map();const store=run=>{const req=run({get:k=>({result:mem.get(k)}),put:(v,k)=>mem.set(k,v),delete:k=>mem.delete(k)});return Promise.resolve(req?.result);};
  const created=await t.createKey(store);assert.equal((await t.loadKey(store)).account,created.account);
  mem.set('session',{...created,account:created.account+1});assert.equal(await t.loadKey(store),null);
  await t.deleteKey(store);assert.equal(await t.loadKey(store),null);
});

test('devnet guard, account and transaction views',()=>{
  assert(t.isDevnet('torihiki-devnet-1'));assert(!t.isDevnet('torihiki-1'));assert(!t.isDevnet(null));
  const acct={account:123456,'next-nonce':4,'bound-key':null,collateral:1000000,equity:1000000,'free-collateral':990000,liquidatable:false,positions:{1:{size:-2,entry:68010,unrealized:-20}},triggers:[]};
  assert.equal(t.accountView(acct,123456).nextNonce,4);assert.equal(t.accountView(acct,123456).positions[0].size,-2);
  assert.throws(()=>t.accountView(acct,123457));assert.throws(()=>t.accountView({...acct,'next-nonce':0},123456));assert.throws(()=>t.accountView({...acct,collateral:'1'},123456));
  assert.deepEqual(t.txView(200,{ok:true,height:63,'state-root':'00'}),{ok:true,nonceSpent:true,height:63,reason:null});
  assert.deepEqual(t.txView(400,{ok:false,height:64,reason:'insufficient-margin'}),{ok:false,nonceSpent:true,height:64,reason:'insufficient-margin'});
  assert.deepEqual(t.txView(401,{ok:false,height:62,reason:'bad-signature'}),{ok:false,nonceSpent:false,height:62,reason:'bad-signature'});
  assert.throws(()=>t.txView(500,{ok:false}));assert.throws(()=>t.txView(200,{ok:false}));assert.throws(()=>t.txView(400,{ok:false,reason:'<b>'}));
});

test('response views accept the live node shapes and reject malformed data',()=>{
  const head={'state-root':'7f'.repeat(32),'chain-id':'torihiki-devnet-1',consensus:'none — single sequencer, not a validator set',height:62};
  assert.equal(t.headView(head).height,62);
  assert.throws(()=>t.headView({...head,height:-1}));
  assert.throws(()=>t.headView({...head,'state-root':'zz'}));
  const market={id:1,mark:68000,oracle:68000,last:67990,'open-interest':366,'funding-rate':0,'max-leverage':40,'oracle-stale':false};
  assert.equal(t.marketView(market).mark,68000);
  assert.equal(t.marketView({...market,'max-leverage':null}).maxLeverage,null);
  assert.throws(()=>t.marketView({...market,id:2}));
  assert.throws(()=>t.marketView({...market,mark:'68000'}));
  const book={market:1,bids:[{level:67990,qty:1492,cum:1492}],asks:[{level:68010,qty:1134,cum:1134}],resting:10};
  assert.deepEqual(t.bookView(book),{bids:[{level:67990,qty:1492}],asks:[{level:68010,qty:1134}]});
  assert.throws(()=>t.bookView({...book,bids:Array(16).fill({level:1,qty:1})}));
  assert.throws(()=>t.bookView({...book,asks:[{level:1,qty:-1}]}));
});

test('Android host allowlist and build CSP use the same host and routes as the declaration',()=>{
  const java=readFileSync(new URL('../shared/src/network/awai/platform/HostActivity.java',import.meta.url),'utf8');
  const host=new URL(t.TORIHIKI_NODE).host;
  assert(java.includes(`TORIHIKI_HOST = "${host}"`));
  for(const url of Object.values(t.torihikiUrls)){const u=new URL(url);assert(java.includes(`"${u.pathname}".equals(path)`));if(u.search)assert(java.includes(`"${u.search.slice(1)}".equals(query)`));}
  assert(java.includes('"/account".equals(path)&&query!=null&&query.matches("id=[1-9][0-9]{5,13}")'));
  assert(java.includes('"/tx".equals(u.getEncodedPath())&&u.getEncodedQuery()==null'));
  // POST reaches the network only for /tx; every other torihiki URL is GET-only.
  assert(java.includes('("POST".equals(req.getMethod())&&torihikiTx(u))'));
  const build=readFileSync(new URL('../build.py',import.meta.url),'utf8');
  assert(build.includes(`connect-src ${t.TORIHIKI_NODE}`));
});

test('trades and candles views accept live shapes, reject malformed data, and only the declared spans match (AWAI-3415)',()=>{
  const trades={market:1,trades:[{level:67990,qty:3,side:1,h:61},{level:68010,qty:2,side:0,h:57}]};
  assert.deepEqual(t.tradesView(trades)[0],{level:67990,qty:3,side:1,height:61});
  for(const bad of [{...trades,market:2},{...trades,trades:[{level:1,qty:1,side:2,h:1}]},{...trades,trades:[{level:1,qty:0,side:0,h:1}]},{...trades,trades:Array(201).fill({level:1,qty:1,side:0,h:1})}])assert.throws(()=>t.tradesView(bad));
  const c={open:67990,high:68010,low:67990,close:68010,volume:5,'buy-volume':2,'sell-volume':3,h:50,fills:2};
  const candles={unit:'blocks','truncated-because':'no-older-blocks',candles:[c]};
  assert.deepEqual(t.candlesView(candles),{candles:[{height:50,open:67990,high:68010,low:67990,close:68010,volume:5,buy:2,sell:3}],truncated:true});
  for(const bad of [{...candles,unit:'seconds'},{...candles,candles:[{...c,low:68000}]},{...candles,candles:[{...c,high:68000}]},{...candles,candles:[{...c,volume:-1}]},{...candles,candles:[{...c,open:'1'}]}])assert.throws(()=>t.candlesView(bad));
  const ops=Object.fromEntries(t.torihikiRuntime(domain.descriptor).operations.map(o=>[o.operation,o.endpoint]));
  const n=t.TORIHIKI_NODE;
  for(const span of t.CANDLE_SPANS)assert(clientEndpointAllowsRequest(ops[`read-candles-${span}`],`${n}/candles?market=1&span=${span}`));
  for(const [op,url] of [['read-candles-1',n+'/candles?market=1&span=10'],['read-candles-10',n+'/candles?market=2&span=10'],['read-candles-50',n+'/candles?market=1&span=500'],['read-trades',n+'/trades?market=2'],['read-trades',n+'/trades']])assert(!clientEndpointAllowsRequest(ops[op],url),url);
  const m={id:1,mark:68000,oracle:68000,last:67990,'open-interest':366,'funding-rate':0,'max-leverage':40,'oracle-stale':false,'initial-margin-rate':25000000,'taker-fee-rate':350000,'maker-fee-rate':100000};
  const v=t.marketView(m);assert.equal(v.initialMarginRate/t.RATE_SCALE,0.025);assert.equal(v.takerFeeRate,350000);
  assert.equal(t.marketView({...m,'taker-fee-rate':undefined}).takerFeeRate,null);assert.throws(()=>t.marketView({...m,'taker-fee-rate':-1}));
});
test('chart axis steps are 1, 2 or 5 times a power of ten',()=>{
  assert.equal(t.niceStep(3),5);assert.equal(t.niceStep(34),50);assert.equal(t.niceStep(136/4),50);assert.equal(t.niceStep(20),20);assert.equal(t.niceStep(1200),2000);
});

test('signing follows the deployed node version: code-version 12 signs f0..f15 and has no cancel-all (AWAI-3442)',()=>{
  const p0=vec.payloads[0];
  const lines=p0.payload.split('\n');
  const f16=t.signingPayload(p0.chain,p0.account,p0.nonce,p0.tx,16);
  assert.equal(f16,[...lines.slice(0,4+16),''].join('\n'));
  assert.notEqual(f16,p0.payload);
  assert.throws(()=>t.signingPayload(p0.chain,p0.account,p0.nonce,p0.tx,15));assert.throws(()=>t.signingPayload(p0.chain,p0.account,p0.nonce,p0.tx,51));
  const head={'state-root':'7f'.repeat(32),'chain-id':'torihiki-devnet-1',consensus:'none',height:68,'code-version':'12'};
  const h=t.headView(head);assert.equal(h.codeVersion,'12');
  assert.deepEqual({...t.protocolFor(h)},{fields:16,txs:t.NODE_PROTOCOLS['12'].txs});
  assert(t.supports(h,'order'));assert(t.supports(h,'deposit'));assert(!t.supports(h,'cancel-all'));
  for(const v of ['13',undefined,'12; x','__proto__'])assert.throws(()=>t.protocolFor(t.headView({...head,'code-version':v})),String(v));
  assert.throws(()=>t.protocolFor(null));
  assert.equal(t.headView({...head,'code-version':'<b>'}).codeVersion,null);
});
