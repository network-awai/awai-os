// Actual pinned whisper.cpp over synthetic PCM, not a physical microphone.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {transcribe} from '../voice-agent.mjs';
import {VoiceControl} from '../voice-control.mjs';
const [root,result]=process.argv.slice(2), dir='/tmp/aiueos-asr-controls';await mkdir(dir,{recursive:true,mode:0o700});
const actions=[],speech=[],recognized=[];
const control=new VoiceControl({model:async()=>{throw Error('Deterministic control must not reach model');},dispatch:a=>actions.push(a),speak:async s=>speech.push(s)});
const hear=async(name,secret=false)=>{const words=await transcribe(await readFile(root+'/'+name+'.pcm'),{dir,language:'ja',secret});recognized.push({name,words});console.log(name,words);return words;};
control.update({revision:1,language:'ja',kind:'language',choices:[{id:'ja',label:'日本語'},{id:'en',label:'English'}]});await control.utterance(await hear('language'));assert.equal(actions[0]?.value,'ja');
control.update({revision:2,language:'ja',kind:'secret'});await control.utterance(await hear('lowercase',true));await control.utterance(await hear('digit',true));await control.utterance(await hear('done',true));assert.equal(actions[1]?.value,'b7');
control.update({revision:3,language:'ja',kind:'erase',target:'/dev/voice-fixture',serial:'QA1234'});await control.utterance('インストールして');await control.utterance(await hear('erase'));assert.equal(actions[2]?.action,'erase');assert.equal(actions[2]?.value,'/dev/voice-fixture');
await writeFile(result,JSON.stringify({recognized,controls:['language','secret','erase'],actualDiskErased:false,physicalMicrophone:false},null,2));
console.log('REAL_ASR_CONTROLS_PASS');
