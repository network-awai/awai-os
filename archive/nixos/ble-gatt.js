#!/usr/bin/env gjs
const {Gio,GLib}=imports.gi,ByteArray=imports.byteArray;
const SERVICE='7c710100-8e98-4d7b-a9d1-5ec677086001',INFO='7c710101-8e98-4d7b-a9d1-5ec677086001',WRITE='7c710102-8e98-4d7b-a9d1-5ec677086001',STATUS='7c710103-8e98-4d7b-a9d1-5ec677086001';
const bus=Gio.DBus.system,base='/cloud/murakumo/ble',loop=new GLib.MainLoop(null,false),exports=[];
const socket=(GLib.getenv('MURAKUMO_BLE_DIR')||'/run/murakumo-ble')+'/control.sock';
function controller(value){const c=new Gio.SocketClient().connect(new Gio.UnixSocketAddress({path:socket}),null);try{c.get_output_stream().write_all(ByteArray.fromString(JSON.stringify(value)+'\n'),null);const [line]=new Gio.DataInputStream({base_stream:c.get_input_stream()}).read_line_utf8(null);return JSON.parse(line);}finally{c.close(null);}}
function call(path,iface,method,args,done){bus.call('org.bluez',path,iface,method,args,null,Gio.DBusCallFlags.NONE,10000,null,(b,r)=>{try{b.call_finish(r);done?.();}catch(e){printerr('BLE D-Bus operation failed: '+method+' '+e.message);changing=false;if(method==='RegisterApplication')loop.quit();}});}
function expose(path,xml,object){const e=Gio.DBusExportedObject.wrapJSObject(xml,object);e.export(bus,path);exports.push(e);}
const objects=bus.call_sync('org.bluez','/','org.freedesktop.DBus.ObjectManager','GetManagedObjects',null,null,Gio.DBusCallFlags.NONE,5000,null).deep_unpack()[0];
const adapter=Object.keys(objects).find(p=>objects[p]['org.bluez.GattManager1']&&objects[p]['org.bluez.LEAdvertisingManager1']);if(!adapter)throw Error('No BLE peripheral adapter');
const owner=bus.call_sync('org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus','GetNameOwner',new GLib.Variant('(s)',['org.bluez']),null,Gio.DBusCallFlags.NONE,5000,null).deep_unpack()[0];
const managed={};
function property(iface,path,values){managed[path]={[iface]:values};}
property('org.bluez.GattService1',base+'/service',{UUID:new GLib.Variant('s',SERVICE),Primary:new GLib.Variant('b',true)});
expose(base+'/service','<node><interface name="org.bluez.GattService1"><property name="UUID" type="s" access="read"/><property name="Primary" type="b" access="read"/></interface></node>',{UUID:SERVICE,Primary:true});
for(const [name,uuid,flags] of [['info',INFO,['read']],['write',WRITE,['write']],['status',STATUS,['read']]]){
 const path=base+'/service/'+name;
 property('org.bluez.GattCharacteristic1',path,{UUID:new GLib.Variant('s',uuid),Service:new GLib.Variant('o',base+'/service'),Flags:new GLib.Variant('as',flags)});
 expose(path,'<node><interface name="org.bluez.GattCharacteristic1"><property name="UUID" type="s" access="read"/><property name="Service" type="o" access="read"/><property name="Flags" type="as" access="read"/><method name="ReadValue"><arg type="a{sv}" direction="in"/><arg type="ay" direction="out"/></method><method name="WriteValue"><arg type="ay" direction="in"/><arg type="a{sv}" direction="in"/></method></interface></node>',{
  UUID:uuid,Service:base+'/service',Flags:flags,
  ReadValueAsync([options],inv){try{if(name==='write')throw Error();const bytes=ByteArray.fromString(JSON.stringify(controller({op:name==='info'?'info':'status'})));const offset=options.offset?.deep_unpack()||0;if(offset>bytes.length)throw Error();inv.return_value(new GLib.Variant('(ay)',[bytes.slice(offset)]));}catch{inv.return_dbus_error('org.bluez.Error.Failed','Unavailable');}},
  WriteValueAsync([bytes,options],inv){try{if(name!=='write'||inv.get_sender()!==owner||(options.offset?.deep_unpack()||0)!==0)throw Error();const peer=options.device?.deep_unpack();const r=controller({op:'frame',peer,chunk:ByteArray.toString(bytes)});if(r.error)throw Error();inv.return_value(new GLib.Variant('()',[]));}catch{inv.return_dbus_error('org.bluez.Error.NotAuthorized','Refused');}}
 });
}
expose(base,'<node><interface name="org.freedesktop.DBus.ObjectManager"><method name="GetManagedObjects"><arg type="a{oa{sa{sv}}}" direction="out"/></method></interface></node>',{GetManagedObjects(){return managed;}});
const advert=base+'/advert';
expose(advert,'<node><interface name="org.bluez.LEAdvertisement1"><property name="Type" type="s" access="read"/><property name="ServiceUUIDs" type="as" access="read"/><method name="Release"/></interface></node>',{Type:'peripheral',ServiceUUIDs:[SERVICE],Release(){advertising=false;}});
let advertising=false,changing=false,registered=false,retryAfter=0;
// Ubuntu BlueZ 5.72 sends a legacy-sized header to Add Extended Advertising Data.
// Its new kernel rejects the trailing bytes. Use the standard legacy management
// command only on the explicitly configured host; GATT still belongs to BlueZ.
const legacy=GLib.getenv('MURAKUMO_BLE_LEGACY_ADV')==='1';
function poll(){try{const active=!!controller({op:'info'});if(registered&&!changing&&active!==advertising&&Date.now()>retryAfter){changing=true;retryAfter=Date.now()+15000;
 if(legacy){const uuid=SERVICE.replace(/-/g,'').match(/../g).reverse().join(''),index=adapter.split('/').pop().replace('hci','');const args=active?['timeout','5','btmgmt','-i',index,'add-adv','-c','-g','-d','1107'+uuid,'-s','0e094d7572616b756d6f204e6f6465','10']:['timeout','5','btmgmt','-i',index,'rm-adv','10'];const p=Gio.Subprocess.new(args,Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_PIPE|Gio.SubprocessFlags.STDIN_PIPE);p.communicate_utf8_async('',null,(child,result)=>{try{const [,out,err]=child.communicate_utf8_finish(result);if(child.get_successful()){advertising=active;retryAfter=0;print(active?'BLE setup advertising enabled (legacy management)':'BLE setup advertising disabled');}else printerr('BLE legacy advertising failed: '+String(err||out).slice(0,200));}catch{printerr('BLE legacy advertising failed');}changing=false;});
 }else call(adapter,'org.bluez.LEAdvertisingManager1',active?'RegisterAdvertisement':'UnregisterAdvertisement',active?new GLib.Variant('(oa{sv})',[advert,{}]):new GLib.Variant('(o)',[advert]),()=>{advertising=active;changing=false;retryAfter=0;print(active?'BLE setup advertising enabled':'BLE setup advertising disabled');});}}catch(e){changing=false;retryAfter=Date.now()+15000;printerr('BLE polling failed: '+e.message);}return GLib.SOURCE_CONTINUE;}
call(adapter,'org.freedesktop.DBus.Properties','Set',new GLib.Variant('(ssv)',['org.bluez.Adapter1','Powered',new GLib.Variant('b',true)]),()=>call(adapter,'org.bluez.GattManager1','RegisterApplication',new GLib.Variant('(oa{sv})',[base,{}]),()=>{registered=true;print('BLE GATT registered');poll();}));
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,1,poll);
loop.run();
