import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
await mkdir(path.join(root,'.agent-output'),{recursive:true});
const temp=await mkdtemp(path.join(root,'.agent-output/identity-route-test-'));
await copyFile(path.join(root,'android/client/generated/identity.js'),path.join(temp,'identity.mjs'));
await copyFile(path.join(root,'otehon/shell/vendor/kotoba-client-runtime.js'),path.join(temp,'runtime.js'));
const {relayRequestAllowed:allowed}=await import(pathToFileURL(path.join(temp,'identity.mjs')));
test('account relay requests use a normalized, fixed HTTPS route with no caller parameters',()=>{
  const good=`https://relay.awai.network/${'a'.repeat(32)}/json`;
  assert(allowed(good));assert(allowed(good.replace('.network/','.network:443/')));
  for(const bad of [good+'?x=1',good+'#x',good.replace('https:','http:'),good.replace('.network/','.network.evil.test/'),good.replace('://','://x@'),good.replace('a'.repeat(32),'x'.repeat(32)),good.replace('/json','/other'),'null','data:text/plain,hi'])assert(!allowed(bad));
  assert(!allowed(good,'POST'));
});
