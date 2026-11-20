// Stage only digest-pinned empty filesystem templates; never user data or format devices.
import {readFile,lstat,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const [input,output]=process.argv.slice(2);assert(input&&output);
const pins=JSON.parse(await readFile(new URL('./small-image-template-pins.json',import.meta.url)));
const staged=[];
for(const name of ['metadata','cache']){
 const path=resolve(input,name+'.4k.template'),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink());
 const bytes=await readFile(path),pin=pins[name];assert.equal(bytes.length,pin.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);
 staged.push({name,bytes,pin});
}
await mkdir(output,{mode:0o700});
for(const {name,bytes}of staged)await writeFile(resolve(output,name+'.4k.template'),bytes,{flag:'wx',mode:0o600});
await writeFile(resolve(output,'templates.sha256'),staged.map(x=>x.pin.sha256+'  '+x.name+'.4k.template\n').join(''),{flag:'wx',mode:0o600});
console.log(JSON.stringify({templates:staged.length,output}));
