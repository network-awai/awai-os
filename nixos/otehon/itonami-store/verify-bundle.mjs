import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(process.argv[2]);
const manifest=JSON.parse(readFileSync(join(root,'bundle-manifest.json'),'utf8'));
if(manifest.schema!=='awai.shared-web.v1'||!manifest.files)throw Error('invalid bundle manifest');
const expected=new Set(Object.keys(manifest.files));
for(const required of ['index.html','client.js','domain.js','catalog-data.js','runtime.js'])if(!expected.has(required))throw Error('missing required asset');
for(const [name,hash] of Object.entries(manifest.files)){
  if(!/^[a-zA-Z0-9_./-]+$/.test(name)||name.startsWith('/')||name.split('/').some(x=>x==='..'||x==='.'||x==='')||!/^([0-9a-f]{64})$/.test(hash))throw Error('unsafe bundle path or digest');
  const file=join(root,name);if(!lstatSync(file).isFile())throw Error('asset is not a regular file');
  if(createHash('sha256').update(readFileSync(file)).digest('hex')!==hash)throw Error('asset digest mismatch: '+name);
}
function walk(dir,prefix=''){for(const item of readdirSync(dir,{withFileTypes:true})){
  const name=prefix+item.name;if(item.isSymbolicLink())throw Error('symlink refused');
  if(item.isDirectory())walk(join(dir,item.name),name+'/');
  else if(name!=='bundle-manifest.json'&&!expected.has(name))throw Error('undeclared asset: '+name);
}}
walk(root);console.log('verified '+expected.size+' static assets');
