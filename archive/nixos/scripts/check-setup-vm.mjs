import {scoreJourneys,validateJourneyScore} from '../tests/journey-score.mjs';
import {spawnSync} from 'node:child_process';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const checks=['service-path','state-directory','timer','pairing','revocation'];
export function sourceDigest(dir=root){
  const hash=createHash('sha256');
  function walk(rel){for(const entry of readdirSync(join(dir,rel),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const name=rel+'/'+entry.name;
    if(entry.isDirectory())walk(name);
    else if(entry.isFile())hash.update(name+'\0').update(readFileSync(join(dir,name))).update('\0');
    else throw Error('unexpected source link: '+name);
  }}
  for(const directory of ['archive/nixos','scripts','ci'])walk(directory);
  return hash.digest('hex');
}
export function validateVMGate(proof, systemPath, expectedSource){
  if(proof?.schema!=='murakumo.release-vm-gate.v2'||proof.systemPath!==systemPath||
     !/^\/nix\/store\/[a-z0-9]{32}-nixos-system-[a-zA-Z0-9.+_-]+$/.test(systemPath)||
     (expectedSource!==undefined && proof.sourceSha256!==expectedSource)||
     !/^[a-f0-9]{64}$/.test(proof.sourceSha256)||!/^[a-f0-9]{40}$/.test(proof.nixpkgsRevision)||
     !/^\/nix\/store\/[a-z0-9]{32}-vm-test-run-murakumo-setup-services$/.test(proof.testPath)||
     !/^\/nix\/store\/[a-z0-9]{32}-vm-test-run-murakumo-kekkai-setup$/.test(proof.kekkaiTestPath)||
     !Array.isArray(proof.checks)||JSON.stringify(proof.checks)!==JSON.stringify([...checks,'reboot']))
    throw Error('missing or incompatible VM release gate');
  validateJourneyScore(proof.journeyScore);
  return proof;
}
export function runVMGate(nixpkgs, {systemPath, run=spawnSync, repo=root}={}){
  if(!nixpkgs)throw Error('pinned nixpkgs path required for VM gate');
  nixpkgs=resolve(nixpkgs);
  const command=(name,args)=>{
    const result=run(name,args,{cwd:repo,encoding:'utf8',maxBuffer:64*1024*1024,timeout:1800000,
      ...(name==='nix-build'?{stdio:['ignore','pipe','inherit']}:{})});
    if(result.status!==0)throw Error(`${name} VM gate failed: ${result.stderr||result.error?.message||result.stdout}`);
    return result.stdout.trim();
  };
  const version=command('nix-build',['--version']).match(/\(Nix\) (\d+)\.(\d+)/);
  if(!version || (+version[1]===2 && +version[2]<34) || +version[1]<2)
    throw Error('Nix 2.34 or newer required for the pinned VM configuration');
  let revision;
  try{revision=readFileSync(join(nixpkgs,'.git-revision'),'utf8').trim();}
  catch{if(existsSync(join(nixpkgs,'.git'))){
    revision=command('git',['-C',nixpkgs,'rev-parse','HEAD']);
    if(command('git',['-C',nixpkgs,'status','--porcelain']))throw Error('dirty nixpkgs');
  }else{
    if(command('nix-hash',['--type','sha256','--base32',nixpkgs])!=='11cw91q3r1nrlh3sc86n1jipgijy3njp3z9s3j0rwi6mi2adc6ki')throw Error('unpinned nixpkgs archive');
    revision='f5c082a40f7571c266e74e80ae2e68aadd8a9fc7';
  }}
  if(!/^[a-f0-9]{40}$/.test(revision))throw Error('immutable nixpkgs revision required');
  const digest=sourceDigest(repo);
  const production=JSON.parse(command('nix-instantiate',['--eval','--strict','--json','-I',`nixpkgs=${nixpkgs}`,
    '-I',`nixos-config=${repo}/nixos/offline-uefi.nix`,nixpkgs+'/nixos','-A','config.system.build.toplevel.outPath']));
  if(systemPath && production!==systemPath)throw Error('release system differs from VM-tested source and nixpkgs');
  const testPath=command('nix-build',[repo+'/nixos/tests/setup-services.nix','--arg','nixpkgs',nixpkgs,
    '--no-out-link','--option','max-jobs','1','--option','cores','2']);
  command('nix-store',['--verify-path',testPath]);
  const kekkaiTestPath=command('nix-build',[repo+'/nixos/tests/kekkai-setup.nix','--arg','nixpkgs',nixpkgs,
    '--no-out-link','--option','max-jobs','1','--option','cores','2']);
  command('nix-store',['--verify-path',kekkaiTestPath]);
  const kekkai=JSON.parse(readFileSync(join(kekkaiTestPath,'kekkai-ssh.json'),'utf8'));
  if(kekkai.schema!=='murakumo.kekkai-ssh-vm.v1'||['prePasskey','tlsPin','twoKeyApproval','singleApproval','realOverlaySSH','directLANBlocked','reboot','revoked'].some(k=>kekkai[k]!==true))
    throw Error('Kekkai SSH VM gate incomplete');
  const boots={};
  for(const boot of ['first-boot','second-boot']){
    const result=JSON.parse(readFileSync(join(testPath,boot,'ci-setup-result.json'),'utf8'));
    boots[boot]=result;
    if(result.schema!=='murakumo.setup-vm.v1'||JSON.stringify(result.checks)!==JSON.stringify(checks)||result.hardwareRecoveryQualified!==false||result.savedConsent!==(boot==='second-boot'))
      throw Error('VM gate output lacks successful boot assertions');
  }
  const gui=JSON.parse(readFileSync(join(testPath,'journey-gui.json'),'utf8'));
  if(['remoteAutoRefresh','singlePhysicalApproval','actualSSH'].some(k=>gui[k]!==true))throw Error('guided remote SSH GUI gate incomplete');
  const journeyScore=validateJourneyScore(scoreJourneys({first:boots['first-boot'],second:boots['second-boot'],gui}));
  if(sourceDigest(repo)!==digest)throw Error('source changed during VM gate');
  return validateVMGate({schema:'murakumo.release-vm-gate.v2',systemPath:production,
    sourceSha256:digest,nixpkgsRevision:revision,testPath,kekkaiTestPath,checks:[...checks,'reboot'],journeyScore},production);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(runVMGate(process.argv[2])));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
