import test from 'node:test';
import assert from 'node:assert/strict';
import {button,search_field,navigation,field} from '../dist/index.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
test('native action states cannot be overridden by caller attrs',()=>{
 const b=button('Working',{busy:true,attrs:{disabled:false}});assert.equal(b[0],'button');assert.equal(b[1].disabled,true);assert.equal(b[1]['aria-busy'],'true');assert.equal(b[1].type,'button');
 assert.throws(()=>button('X',{variant:'invented'}));
});
test('search has a real label and error association',()=>{
 const tree=search_field({id:'q',label:'Find',error:'Try again',value:''});
 assert.equal(tree[2][1].for,'q'); assert.equal(tree[3][3][1]['aria-describedby'],'q-error');assert.equal(tree[4][1].id,'q-error');
 assert.throws(()=>search_field({id:'q'}));
});
test('navigation marks one current fragment without menu roles',()=>{
 const nav=navigation('Main',[{id:'a',label:'A',href:'#a'},{id:'b',label:'B',href:'#b'}],'a');
 const rows=Array.from(nav[2][1]);assert.equal(rows[0][1][1]['aria-current'],'page');assert.equal(rows[1][1][1]['aria-current'],null);
 assert.throws(()=>Array.from(navigation('Main',[{id:'x',label:'X',href:'javascript:alert(1)'}],'x')[2][1]));
});
test('field forwards hint and error IDs without duplicating labels',()=>{
 const f=field({id:'input',label:'Name',hint:'Public only',error:'Required'},['input',{}]);assert.equal(f[3][1]['aria-describedby'],'input-hint input-error');
});
test('all token/asset/build fingerprints recompute from bytes',()=>{
 const manifest=JSON.parse(fs.readFileSync('dist/integrity.json'));for(const [file,digest]of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),digest);
 const t=JSON.parse(fs.readFileSync('tokens/figma-android-v2.json'));assert.equal(Object.keys(t.colors).length,11);assert.equal(t.colors.primary.light.hex,'#1e50a2');assert.equal(t.colors.primary.dark.hex,'#b5cfff');
});

test('icons cannot silently become remote operations',()=>{
 assert.throws(()=>search_field({id:'q',label:'Find','icon-src':'https://example.com/pixel.svg'}));
 assert.throws(()=>Array.from(navigation('Main',[{id:'a',label:'A',href:'#a','icon-src':'//example.com/x.svg'}],'a')[2][1]));
});
