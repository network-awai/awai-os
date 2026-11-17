import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {modelClient,run,terminate,transcribe} from '../voice-agent.mjs';
import {VoiceControl} from '../voice-control.mjs';
const [program,model,asrPath,resultPath]=process.argv.slice(2);
const server=run(program,['-m',model,'--host','127.0.0.1','--port','19087','--ctx-size','2048','--threads','2','--parallel','1','--cache-ram','0','-ngl','0'],{unprivileged:false,timeout:300000});
server.child.stderr.on('data',d=>process.stdout.write(d));server.promise.catch(()=>{});
try {
  let ready=false;for(let i=0;i<120;i++){assert.equal(server.child.exitCode,null);try{if((await fetch('http://127.0.0.1:19087/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
  const actions=[],speech=[],began=Date.now();const modelCall=modelClient({url:'http://127.0.0.1:19087'});
  const control=new VoiceControl({model:async request=>{const reply=await modelCall(request);console.log('MODEL_RESULT',JSON.stringify(reply));return reply;},dispatch:a=>actions.push(a),speak:async t=>speech.push(t)});
  control.update({revision:1,language:'ja',kind:'menu',message:'接続方法を選ぶ',choices:[{id:'wifi',label:'Wi-Fiに接続'},{id:'wired',label:'有線LAN'},{id:'offline',label:'オフライン'}]});
  const audioDir='/tmp/aiueos-voice-native-qa';await mkdir(audioDir,{recursive:true,mode:0o700});
  const asr=process.env.MURAKUMO_ASR_MODEL?await transcribe(await readFile(asrPath),{dir:audioDir,language:'ja'}):(await readFile(asrPath,'utf8')).trim();
  assert.match(asr,/wi.?fi|ワイファイ/i);await control.utterance(asr);assert.equal(actions[0]?.value,'wifi');
  control.update({revision:2,language:'ja',kind:'menu',message:'スマホなしでも端末のセットアップは完了できます。アカウント連携は後からできます。',choices:[{id:'local',label:'スマホなしでセットアップを完了'},{id:'account',label:'アカウントを連携'}]});
  await control.utterance('スマホなしで完了したいです');assert.equal(actions[1]?.value,'local');
  control.update({revision:3,language:'ja',kind:'message',message:'ローカルセットアップ完了。アカウントは未連携。',canContinue:true});
  await control.utterance('アカウントも連携できましたか？');assert.ok(speech.length>0);assert.match(speech[0],/未|まだ|後から|連携されていません/);assert.equal(actions.length,2);
  control.update({revision:4,language:'ja',kind:'message',message:'アカウント連携完了。署名付きオンライン状態の検証が成功しています。',canContinue:true});
  await control.utterance('アカウントも連携できましたか？');assert.match(speech[1],/完了|済|連携でき|成功/);assert.doesNotMatch(speech[1],/未連携|まだ連携していません/);
  control.update({revision:5,language:'en',kind:'menu',message:'Choose a network connection',choices:[{id:'wifi',label:'Wi-Fi'},{id:'wired',label:'Ethernet'},{id:'offline',label:'Offline'}]});
  await control.utterance('I want to use wired Ethernet');assert.equal(actions[2]?.value,'wired');
  await writeFile(resultPath,JSON.stringify({realModel:true,model,realWhisperCpp:!!process.env.MURAKUMO_ASR_MODEL,asr,actions:actions.map(a=>a.value),speech,elapsedMs:Date.now()-began,platform:'macOS native CPU',physicalMicrophone:false,realPasskey:false},null,2));
  await writeFile(resultPath+'.speech.txt',speech[0]);console.log('NATIVE_REAL_DIALOGUE_PASS');
}finally{terminate(server.child);}
