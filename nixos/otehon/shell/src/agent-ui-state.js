// Shared ephemeral navigation only. No messages, credentials or browser storage.
let selection={botId:null,sessionId:'default',recent:[]};const subscribers=new Set();
export const readAgentSelection=()=>selection;
export function chooseAgent(botId,sessionId='default'){selection={botId,sessionId,recent:[botId,...selection.recent.filter(x=>x!==botId)].slice(0,8)};for(const fn of subscribers)fn(selection);return selection;}
export function subscribeAgentSelection(fn){subscribers.add(fn);return()=>subscribers.delete(fn);}
