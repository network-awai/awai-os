export const SERVICE='7c710100-8e98-4d7b-a9d1-5ec677086001';
export const INFO='7c710101-8e98-4d7b-a9d1-5ec677086001';
export const WRITE='7c710102-8e98-4d7b-a9d1-5ec677086001';
export const STATUS='7c710103-8e98-4d7b-a9d1-5ec677086001';
const enc=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function envelope(pair,ssid,password,cryptoAPI=globalThis.crypto){
  const material=await cryptoAPI.subtle.importKey('raw',unb64(pair.key),'HKDF',false,['deriveKey']);
  const key=await cryptoAPI.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode(pair.id),info:enc.encode('murakumo-ble-wifi-v1')},material,{name:'AES-GCM',length:256},false,['encrypt']);
  const iv=cryptoAPI.getRandomValues(new Uint8Array(12));
  const data=await cryptoAPI.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(pair.id)},key,enc.encode(JSON.stringify({op:'wifi',ssid,password})));
  return {v:1,id:pair.id,iv:b64(iv),data:b64(data)};
}
export async function provision(device,pair,ssid,password,onState=()=>{}){
  if(!pair||pair.v!==1||Date.now()>=pair.expires)throw Error('expired');
  const server=await device.gatt.connect();
  try{
    const service=await server.getPrimaryService(SERVICE),info=await service.getCharacteristic(INFO);
    const advertised=JSON.parse(new TextDecoder().decode(await info.readValue()));
    if(advertised?.id!==pair.id||advertised?.expires!==pair.expires)throw Error('wrong-device');
    const writer=await service.getCharacteristic(WRITE),status=await service.getCharacteristic(STATUS);
    const message=enc.encode(JSON.stringify(await envelope(pair,ssid,password))+'\n');password=null;
    for(let i=0;i<message.length;i+=20)await writer.writeValueWithResponse(message.slice(i,i+20));
    for(let i=0;i<75;i++){
      const state=JSON.parse(new TextDecoder().decode(await status.readValue())).state;onState(state);
      if(state==='connected')return true;if(['failed','closed','expired'].includes(state))throw Error('connection-failed');
      await new Promise(r=>setTimeout(r,1000));
    }
    throw Error('timeout');
  }finally{server.disconnect();}
}
