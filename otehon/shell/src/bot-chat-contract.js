export const CHAT_ORIGIN='https://21mbp.tail110d8b.ts.net:8443';
export const CHAT_MODEL='muse-spark-1.3';
// AWAI-3884: finding-9 disclosures. The conversation host runs the Muse models of
// Meta Platforms, Inc.; per the owner decision (2026-11-23) the recipient is declared
// on that US model-provider side, in the download-contract shape (AWAI-3842).
const CHAT_DISCLOSURE={recipient:'Meta Platforms, Inc.',country:'US','country-name':'United States',
 'foreign-info-url':'https://www.meta.com/','special-care':false,frequency:'one-time'};
const DATA_WORDS={'bot-profile':'bot profile','conversation-message':'conversation message',
 'agent-conversation-history':'conversation history','bot-identity':'bot identity',
 'agent-session-metadata':'session metadata','session-title':'session title',
 'bot-directory-metadata':'bot directory request','generated-image-metadata':'generated image metadata',
 'bot-session-identifiers':'session identifiers','conversation-text':'conversation text and voice',
 'model-usage-metadata':'model usage metadata','bounded-live-conversation':'live conversation audio and text'};
export const chatDisclosure=(categories,purpose,withdrawal)=>({...CHAT_DISCLOSURE,
 data:categories.map(c=>DATA_WORDS[c]??c),purpose,withdrawal});
export const chatOperation={capability:'itonami-bot-chat',service:'itonami-muse-conversation',operation:'send-message',consent:'each-operation','data-categories':['bot-profile','conversation-message','agent-conversation-history'],endpoint:{origin:CHAT_ORIGIN,routes:[{method:'POST',path:'/v1/bot-chat/turn','query-params':[]}]},disclosure:chatDisclosure(['bot-profile','conversation-message','agent-conversation-history'],'send a message to a bot and receive its reply','do not send; a sent message cannot be unsent')};
export const chatHistoryOperation={capability:"itonami-bot-chat",service:"itonami-muse-conversation",operation:"read-history",consent:"each-operation","data-categories":["bot-identity","agent-conversation-history"],endpoint:{origin:CHAT_ORIGIN,routes:[{method:"POST",path:"/v1/bot-chat/history","query-params":[]}]},disclosure:chatDisclosure(['bot-identity','agent-conversation-history'],'read the conversation history with a bot','cancel the request before it is sent')};
export const chatSessionsOperation={capability:'itonami-bot-chat',service:'itonami-muse-conversation',operation:'list-sessions',consent:'each-operation','data-categories':['bot-identity','agent-session-metadata'],endpoint:{origin:CHAT_ORIGIN,routes:[{method:'POST',path:'/v1/bot-chat/sessions','query-params':[]}]},disclosure:chatDisclosure(['bot-identity','agent-session-metadata'],'list bot conversation sessions','cancel the request before it is sent')};
export const chatCreateOperation={...chatSessionsOperation,operation:'create-session','data-categories':['bot-identity','session-title'],disclosure:chatDisclosure(['bot-identity','session-title'],'start a new bot conversation session','cancel before the session is created')};

export const chatBotsOperation={capability:'itonami-bot-chat',service:'itonami-muse-conversation',operation:'list-bots',consent:'each-operation','data-categories':['bot-directory-metadata'],endpoint:{origin:CHAT_ORIGIN,routes:[{method:'POST',path:'/v1/bot-chat/bots','query-params':[]}]},disclosure:chatDisclosure(['bot-directory-metadata'],'list the bots available for conversation','cancel the request before it is sent')};
export const chatMediaOperation={capability:'itonami-bot-chat',service:'itonami-muse-conversation',operation:'record-local-image',consent:'each-operation','data-categories':['bot-identity','conversation-message','generated-image-metadata'],endpoint:{origin:CHAT_ORIGIN,routes:[{method:'POST',path:'/v1/bot-chat/media','query-params':[]}]},disclosure:chatDisclosure(['bot-identity','conversation-message','generated-image-metadata'],'record a locally generated image in the conversation','cancel before the image is recorded')};
