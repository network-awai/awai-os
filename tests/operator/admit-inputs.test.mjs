import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import cp from'node:child_process';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');const script=path.resolve('ci/independent/admit-inputs.py');
function fixture(){
 const base=path.resolve('.agent-output/admission-tests');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'case-')),source=path.join(root,'source'),inputs=path.join(root,'inputs');fs.mkdirSync(source);fs.mkdirSync(inputs);
 const git=args=>cp.execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-C',source,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git(['init','-q']);fs.writeFileSync(path.join(source,'public.txt'),'immutable source');git(['add','public.txt']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','AWAI-2987 input fixture']);
 cp.execFileSync('tar',['-czf',path.join(inputs,'source.tar.gz'),'-C',root,'source'],{env:{...process.env,COPYFILE_DISABLE:'1'}});fs.writeFileSync(path.join(inputs,'nixpkgs.tar.gz'),'fixture data, never evaluated by Nix');
 const lock={schema:'awai.ci.local-inputs.v1',sourceRevision:git(['rev-parse','HEAD']).trim(),files:{}};for(const n of ['source.tar.gz','nixpkgs.tar.gz']){const b=fs.readFileSync(path.join(inputs,n));lock.files[n]={bytes:b.length,sha256:hash(b)};}
 const save=()=>{const b=Buffer.from(JSON.stringify(lock));fs.writeFileSync(path.join(inputs,'inputs.json'),b);return hash(b);};
 return{root,inputs,lock,save,run:sha=>cp.spawnSync('python3',[script,inputs,sha],{encoding:'utf8'})};
}
test('operator input admission preserves actual Git identity, refuses altered raw archive even with other cached state',()=>{
 const a=fixture();try{const r=a.run(a.save());assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).sourceRevision,a.lock.sourceRevision);}finally{fs.rmSync(a.root,{recursive:true});}
 const b=fixture();try{const pin=b.save(),file=path.join(b.inputs,'nixpkgs.tar.gz'),bytes=fs.readFileSync(file);bytes[0]^=1;fs.writeFileSync(file,bytes);const r=b.run(pin);assert.notEqual(r.status,0);assert.match(r.stderr,/input artifact SHA256 refused/);assert.equal(fs.existsSync(path.join(b.inputs,'source')),false);}finally{fs.rmSync(b.root,{recursive:true});}
});
test('untrusted lock identity and traversal archive cannot reach execution/extraction outside the source',()=>{
 const a=fixture();try{a.save();const r=a.run('0'.repeat(64));assert.notEqual(r.status,0);assert.match(r.stderr,/input lock SHA256 refused/);}finally{fs.rmSync(a.root,{recursive:true});}
 const b=fixture();try{cp.execFileSync('python3',['-c',"import tarfile,io,sys;t=tarfile.open(sys.argv[1],'w:gz');i=tarfile.TarInfo('source/../../escape');i.size=3;t.addfile(i,io.BytesIO(b'bad'));t.close()",path.join(b.inputs,'source.tar.gz')]);const bytes=fs.readFileSync(path.join(b.inputs,'source.tar.gz'));b.lock.files['source.tar.gz']={bytes:bytes.length,sha256:hash(bytes)};const r=b.run(b.save());assert.notEqual(r.status,0);assert.match(r.stderr,/archive path refused/);assert.equal(fs.existsSync(path.join(b.root,'escape')),false);}finally{fs.rmSync(b.root,{recursive:true});}
});
