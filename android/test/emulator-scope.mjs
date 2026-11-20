/** Fail before ADB mutation on physical devices, shared AVDs or unowned state. */
export function assertDisposableScope({serial,name,expectedName,qemu,hardware,marker,root}){
 if(!/^emulator-\d+$/.test(serial)||name!==expectedName||!/^Awai_Regression_/.test(name)||qemu!=='1'||!['ranchu','goldfish'].includes(hardware)||marker?.schema!=='awai.disposable-emulator.v1'||marker.serial!==serial||marker.name!==name||marker.root!==root)throw Error('disposable-emulator-scope-required');
}
