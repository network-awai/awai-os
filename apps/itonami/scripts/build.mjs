// Package the owning NixOS shell build; no second UI or consent implementation.
import {cp, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const app = fileURLToPath(new URL('../', import.meta.url));
const repo = path.resolve(app, '../..');
const shell = path.join(repo, 'nixos/otehon/shell');
const sha = b => createHash('sha256').update(b).digest('hex');
const pins = JSON.parse(await readFile(path.join(shell, 'vendor/PINS.json'), 'utf8'));
for (const [name,digest] of Object.entries(pins.files)) {
  if (sha(await readFile(path.join(shell,'vendor',name))) !== digest) throw Error('canonical broker digest mismatch: '+name);
}
const source = path.join(shell, 'dist');
const dest = path.join(app, 'dist');
async function files(root, rel='') {
  let result=[];
  for (const e of await readdir(path.join(root,rel),{withFileTypes:true})) {
    const name=path.join(rel,e.name);
    if(e.isSymbolicLink())throw Error('bundle symlink refused');
    if(e.isDirectory())result.push(...await files(root,name));
    else if(e.isFile())result.push(name);
    else throw Error('non-file bundle entry');
  }
  return result.sort();
}
const input=await files(source);
if(!input.includes('index.html') || !input.includes('assets/main.js'))throw Error('build owning Nix shell first');
await mkdir(dest,{recursive:true});
await cp(source,dest,{recursive:true});
const original=await readFile(path.join(dest,'index.html'),'utf8');
if(/__(CONNECT_SRC|SCRIPT_SRC|STYLE_SRC|IMAGE_SRC|DAPPS_JSON|RELAY_ORIGIN)__/.test(original))throw Error('unresolved shell template');
const html=original.replace(/(connect-src[^;"\n]*)/, '$1 ipc: http://ipc.localhost');
const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
if(!csp || !csp.includes("default-src 'none'") || !csp.includes("script-src 'self'"))throw Error('HTTP/self shell CSP required');
await writeFile(path.join(dest,'index.html'),html);
await writeFile(path.join(app,'src-tauri/tauri.android.conf.json'),JSON.stringify({app:{security:{csp:csp+"; object-src 'none'; base-uri 'none'; form-action 'none'"}}},null,2)+'\n');
const artifacts={};
for (const name of await files(dest)) if(name!=='itonami-bundle.json') {
  const b=await readFile(path.join(dest,name));artifacts[name]={bytes:b.length,sha256:sha(b)};
}
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const shellTree=execFileSync('git',['rev-parse','HEAD:nixos/otehon/shell'],{cwd:repo,encoding:'utf8'}).trim();
await writeFile(path.join(dest,'itonami-bundle.json'),JSON.stringify({schema:'awai.itonami.tauri-bundle.v1',revision,shellTree,broker:pins,ui:'nixos/otehon/shell/dist; unchanged composition',htmlChange:'local Tauri IPC CSP transport only',artifacts},null,2)+'\n');
console.log('Packaged owning NixOS shell:',Object.keys(artifacts).length,'files');
