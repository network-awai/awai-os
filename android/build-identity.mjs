import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(path.join(root,'otehon/shell/package.json'));
const esbuild=require('esbuild');
await esbuild.build({entryPoints:[path.join(root,'android/client/identity-entry.js')],outfile:path.join(root,'android/client/generated/identity.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[path.join(root,'otehon/shell/node_modules')],external:['./runtime.js'],minify:true});
await esbuild.build({entryPoints:[path.join(root,'android/client/account-broker-entry.js')],outfile:path.join(root,'android/client/generated/account-broker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[path.join(root,'otehon/shell/node_modules')],minify:true});
await esbuild.build({entryPoints:[path.join(root,'otehon/shell/src/identity/wnfs-account.js')],outfile:path.join(root,'android/client/generated/wnfs-account.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[path.join(root,'otehon/shell/node_modules')],minify:true});
