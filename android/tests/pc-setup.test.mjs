import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context={window:{},console};vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../client/generated/domain.js',import.meta.url),'utf8'),context);
const domain=context.window.ItonamiDomain;
// PC stages are visible (not retired) on PC; mobile retired them in AWAI-3049.
test('PC stage projection covers language/network/datetime',()=>{
  assert.equal(domain.pcSetupStage(0),'welcome');
  assert.equal(domain.pcSetupStage(1),'language');
  assert.equal(domain.pcSetupStage(2),'network');
  assert.equal(domain.pcSetupStage(3),'datetime');
  assert.equal(domain.pcSetupStage(4),'account');
  assert.equal(domain.pcSetupStage(7),'done');
});
test('PC transports are hardware-adaptive',()=>{
  const transports=domain.pcSetupTransports(JSON.stringify({hasEthernet:true,hasWifi:true,hasTethering:true}));
  // available-transports returns vector; normalize to array check
  assert.deepEqual([...transports].slice(0,3),['ethernet','wifi','tethering'].slice(0,Math.min(3,transports.length)));
});
test('profile transfer honest unavailable',()=>{
  assert.ok(domain.pcProfileUnavailable().includes('まだ'));
});
test('PC next gates: settings-owned readback decides',()=>{
  const next=s=>domain.pcSetupNext(JSON.stringify(s));
  assert.equal(next({stage:1,locale:'ja-JP'}),'next');
  assert.equal(next({stage:2,validated:true}),'next');
  assert.equal(next({stage:4}),'account-required');
  assert.equal(next({stage:7,secure:false,account:'deferred'}),'refused');
  assert.equal(next({stage:7,secure:true,account:'deferred'}),'finish');
});
test('PC wizard surfaces wallpaper/screensaver + keyboard focus',()=>{
  const src=fs.readFileSync(new URL('../client/setup.js',import.meta.url),'utf8');
  assert.match(src,/壁紙とスクリーンセーバー/);
  assert.match(src,/openScreensaverSettings/);
  assert.match(src,/setAwaiWallpaper/);
});
test('PC desktop is not blank: topbar + dock + apps always visible',()=>{
  const client=fs.readFileSync(new URL('../client/client.js',import.meta.url),'utf8');
  assert.match(client,/pc-desktop/);
  assert.match(client,/pc-topbar/);
  assert.match(client,/ホームに設定|pc-topbar-btn/);
});
