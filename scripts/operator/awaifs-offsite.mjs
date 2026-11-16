// Explicit existing AwaiFS B2 adapter for operator archive publication/recovery.
// This process owns credentials; a CI guest receives only verified public bytes.
import cp from 'node:child_process';
const exec=(b,a,o={})=>cp.execFileSync(b,a,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...o});
export function offsite(plist){
 const v=JSON.parse(exec('/usr/bin/plutil',['-extract','EnvironmentVariables','json','-o','-',plist]));
 if(!v.AWAI_B2_KEY_ID||!v.AWAI_B2_APP_KEY||!v.AWAI_B2_BUCKET_NAME)throw Error('existing AwaiFS backend required');
 const prefix=[v.AWAI_B2_PREFIX,'operator-archives','awai-os-actions-20261116'].filter(Boolean).join('/');
 if(prefix.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('remote namespace refused');
 const root=`awaiarchive:${v.AWAI_B2_BUCKET_NAME}/${prefix}`;
 const env={...process.env,RCLONE_CONFIG_AWAIARCHIVE_TYPE:'b2',RCLONE_CONFIG_AWAIARCHIVE_ACCOUNT:v.AWAI_B2_KEY_ID,RCLONE_CONFIG_AWAIARCHIVE_KEY:v.AWAI_B2_APP_KEY};
 const call=args=>{try{return exec('rclone',[...args,'--retries','2','--low-level-retries','2','--contimeout','15s','--timeout','180s'],{env,timeout:1800000,maxBuffer:8*1024**2});}catch{throw Error('AwaiFS offsite copy refused');}};
 const key=k=>{if(!/^(recovery-root\.json|manifests\/sha256-[a-f0-9]{64}\.json)$/.test(k))throw Error('remote key refused');return root+'/'+k;};
 return {
  pull:(k,out)=>call(['copyto',key(k),out]),
  push:(file,k)=>call(['copyto',file,key(k),'--checksum',...(k==='recovery-root.json'?[]:['--immutable'])]),
  packs:(list,out)=>call(['copy',root+'/packs',out,'--files-from-raw',list,'--transfers','4','--checkers','4','--no-traverse'])
 };
}
