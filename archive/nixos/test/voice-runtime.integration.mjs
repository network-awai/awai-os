import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {modelClient,transcribe,run,terminate} from '../voice-agent.mjs';
import {VoiceControl} from '../voice-control.mjs';
const port='19086';
const server=run(process.env.MURAKUMO_LLM_SERVER,['-m',process.env.MURAKUMO_VOICE_MODEL,'--host','127.0.0.1','--port',port,'--ctx-size','2048','--threads','2','--parallel','1','--cache-ram','0'],{timeout:900000});
server.child.stderr.on('data',d=>process.stdout.write(d));
server.promise.catch(e=>console.log('Model startup failed:',e.message));
try {
  let ready=false;
  for(let i=0;i<300;i++){assert.equal(server.child.exitCode,null,'actual model process remains alive');try{if((await fetch('http://127.0.0.1:'+port+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}
  assert.ok(ready,'actual local model starts');
  const started=Date.now();
  const pcm=await readFile('/mnt/output/voice-wifi-ja.pcm');assert.ok(pcm.length>1000,'fixture contains audio');
  const asr=await transcribe(pcm,{dir:'/run/voice-qa',language:'ja',timeout:600000});
  console.log('ASR',asr);
  assert.match(asr,/wi.?fi|ワイファイ/i);
  const actions=[],spoken=[];
  const control=new VoiceControl({model:modelClient({url:'http://127.0.0.1:'+port}),dispatch:a=>actions.push(a),speak:async t=>spoken.push(t)});
  control.update({revision:1,language:'ja',kind:'menu',message:'接続方法を選んでください',choices:[{id:'wifi',label:'Wi-Fiに接続する'},{id:'wired',label:'有線LAN'},{id:'offline',label:'オフラインで続ける'}]});
  await control.utterance(asr);
  assert.equal(actions[0]?.value,'wifi');
  control.update({revision:2,language:'ja',kind:'menu',message:'スマホなしでも端末のセットアップは完了できます。アカウント登録は後からできます。',choices:[{id:'local',label:'スマホなしでセットアップを完了する'},{id:'account',label:'アカウントを連携する'}]});
  await control.utterance('スマホなしで完了したいです');
  assert.equal(actions[1]?.value,'local');
  const speech='接続方法を選びました。セットアップを続けます。';
  await run(process.env.MURAKUMO_TTS_PYTHON,[process.env.MURAKUMO_TTS_SCRIPT,'/run/voice-qa/reply.wav'],{input:speech}).promise;
  const audio=await readFile('/run/voice-qa/reply.wav');
  assert.equal(audio.subarray(0,4).toString(),'RIFF');assert.ok(audio.length>10000);
  await writeFile('/mnt/output/voice-runtime-result.json',JSON.stringify({asr,actions:actions.map(a=>a.value),ttsBytes:audio.length,elapsedMs:Date.now()-started,realModels:true,physicalMicrophone:false,realPasskey:false},null,2));
  console.log('REAL_RUNTIME_PASS');
} finally {terminate(server.child);}
