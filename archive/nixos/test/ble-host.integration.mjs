// Run as root on the explicitly selected Ubuntu host. Uses its existing Wi-Fi
// credentials only to reconnect to the same SSID through the live controller.
// This is an IPC/backend test, not proof of a Bluetooth radio transfer.
import fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {request} from '/usr/local/lib/murakumo-ble/ble-controller.mjs';
import {envelope} from '../ble-client.mjs';import {webcrypto} from 'node:crypto';
const ssid='NSD1K-B8A0-a';
const raw=spawnSync('python3',['-c','import yaml,json; d=yaml.safe_load(open("/etc/netplan/90-murakumo-wifi.yaml")); print(json.dumps(d["network"]["wifis"]["wlp2s0"]["access-points"]["NSD1K-B8A0-a"]["password"]))'],{encoding:'utf8'});
assert.equal(raw.status,0,'saved credential is readable');
const secret=JSON.parse(raw.stdout);assert.equal(typeof secret,'string','expected fixture credential encoding');
await request({op:'start'});const pair=JSON.parse(fs.readFileSync('/run/murakumo-ble/pair.json'));
const encrypted=JSON.stringify(await envelope(pair,ssid,secret,webcrypto))+'\n';
let accepted;for(let i=0;i<encrypted.length;i+=20)accepted=await request({op:'frame',peer:'/org/bluez/hci0/dev_IPC_FIXTURE',chunk:encrypted.slice(i,i+20)});
assert.equal(accepted.state,'connecting');assert.equal((await request({op:'frame',peer:'/org/bluez/hci0/dev_IPC_FIXTURE',chunk:encrypted})).error,'refused');
let result;for(let i=0;i<90;i++){result=await request({op:'status'});if(result.state!=='connecting')break;await new Promise(r=>setTimeout(r,1000));}
assert.equal(result.state,'connected','live network backend connected');assert.equal(await request({op:'info'}),null);
assert.equal(fs.existsSync('/run/murakumo-ble/pair.json'),false,'consumed pairing secret removed');
console.log(JSON.stringify({liveController:true,webCrypto:true,fragmentedTransfer:true,replayRefused:true,wifiConnected:true,bluetoothRadioTransfer:false,credentialsPrinted:false}));
