import {CHAT_ORIGIN} from './bot-chat-contract.js';
export const MAIL_ORIGIN=CHAT_ORIGIN;
// AWAI-3884: finding-9 disclosures, in the download-contract shape (AWAI-3842).
// The mail host is our own service; per the owner decision (2026-11-23) the
// recipient is declared as the US entity that operates it.
const MAIL_DISCLOSURE={recipient:'Kotoba Labs, Inc.',country:'US','country-name':'United States',
 'foreign-info-url':'https://kotobalabs.com/','special-care':false,frequency:'one-time'};
const DATA_WORDS={'agent-identity':'agent identity','identity-custody-metadata':'identity custody metadata',
 'mail-purpose':'stated mail purpose','mail-counterparty':'mail counterparty','private-mail-aliases':'private mail aliases'};
const disclosure=(categories,purpose,withdrawal)=>({...MAIL_DISCLOSURE,
 data:categories.map(c=>DATA_WORDS[c]??c),purpose,withdrawal});
const IDENTITY_PURPOSES={status:['read the agent identity status','cancel the request before it is sent'],
 recover:['recover the agent identity','cancel before recovery starts']};
export const identityOperations=['status','recover'].map(action=>({capability:'itonami-mail-aliases',service:'itonami-agent-identity',operation:action+'-identity',consent:'each-operation','data-categories':['agent-identity','identity-custody-metadata'],endpoint:{origin:MAIL_ORIGIN,routes:[{method:'POST',path:'/v1/mail/identity/'+action,'query-params':[]}]},disclosure:disclosure(['agent-identity','identity-custody-metadata'],IDENTITY_PURPOSES[action][0],IDENTITY_PURPOSES[action][1])}));
const ALIAS_PURPOSES={list:['list your mail aliases','cancel the request before it is sent'],
 issue:['issue a new mail alias','cancel before the alias is issued'],
 stop:['stop a mail alias','cancel before the alias is stopped']};
export const aliasOperations=['list','issue','stop'].map(action=>{const categories=action==='issue'?['agent-identity','mail-purpose','mail-counterparty']:['agent-identity','private-mail-aliases'];return {capability:'itonami-mail-aliases',service:'itonami-agent-mail',operation:action+'-alias',consent:'each-operation','data-categories':categories,endpoint:{origin:MAIL_ORIGIN,routes:[{method:'POST',path:'/v1/mail/aliases/'+action,'query-params':[]}]},disclosure:disclosure(categories,ALIAS_PURPOSES[action][0],ALIAS_PURPOSES[action][1])};});
