import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(path.join(root,'otehon/shell/package.json'));
const esbuild=require('esbuild');
// Output directory: the first argument, or the tracked android/client/generated when regenerating those files on purpose.
// android/build.py passes its own build directory so that a build never rewrites tracked files (AWAI-3772).
const outDir=path.resolve(process.argv[2]||path.join(root,'android/client/generated'));
await esbuild.build({entryPoints:[path.join(root,'android/client/identity-entry.js')],outfile:path.join(outDir,'identity.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[path.join(root,'otehon/shell/node_modules')],external:['./runtime.js'],minify:true});
await esbuild.build({entryPoints:[path.join(root,'android/client/account-broker-entry.js')],outfile:path.join(outDir,'account-broker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[path.join(root,'otehon/shell/node_modules')],minify:true});
await esbuild.build({entryPoints:[path.join(root,'otehon/shell/src/identity/wnfs-account.js')],outfile:path.join(outDir,'wnfs-account.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',nodePaths:[path.join(root,'otehon/shell/node_modules')],minify:true});
