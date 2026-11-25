// PXE installer artifact delivery. Same static, digest-pinned discipline
// as serve-artifacts.mjs (which serves kernel/initrd/ipxe.efi for the
// persistence profiles), plus the install image bytes the install init
// fetches unverified-at-rest but fully verified in the init before any
// write. No application API/state. Serves on the same 18091 port; the
// firmware route decides which artifact directory is active, so this
// never replaces the existing persistent/recovery entries by itself.
import http from 'node:http';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [root,manifestPath]=process.argv.slice(2);assert(root&&manifestPath);
assert.equal(await realpath(root),resolve(root),'Require a canonical artifact directory');
const manifest=JSON.parse(await readFile(manifestPath));
const files=new Map();
for(const name of ['kernel','initrd','ipxe.efi','install.img']){
 const p=resolve(root,name),s=await lstat(p);assert(s.isFile()&&!s.isSymbolicLink());
 const bytes=await readFile(p),pin=manifest.files[name];assert(pin&&pin.bytes===bytes.length&&pin.sha256===createHash('sha256').update(bytes).digest('hex'));files.set('/'+name,bytes);
}
http.createServer((req,res)=>{
 let url;try{url=new URL(req.url,'http://10.77.0.1:18091');}catch{res.writeHead(404);res.end();return;}
 const bytes=files.get(url.pathname);
 if(!['GET','HEAD'].includes(req.method)||url.search||!bytes){res.writeHead(404);res.end();return;}
 console.log(JSON.stringify({at:new Date().toISOString(),method:req.method,path:url.pathname,bytes:bytes.length}));
 res.writeHead(200,{'Content-Length':bytes.length,'Content-Type':'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
}).listen(18091,'10.77.0.1',()=>console.log('AWAI_INSTALL_STATIC_READY 10.77.0.1:18091'));
