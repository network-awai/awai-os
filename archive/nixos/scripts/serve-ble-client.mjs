import http from 'node:http';import fs from 'node:fs';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),port=8765;
const routes={'/':'ble-setup.html','/ble-client.mjs':'ble-client.mjs','/murakumo-logo.svg':'murakumo-logo.svg'};
const pairFile=process.argv[2];
http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host)||req.method!=='GET'||(req.headers.origin&&!['http://localhost:'+port,'http://127.0.0.1:'+port].includes(req.headers.origin))){res.writeHead(403).end();return;}
  if(req.url==='/pair'&&pairFile){try{const pair=JSON.parse(fs.readFileSync(pairFile));if(Date.now()>=pair.expires)throw Error();res.setHeader('Content-Type','text/plain');res.end(Buffer.from(JSON.stringify(pair)).toString('base64url'));}catch{res.writeHead(404).end();}return;}
  const file=routes[req.url];if(!file){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.mjs')?'text/javascript; charset=utf-8':'image/svg+xml');res.end(fs.readFileSync(root+file));
}).listen(port,'127.0.0.1',()=>console.log('Bluetooth companion: http://localhost:8765/'));
