import {CHAT_ORIGIN} from './bot-chat-contract.js';
export const VOICE_DURATION_MS=180000,VOICE_MAX_TURNS=12,VOICE_PROTOCOL='awai.bot-voice.v1';
export const VOICE_PATH='/v1/bot-chat/voice';
export const VOICE_ORIGIN=CHAT_ORIGIN.replace(/^https:/,'wss:');
export const voiceOperation=Object.freeze({capability:'itonami-bot-voice',service:'itonami-muse-conversation',operation:'converse-3min-12turns',consent:'each-operation','data-categories':['bot-session-identifiers','conversation-text','model-usage-metadata','bounded-live-conversation'],endpoint:{origin:CHAT_ORIGIN,'browser-action':'open-bot-voice-session-v1'}});
export function voiceScope(scope){if(!scope||Object.keys(scope).sort().join(',')!=='botId,sessionId'||!/^profile:[\w.-]+$/.test(scope.botId)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(scope.sessionId))throw Error('invalid-voice-scope');return Object.freeze({botId:scope.botId,sessionId:scope.sessionId})}
export function voiceConnectSrc(connect,operations){return operations.some(o=>o.capability===voiceOperation.capability&&o.service===voiceOperation.service&&o.operation===voiceOperation.operation&&o.endpoint.origin===CHAT_ORIGIN&&o.endpoint['browser-action']===voiceOperation.endpoint['browser-action'])?`${connect} ${VOICE_ORIGIN}`:connect;}
