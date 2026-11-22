#!/usr/bin/env node
// Bounded operator CI lane. No scheduling, release signing, Actions enablement or device deployment.
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const options=Object.fromEntries(process.argv.slice(2).map(x=>x.split('=')));
const sha=options['--revision'];if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('full expected revision required');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!==sha)throw Error('revision-mismatch');
if(git('status','--porcelain','--untracked-files=all','--','.',':(exclude).agent-output/**'))throw Error('dirty-source-refused');
const out=path.join(root,'.agent-output',`android-ci-${Date.now()}`);await mkdir(out,{recursive:true});
const result={schema:'awai.ci.android-operator.v1',revision:sha,startedAt:new Date().toISOString(),scope:'operator job on this Mac; not distributed quorum or GitHub Actions',steps:[],artifacts:{},status:'pending'};
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
function step(name,command,args,extra={}){
 const start=new Date().toISOString();const run=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,timeout:1200000,env:{...process.env,...extra}});
 const log=path.join(out,name+'.log');return writeFile(log,(run.stdout||'')+(run.stderr||'')+(run.error?.message||'')).then(()=>{
  result.steps.push({name,startedAt:start,endedAt:new Date().toISOString(),exitCode:run.status});
  if(run.status!==0)throw Error('step-failed: '+name);console.log('PASS',name);
 });
}
try{
 await step('shell-dependencies','npm',['ci','--ignore-scripts','--no-audit','--prefix','otehon/shell']);
 await step('source-regression','node',['--test','android/test/emulator-scope.test.mjs','otehon/shell/test/setup-state.test.js','otehon/shell/test/link.test.js','otehon/shell/test/device.test.js','otehon/shell/test/trust.test.js']);
 await step('rust-compile','rustc',['--edition=2021','--test','apps/itonami/src-tauri/src/setup_state.rs','-o',path.join(out,'setup-tests')]);
 await step('rust-regression',path.join(out,'setup-tests'),[],{AWAI_TEST_OUTPUT:out});
 await step('advanced-native-contract','npm',['run','test:inference','--prefix','otehon/shell']);
 await step('setup-screen-regression','npm',['run','test:setup','--prefix','otehon/shell']);
 await step('owning-shell','npm',['run','build','--prefix','otehon/shell'],{OTEHON_HTTP:'1'});
 await step('consumer-dependencies','npm',['ci','--ignore-scripts','--no-audit','--prefix','apps/itonami']);
 await step('consumer-frontend','npm',['run','package:frontend','--prefix','apps/itonami']);
 await step('consumer-apk','npm',['run','tauri','--prefix','apps/itonami','--','android','build','--apk','--target','aarch64','--debug']);
 const consumer=path.join(root,'apps/itonami/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk');result.artifacts.consumer=await hash(consumer);
 await step('provider-dependencies','npm',['ci','--ignore-scripts','--no-audit','--prefix','apps/murakumo']);
 await step('provider-native','python3',['apps/murakumo/scripts/build-native.py','arm64-v8a']);
 await step('provider-ui','npm',['run','build','--prefix','apps/murakumo']);
 await step('provider-contract','node',['--test','apps/murakumo/test/contract.test.mjs']);
 await step('provider-apk','npm',['run','tauri','--prefix','apps/murakumo','--','android','build','--apk','--target','aarch64','--debug']);
 const provider=path.join(root,'apps/murakumo/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk');result.artifacts.provider=await hash(provider);
 // PHI rule: the inference app's merged manifest requests no INTERNET (apps/murakumo/scripts/check-release.py).
 await step('provider-no-internet','python3',['apps/murakumo/scripts/check-release.py','--no-internet',provider]);
 if(!options['--model'])throw Error('pinned public model input required; no download fallback');result.artifacts.model=await hash(options['--model']);
 await step('immediate-stop-os-reboot-inference','node',['android/test/run-auth-emulator.mjs',`--apk=${consumer}`,`--provider=${provider}`,`--model=${path.resolve(options['--model'])}`,'--restart=abrupt']);
 const text=await readFile(path.join(out,'immediate-stop-os-reboot-inference.log'),'utf8');const reportPath=JSON.parse(text.slice(text.indexOf('{'))).report;
 const vm=JSON.parse(await readFile(reportPath,'utf8'));if(vm.status!=='passed'||!vm.cases.some(x=>x.name==='OS-reboot-relaunch-retains-native-completion-and-verified-account')||!vm.cases.some(x=>x.name==='completed-setup-never-authenticates-an-unlinked-account'))throw Error('missing-VM-acceptance');
 result.vmReport=path.relative(root,reportPath);result.vmCases=vm.cases;result.vmReportSha256=await hash(reportPath);
 if(git('rev-parse','HEAD')!==sha||git('diff','HEAD','--name-only'))throw Error('source-changed-during-run');
 result.status='success';
}catch(e){result.status='failure';result.error=e.message;process.exitCode=1;}finally{
 result.endedAt=new Date().toISOString();await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,report:path.join(out,'result.json')}));
}
