import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rows, networks, displayText, networkBackend, setupNetwork,usableAddress} from '../network-setup.mjs';

test('SSID delimiters and backslashes round trip; strongest duplicate wins', () => {
  assert.deepEqual(rows('home\\:lab:70:WPA2\nslash\\\\net:80:--'),[['home:lab','70','WPA2'],['slash\\net','80','--']]);
  assert.deepEqual(networks('home:20:WPA2\nhome:90:WPA2\n:99:WPA2\nopen:70:--').map(n => [n.ssid,n.signal]),[['home',90],['open',70]]);
  assert.ok(!displayText('bad\u001b[31m\n\\Z1').includes('\u001b'));
  assert.ok(!displayText('\\Z1').includes('\\'));
});
test('Wi-Fi secrets go to stdin, never command arguments; failures do not expose output', () => {
  let call;
  const backend = networkBackend((...args) => {call=args;return {status:10,stdout:'private',stderr:'private'};});
  assert.equal(backend.connectWifi('wlan0','home:lab','fixture-secret'),false);
  assert.ok(!call[1].join(' ').includes('fixture-secret'));
  assert.equal(call[2].input,'fixture-secret\n');
  assert.ok(call[1].includes('home:lab'));
});
function fixture(choices, devices = [], overrides = {}) {
  const messages=[];const calls=[];
  const ui={menu:(message,items)=>{messages.push(message);const next=choices.shift();assert.ok(next === null || items.some(i=>i[0] === next),`invalid choice ${next}`);return next;},
    message:m=>messages.push(m),busy:m=>messages.push(m),password:()=> 'fixture-secret',input:()=> 'hidden-home'};
  const backend={devices:()=>devices,scan:()=>[{ssid:'home',signal:80,security:'WPA2'}],
    connectWifi:(...args)=>{calls.push(args);return true;},connectWired:()=>true,probe:async()=>({internet:true,murakumo:true}),...overrides};
  return {ui,backend,messages,calls};
}
test('no NIC and Wi-Fi missing remain actionable and can finish installation offline',async()=>{
  const f=fixture(['wifi','later']);
  assert.equal(await setupNetwork(f),'offline');
  assert.ok(f.messages.some(m=>m.includes('No Wi-Fi adapter')));
});
test('a saved connection skips both password entry and the network chooser',async()=>{
  const f=fixture([],[{name:'wlan0',type:'wifi',connected:true}]);
  f.ui.menu=()=>{throw Error('saved connection must skip chooser');};
  assert.equal(await setupNetwork(f),'connected');assert.equal(f.calls.length,0);
});
test('Wi-Fi failure returns to method selection and a second attempt succeeds',async()=>{
  let attempts=0;
  const f=fixture(['wifi','0','wifi','0','next'],[{name:'wlan0',type:'wifi',connected:false}],{connectWifi:()=> ++attempts === 2});
  assert.equal(await setupNetwork(f),'connected');assert.equal(attempts,2);
});
test('LAN association without Internet must not be presented as ready for registration',async()=>{
  const f=fixture(['wired','later'],[{name:'eth0',type:'ethernet',connected:false}],{probe:async()=>({internet:false,murakumo:false})});
  assert.equal(await setupNetwork({...f,stage:'installed'}),'offline');
  assert.ok(f.messages.some(m=>m.includes('Internet: not confirmed')));
});
test('cancel Wi-Fi selection returns without connecting or erasing',async()=>{
  const f=fixture(['wifi',null,'later'],[{name:'wlan0',type:'wifi',connected:false}]);
  assert.equal(await setupNetwork(f),'offline');assert.equal(f.calls.length,0);
});
test('TLS/captive probe failure is not reported as successful connectivity',async()=>{
  const backend=networkBackend(()=>({status:0}),async()=>{throw Error('offline');});
  assert.deepEqual(await backend.probe(),{internet:false,murakumo:false});
});

test('saved connection that becomes ready at the chooser skips scanning and secrets',async()=>{
  let checks=0;
  const f=fixture(['wifi','next'],[],{devices:()=>[{name:'wlan0',type:'wifi',connected:++checks > 1}],scan:()=>{throw Error('must not scan');}});
  assert.equal(await setupNetwork(f),'connected');assert.equal(f.calls.length,0);
});

