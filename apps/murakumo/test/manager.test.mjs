// The shared model manager cases (test/manager-cases.json) on the actual compiled CLJS bundle.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const context={window:{},TextEncoder,console};vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../dist/domain.js',import.meta.url),'utf8'),context);
const api=context.window.AwaiInferenceManager;
const names={'catalog-problems':'catalogProblems','estimate-bytes':'estimateBytes','budget-bytes':'budgetBytes',fit:'fit',recommend:'recommend','usage-problems':'usageProblems',freshness:'freshness','device-view':'deviceView'};
const cases=JSON.parse(fs.readFileSync(new URL('./manager-cases.json',import.meta.url),'utf8'));
const plain=(v)=>JSON.parse(JSON.stringify(v??null));
// Build arguments inside the bundle's realm: js->clj converts only objects from its own realm, as in the app's single-realm WebView.
const inRealm=(v)=>vm.runInContext(`(${JSON.stringify(v??null)})`,context);
for(const c of cases)test(`compiled CLJS: ${c.name}`,()=>{assert.deepEqual(plain(api[names[c.fn]](...c.args.map(inRealm))),c.expect);});
test('the pinned catalog file passes the compiled check',()=>{assert.deepEqual(plain(api.catalogProblems(inRealm(JSON.parse(fs.readFileSync(new URL('../catalog.json',import.meta.url),'utf8'))))),[]);});
