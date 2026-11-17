// Dedicated loopback-only VM fixture. NOT a production storage service.
import https from'node:https';import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';
const [root,key,cert]=process.argv.slice(2);if(!root||!key||!cert)throw Error('fixture root/key/cert required');fs.mkdirSync(root,{recursive:true,mode:0o700});
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');const counts={put:0,get:0,options:0};
https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://tauri.localhost');res.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');res.setHeader('Access-Control-Allow-Headers','content-type');res.setHeader('Cache-Control','no-store');
 const match=/^\/awai-drive\/v1\/packs\/([a-f0-9]{64})$/.exec(req.url);if(!match){res.writeHead(404).end();return;}
 try{if(req.method==='OPTIONS'){counts.options++;res.writeHead(204).end();return;}
 const id=match[1],file=path.join(root,id+'.car');const modeFile=path.join(root,'fault.txt');const fault=fs.existsSync(modeFile)?fs.readFileSync(modeFile,'utf8').trim():'';
 if(req.method==='PUT'){counts.put++;let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw Error('oversized');chunks.push(chunk);}const b=Buffer.concat(chunks);if(digest(b)!==id)throw Error('digest');
 if(fault==='write-failure'){res.writeHead(503).end();return;}if(!fs.existsSync(file)){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dir=fs.openSync(root,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
 else if(digest(fs.readFileSync(file))!==id)throw Error('existing mismatch');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sha256:id,bytes:b.length}));return;}
 if(req.method==='GET'){counts.get++;if(fault==='missing'||!fs.existsSync(file)){res.writeHead(404).end();return;}let b=fs.readFileSync(file);if(fault==='corrupt'){b=Buffer.from(b);b[b.length-1]^=1;}if(fault==='truncated')b=b.subarray(0,b.length-1);res.setHeader('Content-Type','application/vnd.ipld.car');res.end(b);return;}
 res.writeHead(405).end();
 }catch{res.writeHead(400).end();}finally{fs.writeFileSync(path.join(root,'counts.json'),JSON.stringify(counts));}
}).listen(18463,'127.0.0.1',()=>console.log('owned VM ciphertext fixture listening on loopback:18463'));
