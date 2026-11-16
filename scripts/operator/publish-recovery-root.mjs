// Publish only an already uploaded and independently verified AwaiFS checkpoint.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{offsite}from'./awaifs-offsite.mjs';import{REPO}from'./actions-to-awaifs.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const config=JSON.parse(fs.readFileSync(process.argv[2]));
for(const p of [config.work,config.credentialsPlist])if(!path.isAbsolute(p))throw Error('explicit operator paths required');
const events=fs.readFileSync(path.join(config.work,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const proof=events.filter(x=>x.event==='cold-readback-verified').at(-1);if(!/^[a-f0-9]{64}$/.test(proof?.snapshot))throw Error('no verified checkpoint');
const bytes=fs.readFileSync(path.join(config.work,`catalog-${proof.snapshot}.json`));if(hash(bytes)!==proof.snapshot)throw Error('checkpoint changed');
const root={schema:'awai.operator.archive-root.v1',repo:REPO,catalog:proof.snapshot,profile:'installed-legacy-raw-pack',publishedAt:new Date().toISOString()};
const cold=fs.mkdtempSync(path.join(config.work,'root-proof-')),file=path.join(cold,'root.json');fs.writeFileSync(file,JSON.stringify(root),{mode:0o600});
const store=offsite(config.credentialsPlist);store.pull(`manifests/sha256-${proof.snapshot}.json`,path.join(cold,'catalog.json'));if(hash(fs.readFileSync(path.join(cold,'catalog.json')))!==proof.snapshot)throw Error('remote checkpoint differs');
store.push(file,'recovery-root.json');store.pull('recovery-root.json',path.join(cold,'readback.json'));if(hash(fs.readFileSync(path.join(cold,'readback.json')))!==hash(fs.readFileSync(file)))throw Error('published root readback differs');
fs.writeFileSync(path.join(config.work,'published-root.json'),JSON.stringify(root),{mode:0o600});console.log(JSON.stringify({published:true,catalog:proof.snapshot,source:'AwaiFS verified checkpoint; not a signed production release'}));fs.rmSync(cold,{recursive:true});
