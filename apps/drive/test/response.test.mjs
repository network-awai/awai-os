import test from'node:test';import assert from'node:assert/strict';import{readResponse}from'../src/bounded-response.js';
test('storage reply bounds reject oversized receipts, stalled and failing streams',async()=>{
 assert.equal((await readResponse(new Response('receipt'),2048)).length,7);
 await assert.rejects(readResponse(new Response(new Uint8Array(2049)),2048),/response-limit/);
 await assert.rejects(readResponse(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));}})),2048,10),/sync-timeout/);
 await assert.rejects(readResponse(new Response(new ReadableStream({start(c){c.error(Error('injected network failure'));}})),2048),/injected network failure/);
});
