// Explicit synthetic audio fixture through actual pinned Whisper and the real controller.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {transcribe} from '../voice-agent.mjs';
import {VoiceControl} from '../voice-control.mjs';
const [root,result]=process.argv.slice(2),dir='/tmp/aiueos-asr-en-controls';await mkdir(dir,{recursive:true,mode:0o700});
const actions=[],recognized=[];
const control=new VoiceControl({model:async()=>{throw Error('No model in protected controls');},dispatch:a=>actions.push(a)});
const hear=async(name,secret=false)=>{const words=await transcribe(await readFile(root+'/'+name+'.pcm'),{dir,language:'en',secret});recognized.push({name,words});console.log(name,words);return words;};
control.update({revision:1,language:'en',kind:'secret'});
for(const name of ['en-lowercase','en-digit','en-done'])await control.utterance(await hear(name,true));
assert.equal(actions[0]?.value,'b7');
control.update({revision:2,language:'en',kind:'erase',target:'/dev/voice-fixture',serial:'QA1234'});await control.utterance('install');await control.utterance(await hear('en-erase'));assert.equal(actions[1]?.action,'erase');
await writeFile(result,JSON.stringify({recognized,controls:['secret','erase'],actualDiskErased:false,physicalMicrophone:false},null,2));console.log('REAL_EN_ASR_CONTROLS_PASS');
