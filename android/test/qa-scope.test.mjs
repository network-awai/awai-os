import test from 'node:test';import assert from 'node:assert/strict';import {assertQaDevice,assertQaPackages} from './qa-scope.mjs';
const p={itonami:{id:'network.itonami.app.qa',testOnly:true,internet:false,sha256:'1'.repeat(64)},murakumo:{id:'network.awai.murakumo.qa',testOnly:true,internet:false,sha256:'2'.repeat(64)}};
test('accepts only the pair of isolated test packages',()=>assert.doesNotThrow(()=>assertQaPackages(p)));
for(const [name,change] of Object.entries({production:{id:'network.itonami.app'},network:{internet:true},normalInstall:{testOnly:false},unboundArtifact:{sha256:null}}))test('rejects '+name,()=>assert.throws(()=>assertQaPackages({...p,itonami:{...p.itonami,...change}})));
test('device admission cannot treat arbitrary physical or USB serial as QA scope',()=>{
 assert.doesNotThrow(()=>assertQaDevice({serial:'10.77.0.2:5555',mode:'physical-6600h',mac:'0c:47:a9:60:9d:34',qemu:'0'}));
 for(const v of [{serial:'ZY32MCL7RD',mode:'physical-6600h',mac:'0c:47:a9:60:9d:34'},{serial:'10.77.0.2:5555',mode:'owned-emulator',qemu:'1'},{serial:'10.77.0.2:5555',mode:'physical-6600h',mac:'wrong'}])assert.throws(()=>assertQaDevice(v));
});
