import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context={window:{},console};vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../client/generated/domain.js',import.meta.url),'utf8'),context);
const domain=context.window.ItonamiDomain;
const next=s=>domain.setupNext(JSON.stringify(s));
test('no network gate: AOSP setup owns connectivity',()=>{
  assert.equal(next({stage:1,connected:false,validated:false}), 'next');
  assert.equal(next({stage:3,connected:false,validated:false}), 'next');
});
test('account enrollment and PIN cannot be manufactured by pressing Next',()=>{
  assert.equal(next({stage:4}), 'account-required');
  assert.equal(next({stage:6,secure:false}), 'lock-required');
  assert.equal(next({stage:7,secure:false,account:'deferred'}), 'refused');
  assert.equal(next({stage:7,secure:true,account:'unlinked'}), 'refused');
  assert.equal(next({stage:7,secure:true,account:'deferred'}), 'finish');
  assert.equal(next({stage:7,secure:true,account:'linked'}), 'finish');
});
test('stage projection has a bounded unknown fallback',()=>{
  assert.equal(domain.setupStage(0),'welcome');assert.equal(domain.setupStage(6),'lock');
  assert.equal(domain.setupStage(800),'welcome');
});
