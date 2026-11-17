const IDS={itonami:'network.itonami.app.qa',murakumo:'network.awai.murakumo.qa'};
export function assertQaPackages(packages){
 for(const [name,id] of Object.entries(IDS)){const p=packages?.[name];if(p?.id!==id||p.testOnly!==true||p.internet!==false||!/^[a-f0-9]{64}$/.test(p.sha256||''))throw Error('isolated-QA-packages-required');}
}
export function assertQaDevice({serial,mode,mac,qemu}){
 if(mode==='physical-6600h'&&serial==='10.77.0.2:5555'&&mac==='0c:47:a9:60:9d:34'&&qemu!=='1')return;
 if(mode==='owned-emulator'&&/^emulator-\d+$/.test(serial)&&qemu==='1')return;
 throw Error('explicit-QA-device-scope-required');
}
