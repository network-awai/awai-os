// Actual runtime configuration with a per-session key; never uses account credentials.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {run,terminate,modelClient} from '../voice-agent.mjs';
const [program,model,result]=process.argv.slice(2),dir=await mkdtemp('/tmp/aiueos-voice-key-'),key=randomUUID();
await writeFile(dir+'/key',key,{mode:0o600});
const server=run(program,['-m',model,'--host','127.0.0.1','--port','19089','--api-key-file',dir+'/key','--ctx-size','2048','--threads','2','--parallel','1','--cache-ram','0','-ngl','0'],{unprivileged:false,timeout:120000});server.promise.catch(()=>{});
try {
 let ready=false,health;
 for(let i=0;i<120;i++){assert.equal(server.child.exitCode,null);try{health=await fetch('http://127.0.0.1:19089/health');if(health.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 assert.ok(ready,'actual protected server health is available without disclosing the key');
 const denied=await fetch('http://127.0.0.1:19089/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'local',messages:[{role:'user',content:'Wi-Fi'}]})});assert.equal(denied.status,401);
 const response=await modelClient({url:'http://127.0.0.1:19089',key})({language:'ja',screen:{kind:'menu',message:'接続方法を選ぶ',choices:[{id:'wifi',label:'Wi-Fi'},{id:'wired',label:'Ethernet'}]},utterance:'Wi-Fiにつなぎたいです'});assert.equal(response.action,'choose');assert.equal(response.choice,'wifi');
 await writeFile(result,JSON.stringify({actualProtectedServer:true,healthStatus:health.status,unauthenticatedStatus:denied.status,authorizedAction:response.choice,physicalMicrophone:false},null,2));console.log('ACTUAL_MODEL_KEY_GUARD_PASS');
}finally{terminate(server.child);await rm(dir,{recursive:true,force:true});}
