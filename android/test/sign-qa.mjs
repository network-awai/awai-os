#!/usr/bin/env node
import {execFileSync} from 'node:child_process';import {mkdir,chmod,readFile,writeFile,access,stat} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),manifest=path.resolve(process.argv[2]||'');const r=JSON.parse(await readFile(manifest));
const dir=path.join(root,'.agent-output/qa-signing'),key=path.join(dir,'qa.p12');await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
try{await access(key);}catch{execFileSync(path.join(process.env.JAVA_HOME,'bin/keytool'),['-genkeypair','-keystore',key,'-storetype','PKCS12','-storepass','qa-fixture-only','-keypass','qa-fixture-only','-alias','awaiqa','-keyalg','RSA','-keysize','2048','-validity','365','-dname','CN=Awai Isolated QA'],{stdio:'ignore'});await chmod(key,0o600);}
const apksigner=path.join(process.env.ANDROID_HOME,'build-tools/36.1.0/apksigner');
for(const [name,p] of Object.entries(r.packages)){
 const output=path.join(path.dirname(manifest),name+'-qa.apk');execFileSync(apksigner,['sign','--ks',key,'--ks-pass','pass:qa-fixture-only','--key-pass','pass:qa-fixture-only','--ks-key-alias','awaiqa','--out',output,p.apk],{stdio:'ignore'});
 const cert=execFileSync(apksigner,['verify','--print-certs',output],{encoding:'utf8'}).match(/certificate SHA-256 digest: ([a-f0-9]{64})/)?.[1];
 if(!cert||cert==='2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29')throw Error('QA signer must differ from production signer');
 p.apk=output;p.bytes=(await stat(output)).size;p.sha256=createHash('sha256').update(await readFile(output)).digest('hex');p.signerSha256=cert;
}
if(r.packages.itonami.signerSha256!==r.packages.murakumo.signerSha256)throw Error('QA pair signer mismatch');
r.distinctQaSigner=true;await writeFile(manifest,JSON.stringify(r,null,2)+'\n');console.log('Signed QA pair with separate fixture identity; '+manifest);
