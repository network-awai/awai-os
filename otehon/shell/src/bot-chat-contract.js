export const CHAT_ORIGIN='https://21mbp.tail110d8b.ts.net:8443';
export const CHAT_MODEL='muse-spark-1.3';
// AWAI-3883: finding-9 disclosure for the tailnet bot-chat/mail/voice operations (Legal decision via
// Organizer, 2026-11-23; recipient definition corrected 2026-11-23; country nullable validator
// 2026-11-23). Recipient is limited to the entity that operates the endpoint processing logic AND
// decides the purpose of data use (データの利用目的を決める主体); Tailscale is transport
// (processor), not the recipient. The recipient is expressed as the pinned device id
// (Murakumo #432 precedent shape: `pinned device <id>`); the id is the CHAT_ORIGIN host label.
// Country is UNCONFIRMED: no code is written (country null, countryStatus pending); the
// user-visible note carries the provisional wording and confirmCondition what would confirm it.
// Frequency is validator 'one-time' for each-operation consent (all precedents).
export const CHAT_DISCLOSURE={recipient:'pinned device 21mbp',country:null,countryStatus:'pending',
 data:['会話内容','送信文','別名','identity 状態'],'special-care':false,
 purpose:'自分の端末で bot とやり取り／別名管理',frequency:'one-time',
 withdrawal:'端末側の記録削除と Tailscale 切断で撤回',
 note:'所在国 未確認（暫定: 日本）',confirmCondition:'operator location の確認'};
export const chatOperation={capability:'itonami-bot-chat',service:'itonami-muse-conversation',operation:'send-message',consent:'each-operation','data-categories':['bot-profile','conversation-message','agent-conversation-history'],endpoint:{origin:CHAT_ORIGIN,routes:[{method:'POST',path:'/v1/bot-chat/turn','query-params':[]}]},disclosure:{...CHAT_DISCLOSURE}};
export const chatHistoryOperation={capability:"itonami-bot-chat",service:"itonami-muse-conversation",operation:"read-history",consent:"each-operation","data-categories":["bot-identity","agent-conversation-history"],endpoint:{origin:CHAT_ORIGIN,routes:[{method:"POST",path:"/v1/bot-chat/history","query-params":[]}]},disclosure:{...CHAT_DISCLOSURE}};
export const chatSessionsOperation={capability:'itonami-bot-chat',service:'itonami-muse-conversation',operation:'list-sessions',consent:'each-operation','data-categories':['bot-identity','agent-session-metadata'],endpoint:{origin:CHAT_ORIGIN,routes:[{method:'POST',path:'/v1/bot-chat/sessions','query-params':[]}]},disclosure:{...CHAT_DISCLOSURE}};
export const chatCreateOperation={...chatSessionsOperation,operation:'create-session','data-categories':['bot-identity','session-title']};

export const chatBotsOperation={capability:'itonami-bot-chat',service:'itonami-muse-conversation',operation:'list-bots',consent:'each-operation','data-categories':['bot-directory-metadata'],endpoint:{origin:CHAT_ORIGIN,routes:[{method:'POST',path:'/v1/bot-chat/bots','query-params':[]}]},disclosure:{...CHAT_DISCLOSURE}};
export const chatMediaOperation={capability:'itonami-bot-chat',service:'itonami-muse-conversation',operation:'record-local-image',consent:'each-operation','data-categories':['bot-identity','conversation-message','generated-image-metadata'],endpoint:{origin:CHAT_ORIGIN,routes:[{method:'POST',path:'/v1/bot-chat/media','query-params':[]}]},disclosure:{...CHAT_DISCLOSURE}};
