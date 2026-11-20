// Qualification: known runtime and keyboard regressions must fail for their specific reason.
// Disposable copies only; never edits the checkout under review.
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),pin=process.argv[2];
if(!pin)throw Error('pinned nixpkgs path required');
const evidence=process.argv[3];
if(evidence)mkdirSync(evidence,{recursive:true});
const only=process.argv[4];
const mutations=[
  {name:'state-directory',file:'node-base.nix',expected:/(?:ENOENT|EROFS|EACCES).*aiueos-update/,
   change:s=>s.replace('StateDirectory = [ "murakumo" "aiueos-update" ];','StateDirectory = [ "murakumo" ];')},
  {name:'service-path',file:'remote-ui.mjs',expected:/hostname.*ENOENT|ENOENT.*hostname/,
   change:s=>"import {spawnSync} from 'node:child_process';\n"+s.replace(/export function remoteAddresses\(interfaces=networkInterfaces\)\{[\s\S]*?\n\}/,
    "export function remoteAddresses(){const r=spawnSync('hostname',['-I'],{encoding:'utf8'});if(r.error)throw r.error;return r.stdout.trim().split(/\\s+/);}\n")}
  ,{name:'escape-return',file:'graphical-ui.js',expected:/MURAKUMO-UX-ESC-FAIL/,
    change:s=>s.replace('active?.back?.();','/* mutation: Esc action omitted */')}
  ,{name:'menu-visibility',file:'graphical-ui.js',expected:/MURAKUMO-UX-MENU-FAIL/,
    change:s=>s.replace('min_content_height:240,','')}
];
if(only&&!mutations.some(m=>m.name===only))throw Error('unknown mutation: '+only);
for(const m of mutations.filter(m=>!only||m.name===only)){
  const dir=mkdtempSync(join(tmpdir(),'murakumo-vm-negative-'));
  try{
    cpSync(join(root,'archive/nixos'),join(dir,'archive/nixos'),{recursive:true});
    const path=join(dir,'archive/nixos',m.file),original=readFileSync(path,'utf8'),broken=m.change(original);
    if(original===broken)throw Error('regression mutation did not apply: '+m.name);
    writeFileSync(path,broken);
    const r=spawnSync('nix-build',[join(dir,'archive/nixos/tests/setup-services.nix'),'--arg','nixpkgs',resolve(pin),'--no-out-link','--option','max-jobs','1','--option','cores','2'],
      {encoding:'utf8',timeout:1800000,maxBuffer:64*1024*1024});
    const output=(r.stdout||'')+(r.stderr||'');
    if(evidence)writeFileSync(join(evidence,m.name+'.log'),output,{mode:0o600});
    if(r.status===0||!m.expected.test(output))throw Error('regression was not detected for its specific cause: '+m.name+'\n'+output);
    console.log('MURAKUMO-VM-NEGATIVE-PASS: '+m.name);
  }finally{rmSync(dir,{recursive:true,force:true});}
}
