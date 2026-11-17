import {readFileSync,writeFileSync,cpSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const [grant,nbb]=process.argv.slice(2);if(!grant||!nbb)throw Error('grant checkout and pinned nbb checkout required');
const out=resolve('archive/nixos/update-policy-runtime');mkdirSync(out,{recursive:true});
const revision=execFileSync('git',['-C',nbb,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(revision!=='95ff779a659dbb344ab87017908c0acba4300b87')throw Error('unreviewed runtime revision');
for(const name of ['nbb_core.js','nbb_api.js']){let s=readFileSync(join(nbb,'lib',name),'utf8');if(name==='nbb_api.js')s=s.replaceAll('"import-meta-resolve"','"./resolver/index.js"');writeFileSync(join(out,name),s);}
cpSync(join(nbb,'node_modules/import-meta-resolve'),join(out,'resolver'),{recursive:true});
cpSync(join(nbb,'LICENSE'),join(out,'nbb-LICENSE'));
const source=readFileSync(join(grant,'src/grant/update_lifecycle.cljk'),'utf8');
writeFileSync(join(out,'policy-source.json'),JSON.stringify({runtimeRevision:revision,sourceSha256:createHash('sha256').update(source).digest('hex'),source}));
writeFileSync(join(out,'package.json'),' {"type":"module"}\n');
