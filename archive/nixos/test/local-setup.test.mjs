import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm,mkdir,copyFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {completeLocal,readLocal} from '../local-setup.mjs';
import {savedLink} from '../account-link.mjs';
import {runSetup} from '../registration-ui.mjs';
import {chooseLanguage,readLanguage,saveLanguage} from '../language.mjs';
const t=(_ja,en)=>en;
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'murakumo-local-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('local setup persists device identity across boot without an account receipt',async t=>{
 const dir=await directory(t);const first=await completeLocal(dir);
 assert.match(first.deviceDid,/^did:key:z/);assert.deepEqual(await completeLocal(dir),first);
 assert.deepEqual(await readLocal(dir),first);assert.equal(await savedLink(dir),null);
 assert.equal((await stat(join(dir,'local-setup.json'))).mode&0o077,0);
 const key=await readFile(join(dir,'account-device.json'),'utf8');await completeLocal(dir);
 assert.equal(await readFile(join(dir,'account-device.json'),'utf8'),key);
});
test('local first-boot choice completes with zero network and registration calls',async t=>{
 const dir=await directory(t),screens=[],actions=['local','shutdown'];
 await runSetup({t:(_ja,en)=>en,ui:{menu:(m,items)=>{screens.push(m);const a=actions.shift();assert.ok(items.some(([k])=>k===a));return a;}},readSaved:()=>savedLink(dir),readLocal:()=>readLocal(dir),completeLocal:()=>completeLocal(dir),network:()=>assert.fail('network requested'),register:()=>assert.fail('account requested'),poweroff:async()=>true});
 assert.equal(actions.length,0);assert.match(screens[1],/completed locally/);assert.match(screens[1],/require separate verification/);
 await runSetup({t:(_ja,en)=>en,ui:{menu:m=>{assert.match(m,/completed locally/);return 'shutdown';}},readSaved:()=>savedLink(dir),readLocal:()=>readLocal(dir),completeLocal:()=>assert.fail('identity replaced'),network:()=>assert.fail(),register:()=>assert.fail(),poweroff:async()=>true});
});
test('network settings in local mode never implicitly start registration',async t=>{
 const dir=await directory(t);await completeLocal(dir);const actions=['network','shutdown'];
 await runSetup({t:(_ja,en)=>en,ui:{menu:()=>actions.shift()},readSaved:()=>savedLink(dir),readLocal:()=>readLocal(dir),completeLocal:()=>completeLocal(dir),network:async()=> 'connected',register:()=>assert.fail('unexpected claim'),poweroff:async()=>true});assert.equal(actions.length,0);
});
test('corrupt local completion refuses to replace stored identity',async t=>{
 const dir=await directory(t);await completeLocal(dir);const before=await readFile(join(dir,'account-device.json'));
 await writeFile(join(dir,'local-setup.json'),JSON.stringify({version:1,mode:'local',deviceDid:'did:key:other'}));
 await assert.rejects(completeLocal(dir),/mismatch/);assert.deepEqual(await readFile(join(dir,'account-device.json')),before);
});
test('network back preserves completed local setup and returns to its status',async t=>{
 const dir=await directory(t);await completeLocal(dir);const actions=['network','shutdown'],screens=[];
 await runSetup({t:(_ja,en)=>en,ui:{menu:m=>{screens.push(m);return actions.shift();}},readSaved:()=>savedLink(dir),readLocal:()=>readLocal(dir),network:async()=> 'back',register:()=>assert.fail('unexpected claim'),poweroff:async()=>true});
 assert.equal(actions.length,0);assert.match(screens[1],/completed locally/);assert.equal(await savedLink(dir),null);
});
test('language selection persists Japanese and English and rejects arbitrary values',async t=>{
 const dir=await directory(t),previous={lang:process.env.MURAKUMO_UI_LANG,selected:process.env.MURAKUMO_UI_LANGUAGE_SELECTED};
 t.after(()=>{for(const [key,value] of [['MURAKUMO_UI_LANG',previous.lang],['MURAKUMO_UI_LANGUAGE_SELECTED',previous.selected]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 delete process.env.MURAKUMO_UI_LANGUAGE_SELECTED;
 assert.equal(chooseLanguage({menu:()=> 'en'},dir),'en');assert.equal(readLanguage(dir),'en');
 process.env.MURAKUMO_UI_LANG='ja';process.env.MURAKUMO_UI_LANGUAGE_SELECTED='1';
 assert.equal(chooseLanguage({menu:()=>assert.fail('duplicate chooser')},dir),'ja');assert.equal(readLanguage(dir),'ja');
 assert.throws(()=>saveLanguage('other',dir),/Unsupported/);assert.equal(readLanguage(dir),'ja');
});

test('bundled local setup loads through an etc-style symlink and preserves its identity dependency',async t=>{
 const dir=await directory(t),bundle=join(dir,'store-bundle'),etc=join(dir,'etc');
 await mkdir(bundle);await mkdir(etc);
 for(const name of ['local-setup.mjs','account-link.mjs','node-root-receipt.mjs'])await copyFile(new URL('../'+name,import.meta.url),join(bundle,name));
 await symlink(join(bundle,'local-setup.mjs'),join(etc,'local-setup.mjs'));
 const loaded=await import(new URL('file://'+join(etc,'local-setup.mjs')));
 const state=await loaded.completeLocal(join(dir,'state'));
 assert.deepEqual(await loaded.readLocal(join(dir,'state')),state);
 assert.equal(await savedLink(join(dir,'state')),null);
});
