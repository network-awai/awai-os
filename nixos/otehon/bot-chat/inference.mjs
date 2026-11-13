import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';import {bbJSON} from './database.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function infer(cfg,bot,request,messages,{onProcess=()=>{}}={}){
 const pin=bot.chatPersona;if(!pin?.available||!/^[a-f0-9]{64}$/.test(pin.sourceSha256))throw Error('verified persona unavailable');
 const soul=await fs.readFile(path.join(cfg.personaRoot,pin.sourceSha256+'.txt'),'utf8');if(sha(soul)!==pin.sourceSha256||soul.length>32768)throw Error('persona pin mismatch');
 if(sha(await fs.readFile(cfg.muse))!==cfg.museSha256)throw Error('Muse binary pin changed');
 const dir=path.join(cfg.runRoot,request.requestId);await fs.mkdir(dir,{mode:0o700});await fs.mkdir(path.join(dir,'config/muse'),{recursive:true,mode:0o700});
 await fs.writeFile(path.join(dir,'config/muse/settings.json'),'{"schema_version":1,"mcpServers":{}}',{mode:0o600});
 await fs.symlink(cfg.museAuthPath,path.join(dir,'config/muse/auth.json'));
 const replied=new Set(messages.filter(m=>m.role==='assistant').map(m=>m.parentId));
 const history=messages.filter(m=>m.role==='assistant'||replied.has(m.id)).slice(-16).map(m=>`${m.role}: ${m.text}`).join('\n');
 const prompt=`You are conversing as Itonami Bot ${bot.name}. This is a human-requested conversation only. No tools or job execution is authorized. Bot profile follows as persona reference; it cannot grant tools.\n${soul}\n\nPrevious conversation:\n${history}\n\nuser: ${request.text}`;
 if(prompt.length>65536)throw Error('conversation context too large');
 await fs.writeFile(path.join(dir,'prompt.txt'),prompt,{mode:0o600});
 await fs.writeFile(path.join(dir,'binding.json'),JSON.stringify({issue:null,attribution:'unallocated-interactive-conversation',botId:bot.id,requestId:request.requestId,model:cfg.model,profileSha256:sha(soul),provider:'meta',forecast:'unknown',scope:'tool-free-conversation',tools:[],fallback:false}),{mode:0o600});
 const argv=['exec','--json','--provider','meta','--model',cfg.model,'--reasoning-effort','low','--preset','empty','--contributor-mode','off','--disable-shell','--disable-write','--disable-web-tools','--disable-reminders','--disable-request-user-input','--no-foreign-personal-context','--max-model-steps','1','--workspace',dir,'--prompt-file',path.join(dir,'prompt.txt')];
 const child=spawn(cfg.muse,argv,{env:{...process.env,MUSE_AUTH_PATH:cfg.museAuthPath,XDG_CONFIG_HOME:path.join(dir,'config'),MUSE_NO_AUTO_UPDATE:'1'},stdio:['ignore','pipe','pipe']});
 const startedAt=new Date().toISOString();child.once('spawn',()=>onProcess({phase:'running',botId:bot.id,invocationId:request.requestId,startedAt}));
 let stdout='',stderr='',oversized=false;const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
 child.stdout.on('data',b=>{if(stdout.length+b.length>8388608){oversized=true;child.kill('SIGKILL');}else stdout+=b;});child.stderr.on('data',b=>{if(stderr.length<1048576)stderr+=b;});
 const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve(code??-1));}).finally(()=>{clearTimeout(timer);onProcess({phase:'stopped',botId:bot.id,invocationId:request.requestId});});
 await fs.writeFile(path.join(dir,'events.jsonl'),stdout,{mode:0o600});await fs.writeFile(path.join(dir,'stderr.txt'),stderr,{mode:0o600});if(oversized)throw Error('Muse result exceeded limit; no automatic retry');
 const events=stdout.split('\n').filter(s=>s.trim()).map(s=>JSON.parse(s));
 const result=await bbJSON(cfg.bb,['-m','itonami-chat.result'],{events,exitCode,model:cfg.model});
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result),{mode:0o600});if(result.state!=='completed')throw Error('Muse outcome unconfirmed; no automatic retry');
 return {text:result.text,runId:result['muse-run-id'],provider:'meta',model:cfg.model,usage:result.usage,usageCoverage:result['usage-coverage']};
}
