// Build-time only: use the same pinned canonical validator and online declaration as the client.
import {pathToFileURL} from 'node:url';
let text='';for await(const chunk of process.stdin)text+=chunk;
const {assets,pins,descriptor}=JSON.parse(text);
const {onlineRuntime}=await import(pathToFileURL(assets+'/online.js'));
const {clientRuntimeConnectSrc}=await import(pathToFileURL(assets+'/runtime.js'));
process.stdout.write(clientRuntimeConnectSrc(onlineRuntime(descriptor,pins),['store-download'],[],'https://appassets.androidplatform.net'));
