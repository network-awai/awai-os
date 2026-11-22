import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const runtime=new URL('../../otehon/shell/vendor/kotoba-client-runtime.js',import.meta.url);
const text=readFileSync(new URL('../client/online.js',import.meta.url),'utf8').replace("'./runtime.js'",JSON.stringify(runtime.href)).replace("'./key-list.js'",JSON.stringify(new URL('../client/key-list.js',import.meta.url).href));
const {validatePins}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));

// AWAI-3662: the committed latest-catalog pointer. The signature is checked by
// android/publish-latest-pointer.py (openssl) and on the device by LatestPointer.java.
test('the published pointer has the latest.v1 shape and valid pins',()=>{
  const envelope=JSON.parse(readFileSync(new URL('../../store/latest/pointer-envelope.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(envelope).sort(),['raw','signature']);
  assert(envelope.raw.length<=12288&&/^[A-Za-z0-9+/=]+$/.test(envelope.signature));
  const v=JSON.parse(envelope.raw);
  assert.equal(v.schema,'itonami.store.latest.v1');
  assert(Number.isSafeInteger(v.sequence)&&v.sequence>=1);
  assert(Number.isSafeInteger(v.issuedAt)&&Number.isSafeInteger(v.expiresAt));
  assert(v.expiresAt>v.issuedAt&&v.expiresAt-v.issuedAt<=31*24*60*60);
  validatePins(v.pins);
});
