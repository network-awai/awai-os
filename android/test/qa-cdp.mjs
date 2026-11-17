export async function connectCdp(adb,pkg,until){
 const pid=await until(()=>adb('shell','pidof',pkg),'QA WebView PID');
 const check=()=>{const name=adb('shell','cat',`/proc/${pid}/cmdline`).replaceAll('\0','').trim();if(name!==pkg)throw Error('QA process mismatch');};check();
 const port=adb('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`);
 const target=await until(async()=>{const a=await(await fetch(`http://127.0.0.1:${port}/json`,{signal:AbortSignal.timeout(4000)})).json();return a.find(x=>x.type==='page')},'QA CDP');
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();
 ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id)pending.get(r.id)?.(r)};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},30000);pending.set(id,r=>{clearTimeout(t);pending.delete(id);r.error?reject(Error(JSON.stringify(r.error))):resolve(r.result)});ws.send(JSON.stringify({id,method,params}));});
 const read=async expression=>{check();const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 const click=async selector=>{const box=await read(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.getBoundingClientRect().width&&x.getBoundingClientRect().height);if(!e)throw Error('visible control missing');const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...box,button:'left',clickCount:1});};
 return {read,click,call,close(){ws.close();try{adb('forward','--remove',`tcp:${port}`)}catch{}}};
}
