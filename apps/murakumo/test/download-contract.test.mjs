// AWAI-3307: every catalog model is a valid canonical host-stream download, pinned to its revision and digest.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {clientRuntimeProblems,clientRuntimeConnectSrc} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';
import {runtimeFor,DOWNLOAD_CAPABILITY} from '../client/download-contract.js';
const catalog=JSON.parse(fs.readFileSync(new URL('../catalog.json',import.meta.url)));
const runtime=runtimeFor(catalog);const APP='https://tauri.localhost';
test('the download descriptor passes the canonical validator',()=>{assert.deepEqual(clientRuntimeProblems(runtime,[DOWNLOAD_CAPABILITY],APP),[]);});
test('each operation pins its catalog revision, digest and exact size',()=>{
 assert.equal(runtime.operations.length,catalog.models.length);
 for(const [i,m] of catalog.models.entries()){const o=runtime.operations[i];
  assert.equal(o.endpoint.path,`/${m.repo}/resolve/${m.revision}/${m.file}`);assert.match(m.revision,/^[0-9a-f]{40}$/);
  assert.deepEqual(o.artifact,{revision:m.revision,sha256:m.sha256,'max-bytes':m.bytes,delivery:'host-stream'});
  assert.equal(o.consent,'each-operation');assert.deepEqual(o['redirect-origins'],['https://*.cdn.hf.co']);}
});
test('the CSP reaches only Hugging Face and its CDN',()=>{assert.deepEqual(clientRuntimeConnectSrc(runtime,[DOWNLOAD_CAPABILITY],[],APP),'connect-src https://*.cdn.hf.co https://huggingface.co');});
test('a broken digest is refused',()=>{const bad=structuredClone(runtime);bad.operations[0].artifact.sha256='00';assert.ok(clientRuntimeProblems(bad,[DOWNLOAD_CAPABILITY],APP).length>0);});
