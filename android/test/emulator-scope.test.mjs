import test from 'node:test';import assert from 'node:assert/strict';
import {assertDisposableScope} from './emulator-scope.mjs';
const fixture={serial:'emulator-5572',name:'Awai_Regression_unit',expectedName:'Awai_Regression_unit',qemu:'1',hardware:'ranchu',root:'/task/qa',marker:{schema:'awai.disposable-emulator.v1',serial:'emulator-5572',name:'Awai_Regression_unit',root:'/task/qa'}};
test('accepts explicitly owned disposable emulator',()=>assert.doesNotThrow(()=>assertDisposableScope(fixture)));
for(const [name,patch]of Object.entries({physical:{serial:'10.77.0.2:5555'},usb:{serial:'ZY32MCL7RD'},shared:{name:'Awai_Setup_API35'},hardware:{qemu:'0'},unowned:{marker:null},wrongRoot:{root:'/other'}}))test(`refuses ${name} before mutation`,()=>assert.throws(()=>assertDisposableScope({...fixture,...patch}),/scope-required/));
