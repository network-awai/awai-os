import { test } from 'node:test';
import assert from 'node:assert/strict';
import { category, localCdp, normalize, safeUi } from '../scripts/otehon-remote-browser-diagnostics.mjs';

test('observer requires loopback CDP and never selects foreign origins', () => {
  assert.equal(localCdp('http://127.0.0.1:19222'),'http://127.0.0.1:19222');
  for(const value of ['http://example.com:9222','http://user:secret@127.0.0.1:9222','http://127.0.0.1:9222/path']) assert.throws(()=>localCdp(value));
  assert.equal(category('https://relay.awai.network.evil/secret'),null);
});
test('network records omit topics, payloads, headers, private keys and URLs', () => {
  const tracked=new Map();
  const event=normalize('Network.requestWillBeSent',{requestId:'x',request:{url:'https://relay.awai.network/private-topic/json',method:'POST',postData:'private-body',headers:{Authorization:'private-token'}}},tracked);
  assert.deepEqual(event,{event:'request',kind:'relay',method:'POST'});
  assert.ok(!JSON.stringify(event).includes('private'));
  assert.deepEqual(normalize('Network.responseReceived',{requestId:'x',response:{status:403,headers:{'set-cookie':'private'}}},tracked),{event:'response',kind:'relay',status:403});
});
test('failure messages cannot inject unbounded/private text', () => {
  const tracked=new Map([['x','relay']]);
  const row=normalize('Network.loadingFailed',{requestId:'x',errorText:'private secret',corsErrorStatus:{corsError:'private-url/value'}},tracked);
  assert.equal(row.code,'network-failed');assert.equal(row.cors,null);assert.equal(tracked.size,0);
});
test('DNS failure is useful without retaining the request URL', () => {
  assert.equal(normalize('Network.loadingFailed',{requestId:'x',errorText:'net::ERR_NAME_NOT_RESOLVED'},new Map([['x','relay']])).code,'net::ERR_NAME_NOT_RESOLVED');
});
test('UI and exception observations never retain input/identity values', () => {
  assert.deepEqual(safeUi({step:'signin',link:'failed',approvalOpen:false,hasError:true,password:'private'}),{event:'ui',step:'signin',link:'failed',approvalOpen:false,hasError:true,code:null});
  assert.equal(normalize('Runtime.exceptionThrown',{exceptionDetails:{exception:{className:'TypeError',description:'private key'}}},new Map()).class,'TypeError');
});
