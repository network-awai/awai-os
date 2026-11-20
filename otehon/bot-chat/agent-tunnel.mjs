// Bounded operator network transport. TLS remains end-to-end; no HTTP bodies or owner headers are created here.
import http from'node:http';import net from'node:net';import{execFileSync}from'node:child_process';import{pathToFileURL}from'node:url';
export const authority='21mbp.tail110d8b.ts.net:8443';
export const admitted=(method,target,peer)=>method==='CONNECT'&&target===authority&&peer==='10.77.0.2';
export function startTunnel(self){if(self.DNSName!=='21mbp.tail110d8b.ts.net.'||!self.Online)throw Error('selected Tailnet node unavailable');const ip=self.TailscaleIPs.find(x=>net.isIPv4(x));if(!ip||!ip.startsWith('100.'))throw Error('invalid Tailnet address');
 const server=http.createServer((req,res)=>{res.writeHead(403);res.end('CONNECT only');});server.headersTimeout=10000;server.maxHeadersCount=16;
 server.on('connect',(req,client,head)=>{if(!admitted(req.method,req.url,client.remoteAddress)){client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}const upstream=net.connect({host:ip,port:8443});upstream.setTimeout(180000);client.setTimeout(180000);const close=()=>{upstream.destroy();client.destroy()};upstream.on('error',close);client.on('error',close);upstream.on('timeout',close);client.on('timeout',close);client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());upstream.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});});
 server.listen(10844,'10.77.0.1',()=>console.log('Bounded Agent TLS tunnel ready; exact wired peer/authority; no payload logging'));return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const status=JSON.parse(execFileSync('/opt/homebrew/bin/tailscale',['status','--json'],{encoding:'utf8',timeout:10000}));startTunnel(status.Self);}
