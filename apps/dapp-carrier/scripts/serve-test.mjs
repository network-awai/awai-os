// Development fixture: immutable files only, no app request handler.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('generated');
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
createServer(async(req,res)=>{
 try{if(!['GET','HEAD'].includes(req.method))throw Error('read-only');const url=new URL(req.url,'http://127.0.0.1');const segments=decodeURIComponent(url.pathname).split('/').filter(Boolean);if(segments.some(s=>!s||s==='..'||s.includes('\\')))throw Error('path');
 const key=segments[0]==='assets'?'aozora':segments.shift();if(!['aozora','dougaka','ongakuka','itonami','yataverse'].includes(key))throw Error('profile');const file=resolve(root,key,'dist',...segments);const path=(await stat(file)).isDirectory()?resolve(file,'index.html'):file;if(!path.startsWith(resolve(root,key,'dist')+'/'))throw Error('path');const bytes=await readFile(path);res.writeHead(200,{'content-type':types[extname(path)]??'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(404);res.end();}
}).listen(4179,'127.0.0.1');
