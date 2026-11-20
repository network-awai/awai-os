import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const source=readFileSync(new URL('../remote-client.js',import.meta.url),'utf8');
function browser(responses){const nodes=new Map(),calls=[],timers=[];const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,textContent:''});return nodes.get(id);};
 vm.runInNewContext(source,{document:{getElementById:el},fetch:async(path,request)=>{calls.push({path,body:JSON.parse(request.body)});const reply=responses.shift();assert.equal(path,reply.path);return {ok:!reply.error,json:async()=>reply.error?{error:reply.error}:reply.value};},setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout:()=>{}});
 el('controls').hidden=true;el('name').value='My Mac';el('code').value='12345678';el('key').value='ssh-ed25519 PUBLIC';return {el,calls,timers};
}
test('browser submits code and SSH public key together then waits for activation before showing success',async()=>{
 const b=browser([{path:'/pair',value:{ticket:'private-ticket'}},{path:'/poll',value:{state:'pending'}},{path:'/poll',value:{state:'approved',sshReady:false}},{path:'/poll',value:{state:'approved',sshReady:true}},{path:'/status',value:{host:'node',os:'NixOS',memory:{available:1024}}}]);
 await b.el('pair').onclick();assert.equal(b.calls[0].body.key,'ssh-ed25519 PUBLIC');assert.equal(b.el('code').value,'');assert.equal(b.el('controls').hidden,true);
 assert.match(b.el('message').textContent,/一度/);
 await b.timers.shift()();assert.match(b.el('message').textContent,/準備/);
 await b.timers.shift()();assert.match(b.el('message').textContent,/接続できました/);assert.match(b.el('ssh-result').textContent,/有効/);assert.ok(!b.calls.some(c=>c.path==='/ssh'));
});
test('expired browser approval returns to editable input with a specific recovery action',async()=>{
 const b=browser([{path:'/pair',value:{ticket:'ticket'}},{path:'/poll',error:'expired'}]);await b.el('pair').onclick();assert.equal(b.el('pair').disabled,false);assert.equal(b.el('pairing').hidden,false);assert.equal(b.el('controls').hidden,true);assert.match(b.el('message').textContent,/新しいコード/);
});
