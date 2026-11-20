// Build-time distribution only, shared by the owning Awai apps. Never serves an API.
import {readFile,cp,mkdir,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';import path from'node:path';
const home=fileURLToPath(new URL('.',import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
export async function distributeUi(destination){
 const pins=JSON.parse(await readFile(path.join(home,'dist/integrity.json')));
 for(const [name,expected]of Object.entries(pins.files))if(hash(await readFile(path.join(home,name)))!==expected)throw Error('Awai UI artifact/source drift: '+name);
 const out=path.join(destination,'awai-ui');await mkdir(out,{recursive:true});await cp(path.join(home,'dist'),out,{recursive:true});
 await writeFile(path.join(out,'provenance.json'),JSON.stringify({schema:'awai.ui.consumer.v1',package:'@awai/ui',version:'0.2.0',files:pins.files},null,2)+'\n');
 return 'awai-ui/awai-ui.css';
}