test('Bluetooth success closes its pairing window and checks Internet before proceeding',async()=>{
  const events=[];const f=fixture(['bluetooth','next'],[],{bluetoothAvailable:()=>true,bluetoothStart:()=>{events.push('start');return true;},bluetoothStop:()=>events.push('stop'),probe:async()=>{events.push('probe');return {internet:true,murakumo:true};}});
  f.ui.bluetooth=()=>{events.push('companion');return true;};
  assert.equal(await setupNetwork(f),'connected');assert.deepEqual(events,['start','companion','stop','probe']);
});
test('Bluetooth cancellation closes its pairing window and offers offline completion',async()=>{
  let stopped=false;const f=fixture(['bluetooth','later'],[],{bluetoothAvailable:()=>true,bluetoothStart:()=>true,bluetoothStop:()=>{stopped=true;},probe:()=>{throw Error('no connection');}});
  f.ui.bluetooth=()=>false;assert.equal(await setupNetwork(f),'offline');assert.equal(stopped,true);
});
test('back from Wi-Fi password returns to the SSID list without connecting',async()=>{const f=fixture(['wifi','0',null,'later'],[{name:'wlan0',type:'wifi',connected:false}]);f.ui.password=()=>null;assert.equal(await setupNetwork(f),'offline');assert.equal(f.calls.length,0);});
test('back from hidden password returns to SSID input before returning to the list',async()=>{const f=fixture(['wifi','hidden',null,'later'],[{name:'wlan0',type:'wifi',connected:false}]);let inputs=0;f.ui.input=()=>++inputs===1?'hidden-home':null;f.ui.password=()=>null;assert.equal(await setupNetwork(f),'offline');assert.equal(inputs,2);assert.equal(f.calls.length,0);});
test('back on installer network chooser never implies consent to install offline',async()=>{const f=fixture([null,'later']);assert.equal(await setupNetwork(f),'offline');assert.equal(f.messages.filter(m=>m.includes('Ethernet is optional')).length,2);});
test('back on installed network chooser returns to parent without claiming completion',async()=>{const f=fixture([null]);assert.equal(await setupNetwork({...f,stage:'installed'}),'back');assert.equal(f.calls.length,0);});
test('installed LAN-only connection skips setup without claiming Internet',async()=>{const result=await setupNetwork({stage:'installed',ui:{busy:()=>{},menu:()=>{throw Error('connected LAN must skip chooser');}},backend:{devices:()=>[{connected:true}],probe:async()=>({internet:false,murakumo:false})}});assert.equal(result,'local-connected');});
test('explicit network settings remain accessible on a connected Node',async()=>{const f=fixture(['later'],[{name:'eth0',type:'ethernet',connected:true}],{probe:async()=>({internet:false,murakumo:false})});assert.equal(await setupNetwork({...f,autoProceed:false}),'offline');});
test('wired startup activates only a managed adapter with physical carrier',()=>{
 const calls=[];const b=networkBackend((_p,args)=>{calls.push(args);if(args.includes('DEVICE,TYPE,STATE'))return {stdout:'eth0:ethernet:disconnected\neth1:ethernet:disconnected\neth2:ethernet:unmanaged\nwlan0:wifi:disconnected'};if(args.includes('WIRED-PROPERTIES.CARRIER'))return {stdout:args.at(-1)==='eth0'?'on\n':'off\n'};return {status:0};});b.autoWired();assert.deepEqual(calls.filter(a=>a.includes('connect')).map(a=>a.at(-1)),['eth0']);
});
test('link-local, loopback and missing addresses cannot skip network setup',()=>{for(const ip of ['','127.0.0.1/8','169.254.1.2/16','::','::1','fe80::1/64','ff02::1'])assert.equal(usableAddress(ip),false,ip);for(const ip of ['192.168.1.20/24','10.0.2.15/24','fd00::2/64','2001:db8::1/64'])assert.equal(usableAddress(ip),true,ip);});
test('service failure is distinct from an Internet outage and setup health works when legacy probes fail',async()=>{
 const backend=networkBackend(()=>({status:0}),async url=>{if(!url.includes('setup.murakumo.cloud'))throw Error('filtered');return {status:503,ok:false};});assert.deepEqual(await backend.probe(),{internet:true,murakumo:false});
});
