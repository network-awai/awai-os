// Exact digest-pinned regular-file extraction from concatenated newc archives.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [input,name,digest,output]=process.argv.slice(2);
assert(input&&/^[a-zA-Z0-9/._-]+$/.test(name)&&!name.split('/').includes('..')&&/^[a-f0-9]{64}$/.test(digest)&&output);
const b=await readFile(input);let offset=0,matches=[];
while(offset<b.length){
 while(offset<b.length&&b[offset]===0)offset++;
 if(offset===b.length)break;
 const magic=b.toString('ascii',offset,offset+6);assert(['070701','070702'].includes(magic),'Unsupported/truncated cpio');
 const field=n=>{const s=b.toString('ascii',offset+6+n*8,offset+14+n*8);assert(/^[a-fA-F0-9]{8}$/.test(s));return parseInt(s,16);};
 const mode=field(1),size=field(6),namesize=field(11);assert(namesize>=1&&namesize<=4096);
 const start=offset+110,end=start+namesize;assert(end<=b.length&&b[end-1]===0);
 const entry=b.toString('utf8',start,end-1).replace(/^\.\//,''),data=(end+3)&~3,next=(data+size+3)&~3;assert(next<=b.length);
 if(entry===name){assert((mode&0o170000)===0o100000);matches.push(b.subarray(data,data+size));}
 offset=next;
}
assert.equal(matches.length,1,'Require one exact input');assert.equal(createHash('sha256').update(matches[0]).digest('hex'),digest);
await writeFile(output,matches[0],{flag:'wx',mode:0o700});console.log(JSON.stringify({entry:name,bytes:matches[0].length,sha256:digest}));
