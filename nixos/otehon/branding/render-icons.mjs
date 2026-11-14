// Regenerate Otehon's bundled PNG and macOS launcher icon on a Mac.
// This tool is not called by the Nix image build or the app runtime.
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const source=path.join(here,'awai-logo.png');
const expected='35505dc7b418621ab7a3b11ba4d2085da0cbc265613795d034091a3bd15c533f';
if(createHash('sha256').update(readFileSync(source)).digest('hex')!==expected)throw Error('Selected-logo source digest differs');
const iconset=path.resolve(here,'../../../.agent-output/awai.iconset');
mkdirSync(iconset,{recursive:true});
function run(command,args){const r=spawnSync(command,args,{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(`${command} failed: ${r.status}`);}
function resize(size,destination){run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',source,'-vf',`scale=${size}:${size}:flags=lanczos,format=rgb24`,'-frames:v','1','-update','1',destination]);}
resize(512,path.resolve(here,'../shell/assets/awai-logo.png'));
for(const size of [16,32,128,256,512])for(const scale of [1,2])resize(size*scale,path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`));
run('iconutil',['-c','icns','-o',path.resolve(here,'../macos-app/awai.icns'),iconset]);
console.log('Generated Otehon logo PNG and macOS launcher ICNS.');
