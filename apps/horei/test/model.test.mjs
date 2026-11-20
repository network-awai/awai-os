import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {loadCorpus,loadCatalog,search,trace,lawByLocalId,endpoint,normalize} from '../src/model.js';
const read=name=>readFileSync(new URL('../data/'+name,import.meta.url));
const provenance=JSON.parse(read('PROVENANCE.json'));
const corpus=loadCorpus(JSON.parse(read('jp.go.e-gov.elaws.json')));
test('bundled data matches its recorded provenance and holds no full text',()=>{
  for(const [name,{sha256,bytes}] of Object.entries(provenance.outputs)){const b=read(name);assert.equal(b.length,bytes);assert.equal(createHash('sha256').update(b).digest('hex'),sha256,name);}
  assert.equal(provenance.fullTextBytesHeld,0);
  assert.equal(corpus.laws.length,provenance.coverage.laws);assert.equal(corpus.relationCount,provenance.coverage.relations);
});
test('search finds a statute by title, abbreviation and full-width input, current laws first',()=>{
  const r=search(corpus,'民法');assert.ok(r.total>0);assert.equal(r.results[0].title,'民法','exact title ranks first');assert.equal(r.results[1].status,'law.status/in-force','then current laws');
  assert.ok(search(corpus,'ＮＡＣＣＳ').total>0,'full-width folds to half-width');
  assert.ok(search(corpus,'個人情報 保護').results.some(l=>l.title==='個人情報の保護に関する法律'),'all terms must match');
  assert.equal(search(corpus,'   ').total,0);assert.equal(search(corpus,'存在しない法令名xyz').total,0);
  assert.ok(search(corpus,'法律',{limit:5}).results.length<=5);
});
test('amendment graph: incoming and outgoing edges agree and the trace is cycle-safe and bounded',()=>{
  let both=0;for(const law of corpus.laws)for(const rel of corpus.outgoing[law.index])if(typeof rel.to==='number'){both++;assert.ok(corpus.incoming[rel.to].includes(rel));}
  assert.ok(both>0,'some relations connect two laws in the corpus');
  const target=corpus.laws.find(l=>corpus.incoming[l.index].some(r=>typeof r.from==='number'&&corpus.incoming[r.from].length));
  assert.ok(target,'a law whose amender was itself amended exists');
  const t=trace(corpus,target.index);assert.ok(t.children.length>0);assert.ok(t.children.some(n=>n.children.length>0),'recursion reaches depth 2');
  const small=trace(corpus,target.index,{maxNodes:1});assert.equal(small.children.length,1);
  const seen=[];(function walk(ns){for(const n of ns){if(n.end.inCorpus&&!n.repeat){assert.ok(!seen.includes(n.end.law.index));seen.push(n.end.law.index);}walk(n.children);}})(t.children);
});
test('relation ends outside the corpus are kept and labelled, not dropped',()=>{
  const rel=corpus.laws.flatMap(l=>corpus.incoming[l.index]).find(r=>typeof r.from==='string');
  const e=endpoint(corpus,rel.from,rel.evidence);assert.equal(e.inCorpus,false);assert.ok(e.label.length>0);
  assert.equal(lawByLocalId(corpus,'nonexistent'),null);assert.equal(normalize(' Ａ b '),'ab');
});
test('catalog groups legislatures, courts and sources by jurisdiction',()=>{
  const c=loadCatalog(JSON.parse(read('catalog.json')));const jpn=c.jurisdictions.find(j=>j.code==='JPN');
  assert.ok(jpn);assert.ok(jpn.legislatures.length>=1);assert.ok(c.jurisdictions.length>=198);
});
test('corrupt data is refused',()=>{assert.throws(()=>loadCorpus({schema:'x'}));assert.throws(()=>loadCatalog({}));});
import {MESSAGES,pickLocale,translator} from '../src/messages.js';
test('ja and en have the same message keys, every kind/status has a label, placeholders are enforced',()=>{
  assert.deepEqual(Object.keys(MESSAGES.en).sort(),Object.keys(MESSAGES.ja).sort());
  for(const locale of ['ja','en']){const t=translator(locale);for(const law of corpus.laws.slice(0,2000)){t('kind.'+law.kind);t('status.'+law.status);}assert.throws(()=>t('search.count'));}
  assert.equal(pickLocale(['en-US','ja']),'en');assert.equal(pickLocale(['fr']),'ja');
  assert.equal(translator('en')('search.count',{total:'3'}),'3 results');assert.equal(translator('en')('search.countOne',{total:'1'}),'1 result');
});
test('the all-zero upstream amender id is reported as unknown, not shown as an id',()=>{
  const rel=corpus.laws.flatMap(l=>corpus.incoming[l.index]).find(r=>r.from==='jp-elaws:000000000000000');
  assert.ok(rel);assert.equal(endpoint(corpus,rel.from,rel.evidence).unknown,true);
});
