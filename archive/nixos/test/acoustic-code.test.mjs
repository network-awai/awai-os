import {test} from 'node:test';import assert from 'node:assert/strict';
import {encode,decode,approvalUri,sampleRate} from '../acoustic-code.mjs';
import {ambient,wav,codeAudio} from '../setup-sound.mjs';
test('playback tolerates output-device startup loss',()=>{const s=codeAudio('QA1234ABCD');assert.ok(s.subarray(0,sampleRate).every(v=>v===0));assert.equal(decode(s.subarray(8000)),'QA1234ABCD');});
test('acoustic code survives offset, attenuation and background noise',()=>{const tone=encode('QA1234ABCD'),s=new Float32Array(tone.length+713);tone.forEach((v,i)=>s[i+713]=v*0.45+0.004*Math.sin(i*1.731));assert.equal(decode(s),'QA1234ABCD');assert.equal(approvalUri('QA1234ABCD'),'https://setup.murakumo.cloud/#device-link?code=QA1234ABCD');});
test('damaged code, silence and ambient music never authorize or decode',()=>{const s=encode('QA1234ABCD');s.fill(0,17000,18000);assert.equal(decode(s),null);assert.equal(decode(new Float32Array(sampleRate*4)),null);assert.equal(decode(ambient()),null);assert.throws(()=>approvalUri('https://evil'));});
test('ambient audio is quiet, finite and has faded boundaries',()=>{const s=ambient();assert.equal(s.length,sampleRate*24);assert.ok(s.every(v=>Number.isFinite(v)&&Math.abs(v)<=0.032));assert.equal(s[0],0);assert.ok(Math.abs(s.at(-1))<1e-6);assert.equal(wav(s).readUInt32LE(40),s.length*2);});
