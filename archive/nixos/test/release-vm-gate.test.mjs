import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoreJourneys} from '../tests/journey-score.mjs';
import {observations} from './fixtures/journey-observations.mjs';
import {spawnSync} from 'node:child_process';
import {validateVMGate, checks} from '../scripts/check-setup-vm.mjs';
const systemPath='/nix/store/'+'a'.repeat(32)+'-nixos-system-murakumo-node-26.05';
const valid={schema:'murakumo.release-vm-gate.v2',systemPath,sourceSha256:'b'.repeat(64),
  nixpkgsRevision:'c'.repeat(40),testPath:'/nix/store/'+'d'.repeat(32)+'-vm-test-run-murakumo-setup-services',kekkaiTestPath:'/nix/store/'+'f'.repeat(32)+'-vm-test-run-murakumo-kekkai-setup',checks:[...checks,'reboot'],journeyScore:scoreJourneys(observations())};
test('release requires complete VM evidence bound to its target',()=>{
  assert.equal(validateVMGate(valid,systemPath),valid);
  assert.throws(()=>validateVMGate({...valid,journeyScore:undefined},systemPath),/quality gate/);
  assert.throws(()=>validateVMGate(valid,systemPath,'e'.repeat(64)),/VM release gate/);
  assert.throws(()=>validateVMGate({...valid,systemPath:undefined},undefined),/VM release gate/);
  for(const broken of [null,{passed:true},{...valid,checks:checks.slice(0,2)},
    {...valid,kekkaiTestPath:undefined},{...valid,kekkaiTestPath:'/tmp/result'},{...valid,testPath:'/tmp/result'},{...valid,sourceSha256:''},{...valid,nixpkgsRevision:'main'},
    {...valid,systemPath:systemPath+'-old'}])assert.throws(()=>validateVMGate(broken,systemPath),/VM release gate/);
});
test('publisher refuses pre-gate invocation before reading keys or exporting',()=>{
  const r=spawnSync(process.execPath,['archive/nixos/scripts/publish-update.mjs','absent-spec','absent-key','absent-output'],{encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/pinned-nixpkgs required/);
});
test('signer rejects ungated release before executing Keychain helper',()=>{
  const r=spawnSync(process.execPath,['archive/nixos/scripts/sign-keychain-release.mjs','archive/nixos/test/fixtures/ungated-release.json','fixture','/must-not-run'],{encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/VM release gate/);
});
