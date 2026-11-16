// Read-only host prerequisite census. Never dispatches a bot or infers a run.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [catalogFile,inventoryFile,out]=process.argv.slice(2);
if(!out) throw Error('usage: node observe-runtime.mjs CATALOG HOST_INVENTORY NEW_REPORT');
const bytes=await readFile(catalogFile),catalog=JSON.parse(bytes);
const inventory=JSON.parse(await readFile(inventoryFile));
const hosts=inventory.nodes?.map(n=>n.node);
if(catalog.schema!=='awai.bot-fleet.v1'||!Array.isArray(hosts)||!hosts.length||hosts.length>64
  ||new Set(hosts).size!==hosts.length||hosts.some(h=>!/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(h))) throw Error('invalid binding');
const exec=promisify(execFile);
// Only existence booleans and process executable basenames. No argv, secrets,
// credentials, profile reads or existing service mutations leave the host.
const probe=`(require '[cheshire.core :as j] '[clojure.java.shell :as sh] '[clojure.string :as s])
(let [names (map #(last (s/split % #"/")) (s/split-lines (:out (sh/sh "ps" "-A" "-o" "comm="))))
 tools (into {} (for [n ["bb" "muse" "itonami" "itonami-agent"]] [n (zero? (:exit (sh/sh "/bin/sh" "-c" (str "command -v " n " >/dev/null 2>&1"))))]))]
 (println (j/generate-string {:schema "awai.host-bot-prerequisites.v1" :tools tools
 :unattributedProcessCount (count (filter #{"muse" "itonami" "itonami-agent" "itonami-otehon"} names))})))`;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const nodes=await Promise.all(hosts.map(async node=>{
 try {
 const {stdout}=await exec('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',
 '-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','PermitLocalCommand=no','-T','node@'+node,
 'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin"; export PATH; bb -e '+quote(probe)],{timeout:20000,maxBuffer:16384});
 const data=JSON.parse(stdout);
 if(data.schema!=='awai.host-bot-prerequisites.v1'||!data.tools||!Number.isSafeInteger(data.unattributedProcessCount))throw Error();
 return {node,status:'observed',...data};
 }catch{return {node,status:'unobserved'};}
}));
const report={schema:'awai.bot-fleet-observation.v1',observedAt:new Date().toISOString(),
 registryRevision:catalog['registry-revision'],catalogSha256:createHash('sha256').update(bytes).digest('hex'),
 sourceIssue:'AWAI-2795',scope:'host-prerequisites-only',continuousMonitoring:false,
 nodes,runs:[],gates:{nodeAdmission:'unverified',durableCursor:'unverified',fencedEffects:'unverified',
 liveItonamiMuseAdapter:'unverified-by-this-census',guestExecutor:'unverified'},
 note:'Host CLI/process census is not VM access, bot execution or authorization. No dispatch performed.'};
await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({observedAt:report.observedAt,nodes: nodes.map(n=>({node:n.node,status:n.status,tools:n.tools})),qualifiedRuns:0}));
