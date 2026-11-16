// The peer receives only public archive bytes and verification code, no keys.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{once}from'node:events';import{readLegacyPart}from'./actions-to-awaifs.mjs';
const root=process.argv[2];if(!/^\/Users\/node\/github\/workspaces\/codex\/awai-2987\/\.agent-output\/archive-cold\/cold-[a-f0-9-]+$/.test(root??''))throw Error('owned remote cold directory required');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),request=JSON.parse(fs.readFileSync(path.join(root,'request.json'))),raw=fs.readFileSync(path.join(root,'manifest.json'));
if(raw.length>256*1024**2||hash(raw)!==request.snapshot)throw Error('remote catalog checksum');const catalog=JSON.parse(raw);
for(const p of request.localPacks){if(!/^pack-\d+\.car$/.test(p.name)||p.bytes>64*1024**2)throw Error('pack bound');const b=fs.readFileSync(path.join(root,'packs',p.name));if(b.length!==p.bytes||hash(b)!==p.sha256)throw Error('complete remote pack checksum');}
for(const p of request.parts){const chunks=[];readLegacyPart(root,catalog.files[p.name],p,b=>chunks.push(b));const body=Buffer.concat(chunks);if(!process.stdout.write(body))await once(process.stdout,'drain');}
console.error(JSON.stringify({verified:true,snapshot:request.snapshot,files:request.parts.length,scope:'empty remote recovery directory; actual B2 Pack bytes; no provider credentials on peer'}));
