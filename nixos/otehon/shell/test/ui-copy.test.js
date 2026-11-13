import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {UI_COPY,getCopy,initialLocale,saveLocale} from '../src/ui-copy.js';
const placeholders=s=>[...s.matchAll(/\{([a-zA-Z]+)\}/g)].map(m=>m[1]).sort();
test('Japanese and English preserve complete messages and named parameters',()=>{
 assert.deepEqual(Object.keys(UI_COPY.ja).sort(),Object.keys(UI_COPY.en).sort());
 for(const [key,value]of Object.entries(UI_COPY.ja))assert.deepEqual(placeholders(value),placeholders(UI_COPY.en[key]),key);
 assert.equal(getCopy('en','structureCount',{bots:899,circles:10}),'899 bots · 10 circles');
 assert.equal(getCopy('en','agentCount',{count:1}),'1 agent');assert.equal(getCopy('en','agentCount',{count:2}),'2 agents');
 assert.equal(getCopy('unknown','close'),'閉じる');
});
test('copy keys used by primary Soshiki components exist in both languages',()=>{
 for(const file of ['fleet_activity.cljs','fleet_goals.cljs','fleet_overview.cljs','fleet_circles.cljs']){
  const text=fs.readFileSync(new URL('../src/shell/'+file,import.meta.url),'utf8');
  for(const m of text.matchAll(/ui\/t locale :([A-Za-z]+)/g))assert.ok(UI_COPY.ja[m[1]]&&UI_COPY.en[m[1]],file+':'+m[1]);
 }
});
test('locale settings reject unsupported values and tolerate unavailable browser storage',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 assert.equal(initialLocale(storage),'ja');assert.equal(saveLocale('en',storage),'en');assert.equal(initialLocale(storage),'en');
 assert.throws(()=>saveLocale('unknown',storage));assert.equal(initialLocale(storage),'en');
 assert.equal(initialLocale({getItem(){throw Error('denied');}}),'ja');
});
