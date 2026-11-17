import {createBroker} from './runtime.js';
import {aliasOperations,identityOperations,MAIL_ORIGIN} from './mail-alias-contract.js';
export function validateAliases(v,botId){
 if(v?.schema!=='itonami.mail-alias-result.v1'||v.botId!==botId||!/^[a-f0-9-]{36}$/.test(v.principalId??'')||!/^did:key:z[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(v.did??'')||!Number.isSafeInteger(v.epoch)||v.epoch<0||v.routing!=='not-provisioned'||v.store?.owner!=='itonami-agent'||v.store?.readback!==true||v.store?.engine!=='kotobase-peer'||v.store?.backend!=='awai-fs-otehon-pack'||v.basis!==v.store.headCid||!Array.isArray(v.aliases)||v.aliases.length>1000)throw Error('invalid-mail-result');
 const ids=new Set(),addresses=new Set();for(const a of v.aliases){if(!/^[a-f0-9]{32}$/.test(a.aliasId??'')||!/^[a-f0-9]{40}@awai\.network$/.test(a.address??'')||!['reserved','stopped','expired'].includes(a.state)||a.routing!=='not-provisioned'||typeof a.purpose!=='string'||a.purpose.length>120||typeof a.counterparty!=='string'||a.counterparty.length>254||ids.has(a.aliasId)||addresses.has(a.address))throw Error('invalid-mail-result');ids.add(a.aliasId);addresses.add(a.address);}return v;
}
export async function manageAliases(botId,action,values={},broker){
 if(!/^profile:[\w.-]+$/.test(botId)||!['list','issue','stop'].includes(action))throw Error('invalid-mail-request');
 const operation=aliasOperations.find(o=>o.operation===action+'-alias');broker??=createBroker('index.html',[operation]);
 const r=await broker.invoke({capability:operation.capability,service:operation.service,operation:operation.operation},{input:MAIL_ORIGIN+'/v1/mail/aliases/'+action,init:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...values,botId,action})}});
 if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error==='identity-store-stale'?'identityStoreStale':e.error==='identity-recovery-required'?'identityRecoveryRequired':e.error==='mail-binding-required'?'mailBindingRequired':e.error==='mail-basis-changed'?'mailReloadRequired':'mailAliasUnavailable');}
 return validateAliases(await r.json(),botId);
}
export async function manageIdentity(botId,action,broker){
 if(!/^profile:[\w.-]+$/.test(botId)||!['status','recover'].includes(action))throw Error('invalid-identity-request');
 const op=identityOperations.find(o=>o.operation===action+'-identity');broker??=createBroker('index.html',[op]);
 const r=await broker.invoke({capability:op.capability,service:op.service,operation:op.operation},{input:MAIL_ORIGIN+'/v1/mail/identity/'+action,init:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({botId,action})}});
 if(!r.ok)throw Error('identityRecoveryRequired');const v=await r.json();
 if(v.schema!=='itonami.identity-status.v1'||v.state!=='verified'||v.botId!==botId||typeof v.did!=='string'||typeof v.principalId!=='string'||v.store?.readback!==true)throw Error('identityRecoveryRequired');return v;
}
