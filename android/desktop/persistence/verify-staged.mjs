// Fixed operator restore staging root. Reads public markers and encrypted-block hashes only.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const [baseline,output]=process.argv.slice(2);assert(baseline&&output);
const prior=JSON.parse(readFileSync(baseline)),base='/mnt/awai-2992-restore/data/data/';
const shell=cmd=>execFileSync('adb',['-s','10.77.0.2:5555','shell','set -eu; set -o pipefail; '+cmd],{encoding:'utf8',timeout:30000}).trim();
assert.equal(shell('cat /sys/class/net/eth0/address'),'0c:47:a9:60:9d:34');
let files=0;
for(const app of prior.applications){
 assert(/^[a-z.]+$/.test(app.id));
 const p=base+app.id;
 assert.equal(shell('cat '+p+'/p2p/peer-identity-v1.initialized'),app.peer);
 assert.equal(shell('stat -c %a '+p+'/p2p/peer-identity-v1.key'),'600');
 shell('test -s '+p+'/p2p/peer-identity-v1.key');
 for(const file of app.files){assert(/^p2p\/store\/[a-z0-9/_.-]+$/.test(file.path)&&!file.path.includes('..'));assert.equal(shell('sha256sum '+p+'/'+file.path).split(/\s/)[0],file.sha256);files++;}
}
const result={schema:'awai.android.staged-restore.v1',checkedAt:new Date().toISOString(),peerMarkersMatched:prior.applications.length,encryptedFilesMatched:files,privateKeysExported:false,nativeKeyDerivationVerified:false,rebootVerified:false};
writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
