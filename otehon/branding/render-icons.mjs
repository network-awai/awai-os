// Regenerate Otehon's bundled shell logo PNG.
// This tool is not called by the Nix image build or the app runtime.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const shellSource=path.join(here,'awai-logo.png');
const desktopSource=path.join(here,'awai-desktop-logo.png');
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const shellExpected='35505dc7b418621ab7a3b11ba4d2085da0cbc265613795d034091a3bd15c533f';
const desktopExpected='4637ce4a054ea77ddf427889b2eff1b54c71df380aec4bd4cdea3ad8095f6fef';
if(digest(shellSource)!==shellExpected||digest(desktopSource)!==desktopExpected)throw Error('Selected-logo source digest differs');
function run(command,args){const r=spawnSync(command,args,{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(`${command} failed: ${r.status}`);}
function resize(source,size,destination){run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',source,'-vf',`scale=${size}:${size}:flags=lanczos,format=rgb24`,'-frames:v','1','-update','1',destination]);}
resize(shellSource,512,path.resolve(here,'../shell/assets/awai-logo.png'));
console.log('Generated Otehon logo PNG.');
