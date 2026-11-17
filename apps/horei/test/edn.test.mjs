import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseEdn,EdnError} from '../scripts/edn.mjs';
test('reads the corpus subset: namespaced maps, keywords, strings, numbers, sets',()=>{
  assert.deepEqual(parseEdn('[#:law{:key "jp:1", :kind :law.kind/statute, :text/bytes 12, :_/x true} {:a/b nil} #{1 2} (3.5)] ; c'),
    [{'law/key':'jp:1','law/kind':'law.kind/statute','text/bytes':12,'x':true},{'a/b':null},[1,2],[3.5]]);
  assert.equal(parseEdn('"改正\\n\\"引用\\" \\u3042"'),'改正\n"引用" あ');
  assert.deepEqual(parseEdn('[1 #_ 2 3]'),[1,3]);
});
test('rejects what it does not understand instead of guessing',()=>{
  for(const bad of ['#inst "2020"','{:a 1 :a 2}','[1','"x','{"k" 1}','1/2','\\a','99999999999999999999','[1] 2'])
    assert.throws(()=>parseEdn(bad),EdnError,bad);
});
