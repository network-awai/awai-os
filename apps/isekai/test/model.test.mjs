import {test} from 'node:test';import assert from 'node:assert/strict';
import {isCidV1,isDidKey,base32Decode,base58Decode,gameProblem,parentProblem,authorProblem,messageProblem,buildDraft,draftProblems,decodeState,addDraft,removeDraft,emptyState,MAX_DRAFTS,PLANNED_OPERATIONS,DRAFT_SCHEMA} from '../src/model.js';
const author='did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const cid='bafkreicm3nb6uycppgon6qpubbf5zjlgoqipfgulsux5jbrpsnrohcmspm';
test('game, parent, author and message are validated',()=>{
  for(const g of ['castlevania','neon-run','2d'])assert.equal(gameProblem(g),null,g);
  for(const g of ['','Neon','-run','a b','a/b','x'.repeat(64)])assert.equal(gameProblem(g),'game.format',g);
  assert.equal(parentProblem(''),null);assert.equal(parentProblem(cid),null);
  for(const p of ['Qm123','bafy','BAFKREI'+'A'.repeat(50),'b'+'1'.repeat(60)])assert.equal(parentProblem(p),'parent.format',p);
  assert.equal(authorProblem(author),null);
  for(const a of ['','did:key:abc','did:web:example.com','did:key:z0OIl'+'1'.repeat(40)])assert.equal(authorProblem(a),'author.format',a);
  assert.equal(messageProblem('  '),'message.empty');assert.equal(messageProblem('x'.repeat(201)),'message.long');assert.equal(messageProblem('x'.repeat(200)),null);
});
test('CIDs and did:keys are decoded, not only matched against the alphabet',()=>{
  assert.equal(isCidV1(cid),true,'raw sha2-256 CIDv1');
  assert.equal(isCidV1('bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'),true,'dag-cbor CIDv1');
  assert.equal(isCidV1('b'+'a'.repeat(50)),false,'alphabet-shaped but version 0 bytes');
  assert.equal(isCidV1(cid.slice(0,-2)),false,'truncated digest');
  assert.equal(isCidV1(cid+'aa'),false,'trailing bytes');
  assert.equal(isCidV1('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'),false,'CIDv0 is not accepted');
  assert.equal(isDidKey(author),true,'ed25519');
  assert.equal(isDidKey('did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme'),true,'secp256k1');
  assert.equal(isDidKey('did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169'),true,'P-256');
  assert.equal(isDidKey('did:key:z'+'1'.repeat(40)),false,'all zero bytes, no key codec');
  assert.equal(isDidKey(author.slice(0,-3)),false,'short key');
  assert.equal(isDidKey('did:key:zQ3sgkxA1r9UUKeDtF6gRP5t3pbNSemByHZ3XvvkoJLg8DUrj'),false,'secp256k1 codec with 33 zero bytes is not a point');
  const b58=bytes=>{let n=bytes.reduce((n,b)=>n*256n+BigInt(b),0n),o='';while(n>0n){o='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Number(n%58n)]+o;n/=58n;}for(const b of bytes){if(b)break;o='1'+o;}return o;};
  assert.equal(isDidKey('did:key:z'+b58([0xed,0x01,...Array(31).fill(0xff),0x7f])),false,'ed25519 y >= p');
  assert.equal(isDidKey('did:key:z'+b58([0xed,0x01,...base58Decode(author.slice(9)).subarray(2)])),true,'re-encoded ed25519 vector');
  assert.equal(isDidKey('did:key:z'+'2'.repeat(100000)),false,'oversized input is refused before decoding');
  assert.equal(isCidV1('bahkqaerajtnuh2taj54zzx2b6qeexxffmz2bb4u2roks7vegf6jwfy4jsj5q'),false,'overlong codec varint');
  assert.deepEqual([...base32Decode('mzxw6')],[0x66,0x6f,0x6f]);assert.equal(base32Decode('mzxw7'),null,'non-canonical tail');
  assert.deepEqual([...base58Decode('1112')],[0,0,0,1]);assert.equal(base58Decode('0'),null);
});
test('a draft follows the fork_git commit shape and is never published',()=>{
  const {draft:root}=buildDraft({game:'neon-run',parent:'',author,message:'First level'});
  assert.deepEqual(root,{schema:DRAFT_SCHEMA,game:'neon-run',parents:[],author,message:'First level',moderation:'pending',published:false});
  const {draft:child}=buildDraft({game:' neon-run ',parent:` ${cid} `,author,message:'Faster jump'});
  assert.deepEqual(child.parents,[cid]);assert.equal(child.game,'neon-run');
  assert.deepEqual(draftProblems(root),[]);assert.deepEqual(draftProblems(child),[]);
  assert.deepEqual(draftProblems({...root,published:true}),['draft.state']);
  assert.deepEqual(draftProblems({...root,parents:[cid,cid]}),['draft.parents']);
  assert.deepEqual(buildDraft({game:'',parent:'x',author:'',message:''}).problems,['game.format','parent.format','author.format','message.empty']);
});
test('drafts are bounded, validated on load and removable',()=>{
  const {draft:q}=buildDraft({game:'g',author,message:'m'});
  let s=emptyState();s=addDraft(s,q,{id:'a',now:'2026-11-18T00:00:00Z'});s=addDraft(s,q,{id:'b',now:'2026-11-18T00:01:00Z'});
  assert.deepEqual(s.drafts.map(d=>d.id),['b','a'],'newest first');
  assert.deepEqual(decodeState(JSON.parse(JSON.stringify(s))),s);assert.deepEqual(decodeState(null),emptyState());
  assert.deepEqual(removeDraft(s,'b').drafts.map(d=>d.id),['a']);
  assert.throws(()=>decodeState({schema:'other',drafts:[]}));
  assert.throws(()=>decodeState({...s,drafts:[{...s.drafts[0],draft:{...q,published:true}}]}));
  assert.throws(()=>addDraft(s,{...q,author:'x'},{id:'c',now:'x'}));
  let full=emptyState();for(let i=0;i<MAX_DRAFTS;i++)full=addDraft(full,q,{id:String(i),now:'x'});assert.throws(()=>addDraft(full,q,{id:'z',now:'x'}));
  assert.throws(()=>decodeState({...full,drafts:[...full.drafts,full.drafts[0]]}),/unreadable/,'more than the limit is unreadable, not truncated');
});
test('planned external operations are display data only',()=>{assert.equal(PLANNED_OPERATIONS.length,3);assert.ok(Object.isFrozen(PLANNED_OPERATIONS[0]));});
import {MESSAGES,pickLocale,translator} from '../src/messages.js';
test('ja and en have the same message keys and every problem code has a label',()=>{
  assert.deepEqual(Object.keys(MESSAGES.en).sort(),Object.keys(MESSAGES.ja).sort());
  const codes=['game.format','parent.format','author.format','message.empty','message.long'];
  for(const locale of ['ja','en']){const t=translator(locale);for(const c of codes)t('problem.'+c);for(const o of PLANNED_OPERATIONS)t('op.'+o.id);assert.throws(()=>t('drafts.count'));}
  assert.equal(pickLocale(['en-US']),'en');assert.equal(pickLocale(['fr']),'ja');
});
