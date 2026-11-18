// Build-time artifact acquisition, never an inference fallback or app-origin API.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const manifest=await fs.readFile(path.join(root,'pins.json'));
const pin=JSON.parse(manifest).runtime;
const dir=path.join(root,'vendor');await fs.mkdir(dir,{recursive:true});
const file=path.join(dir,pin.file);
let bytes;try{bytes=await fs.readFile(file)}catch(e){if(e.code!=='ENOENT')throw e;const response=await fetch(pin.url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('speech artifact unavailable');bytes=Buffer.from(await response.arrayBuffer());}
if(bytes.length!==pin.bytes||createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('speech runtime artifact pin mismatch');
try{await fs.writeFile(file,bytes,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e;if(!(await fs.readFile(file)).equals(bytes))throw Error('speech artifact changed');}
await fs.mkdir(path.join(root,'android-assets'),{recursive:true});
await fs.writeFile(path.join(root,'android-assets/speech-pins.json'),manifest);
console.log('Verified sherpa-onnx 2.0.1 Android artifact; no inference executed');
