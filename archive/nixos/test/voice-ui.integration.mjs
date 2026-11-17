import net from 'node:net';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdir,chmod,readFile,writeFile} from 'node:fs/promises';
import {VoiceControl} from '../voice-control.mjs';
import {run,terminate} from '../voice-agent.mjs';
const session='/run/murakumo-ui/voice-qa-'+randomUUID();await mkdir(session,{recursive:true,mode:0o700});
let peer,child,playbackStarted=0,playbackFinished=false,failure=null,musicStarted=0,musicFinished=false;
const resultPath='/mnt/output/voice-ui-result-'+randomUUID()+'.json';process.env.MURAKUMO_QA_RESULT=resultPath;
const control=new VoiceControl({model:async()=>{throw Error('No model used in native GUI transport fixture');},dispatch:a=>peer.write(JSON.stringify({kind:'action',...a})+'\n')});
const server=net.createServer(c=>{peer=c;let pending='';c.on('data',b=>{pending+=b;for(let end;(end=pending.indexOf('\n'))>=0;){const value=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1);if(value.kind==='playback'&&control.screen?.kind==='menu'){if(value.playing){musicStarted=Date.now();c.write(JSON.stringify({kind:'status',status:'listening'})+'\n');}else if(musicStarted&&!musicFinished){if(Date.now()-musicStarted<600){failure=Error('listening status truncated requested music');terminate(child);return;}musicFinished=true;control.utterance('1番').catch(e=>{failure=e;terminate(child);});}}else if(value.kind==='playback'&&control.screen?.kind==='approval'){if(value.playing){playbackStarted=Date.now();c.write(JSON.stringify({kind:'status',status:'listening'})+'\n');}else if(playbackStarted){if(Date.now()-playbackStarted<600){failure=Error('listening status truncated code playback');terminate(child);return;}playbackFinished=true;control.utterance('戻る').catch(e=>{console.error(e);terminate(child);});}}else if(value.kind==='invalidate')control.invalidate();else if(value.kind==='screen'){
  control.update(value.screen);
  (async()=>{switch(value.screen.kind){case 'language':await control.utterance('日本語');break;case 'menu':await control.utterance('音楽を流して');break;case 'secret':await control.utterance('エー');await control.utterance('7');await control.utterance('入力完了');break;case 'erase':await control.utterance('インストールして');await control.utterance('番号1234のディスクを消してインストール');break;case 'approval':await control.utterance('音で送って');break;case 'message':await control.utterance('次へ');break;}})().catch(e=>{console.error(e);terminate(child);});
}}});});
await new Promise(r=>server.listen(session+'/voice.sock',r));await chmod(session+'/voice.sock',0o600);
process.env.MURAKUMO_UI_SESSION=session;process.env.MURAKUMO_UI_SOCKET=session+'/ui.sock';process.env.MURAKUMO_VOICE_SOCKET=session+'/voice.sock';
const gui=run(process.env.MURAKUMO_GJS,['/mnt/source/nixos/graphical-ui.js',process.execPath,'/mnt/source/test/voice-ui-backend.mjs'],{unprivileged:false,timeout:90000});child=gui.child;
gui.child.stderr.on('data',d=>process.stdout.write(d));gui.promise.catch(()=>{});
try{for(let i=0;i<90;i++){try{const result=await readFile(resultPath,'utf8');assert.ok(playbackFinished,'code playback reached its end');assert.ok(musicFinished,'requested music reached its end');await writeFile('/mnt/output/voice-ui-result.json',result);console.log(result);console.log('NATIVE_UI_PASS');break;}catch{}if(failure)throw failure;if(child.exitCode!==null)throw Error('Native UI exited early');if(i===89)throw Error('Native UI timed out');await new Promise(r=>setTimeout(r,1000));}}
finally{terminate(child);peer?.destroy();server.close();}
