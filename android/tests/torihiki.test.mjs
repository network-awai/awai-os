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

test('declares three read-only devnet routes with each-operation consent and one origin',()=>{
  const r=t.torihikiRuntime(domain.descriptor);
  assert.deepEqual(clientRuntimeProblems(r,['torihiki-read'],app),[]);
  assert.deepEqual(r.operations.map(o=>o.operation),['read-head','read-market','read-book']);
  for(const o of r.operations){assert.equal(o.consent,'each-operation');assert.equal(o.endpoint.origin,t.TORIHIKI_NODE);assert(o.endpoint.routes.every(x=>x.method==='GET'));}
  assert.match(clientRuntimeConnectSrc(r,['torihiki-read'],[],app),/torihiki-node\.04-feasts-minded\.workers\.dev/);
  // No write, faucet or order operation is declared.
  assert(!r.operations.some(o=>/order|faucet|tx/.test(o.operation)));
});

test('only the exact declared URLs match; other paths, values, methods and hosts are refused',()=>{
  const ops=Object.fromEntries(t.torihikiRuntime(domain.descriptor).operations.map(o=>[o.operation,o.endpoint]));
  for(const [op,url] of Object.entries(t.torihikiUrls))assert(clientEndpointAllowsRequest(ops[op],url),url);
  const n=t.TORIHIKI_NODE;
  for(const [op,url,method] of [['read-head',n+'/tx','GET'],['read-head',n+'/head','POST'],['read-head',n+'/head?x=1','GET'],
    ['read-market',n+'/market?id=2','GET'],['read-market',n+'/market','GET'],['read-book',n+'/book?market=1&depth=500','GET'],
    ['read-book','https://evil.test/book?market=1&depth=15','GET'],['read-head',n+'/account?id=1','GET']])
    assert(!clientEndpointAllowsRequest(ops[op],url,method),`${method} ${url}`);
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
  const build=readFileSync(new URL('../build.py',import.meta.url),'utf8');
  assert(build.includes(`connect-src ${t.TORIHIKI_NODE}`));
});
