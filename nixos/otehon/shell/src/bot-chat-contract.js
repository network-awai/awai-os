export const CHAT_ORIGIN='https://21mbp.tail110d8b.ts.net:8443';
export const CHAT_MODEL='muse-spark-1.3';
export const chatOperation={capability:'itonami-bot-chat',service:'itonami-muse-conversation',operation:'send-message',consent:'each-operation','data-categories':['bot-profile','conversation-message','agent-conversation-history'],endpoint:{origin:CHAT_ORIGIN,routes:[{method:'POST',path:'/v1/bot-chat/turn','query-params':[]}]}};
export const chatHistoryOperation={capability:"itonami-bot-chat",service:"itonami-muse-conversation",operation:"read-history",consent:"each-operation","data-categories":["bot-identity","agent-conversation-history"],endpoint:{origin:CHAT_ORIGIN,routes:[{method:"POST",path:"/v1/bot-chat/history","query-params":[]}]}};
