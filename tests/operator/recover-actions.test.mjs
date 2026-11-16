import test from'node:test';import assert from'node:assert/strict';import{admitReceipt}from'../../scripts/operator/recover-actions.mjs';
const digest='a'.repeat(64),id=8,p={name:'github-actions/8/part-000000.bin',bytes:7,sha256:'b'.repeat(64)};
const r={schema:'awai.operator.github-artifact.v1',repo:'network-awai/awai-os',source:{id,digest:'sha256:'+digest,size_in_bytes:7},bytes:7,sha256:digest,parts:[p]};
test('independent recovery admits only caller-pinned source identity and complete ordered bounded members',()=>{
 assert.equal(admitReceipt(r,id,digest),r);
 for(const x of [{...r,repo:'other/repo'},{...r,source:{...r.source,id:9}},{...r,sha256:'c'.repeat(64)},{...r,parts:[]},{...r,parts:[{...p,name:'../../outside'}]},{...r,parts:[{...p,bytes:8}]}])assert.throws(()=>admitReceipt(x,id,digest));
});
