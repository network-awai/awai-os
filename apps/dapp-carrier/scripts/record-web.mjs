// Record explicit local, previously built artifacts; never downloads or publishes.
import {readFile,readdir,lstat,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
const [key,input]=process.argv.slice(2);if(!['aozora','dougaka'].includes(key)||!input)throw Error('record-web <aozora|dougaka> <explicit-built-static-directory>');
const root=resolve(input),files={};let bytes=0;
async function visit(directory){for(const name of await readdir(directory)){const path=resolve(directory,name),stat=await lstat(path);if(stat.isSymbolicLink())throw Error('Static artifact symlink refused');if(stat.isDirectory())await visit(path);else{const file=relative(root,path).replaceAll('\\','/');if(!/^[A-Za-z0-9._/-]+$/.test(file)||file.split('/').includes('..'))throw Error('Unsafe artifact path');const data=await readFile(path);bytes+=data.length;if(bytes>33554432)throw Error('Static artifact exceeds 32 MiB');files[file]=createHash('sha256').update(data).digest('hex');}}}
await visit(root);if(!Object.hasOwn(files,'index.html'))throw Error('Static entry missing');
const target=new URL('../profiles/web-sources.json',import.meta.url);let sources={schema:'awai.dapp.web-sources.v1',apps:{}};try{sources=JSON.parse(await readFile(target,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
sources.apps[key]={bytes,files};await writeFile(target,JSON.stringify(sources,null,2)+'\n');console.log({key,files:Object.keys(files).length,bytes});
