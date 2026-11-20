import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const policy=JSON.parse(readFileSync(new URL('./voice-policy.json',import.meta.url)));
const clean=s=>String(s||'').normalize('NFKC').trim().toLowerCase().replace(/[。！？.!?]/g,'');
const chars={エー:'a',ビー:'b',シー:'c',ディー:'d',イー:'e',エフ:'f',ジー:'g',エイチ:'h',アイ:'i',ジェー:'j',ケー:'k',エル:'l',エム:'m',エヌ:'n',オー:'o',ピー:'p',キュー:'q',アール:'r',エス:'s',ティー:'t',ユー:'u',ブイ:'v',ダブリュー:'w',エックス:'x',ワイ:'y',ゼット:'z',ゼロ:'0',イチ:'1',ニ:'2',サン:'3',ヨン:'4',ゴ:'5',ロク:'6',ナナ:'7',ハチ:'8',キュウ:'9',ハイフン:'-',アンダースコア:'_',アットマーク:'@',ドット:'.',スペース:' ',シャープ:'#',ビックリマーク:'!'};
export function secretCharacters(raw){
  let text=String(raw).normalize('NFKC').trim().replace(/[。！？.!?]+$/, '').replace(/(?:を入力|です)$/, '').trim(),upper=false,lower=false;
  if(/^(?:数字(?:の)?|digit\s+)/i.test(text)){text=text.replace(/^(?:数字(?:の)?\s*|digit\s+)/i, '');const digits={零:'0',一:'1',二:'2',三:'3',四:'4',五:'5',六:'6',七:'7',八:'8',九:'9',zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9'};text=text.toLowerCase();return digits[text]??(/^[0-9]$/.test(text)?text:null);}
  if(/^大文字|^uppercase /i.test(text)){upper=true;text=text.replace(/^(?:大文字(?:の)?\s*|uppercase\s+)/i,'');}
  if(/^小文字|^lowercase /i.test(text)){lower=true;text=text.replace(/^(?:小文字(?:の)?\s*|lowercase\s+)/i,'');}
  const named={dot:'.',period:'.',hyphen:'-',underscore:'_',space:' ',"at sign":'@',hash:'#',"exclamation mark":'!',alpha:'a',bravo:'b',charlie:'c',delta:'d',echo:'e',foxtrot:'f',golf:'g',hotel:'h',india:'i',juliet:'j',kilo:'k',lima:'l',mike:'m',november:'n',oscar:'o',papa:'p',quebec:'q',romeo:'r',sierra:'s',tango:'t',uniform:'u',victor:'v',whiskey:'w',xray:'x',yankee:'y',zulu:'z'};
  const value=chars[text]??named[text.toLowerCase()]??(/^[A-Za-z0-9@#_!.+\-]{1,64}$/.test(text)?text:null);
  return value===null?null:upper?value.toUpperCase():lower?value.toLowerCase():value;
}
export class VoiceControl {
  constructor({model,speak=async()=>{},dispatch=()=>{},now=Date.now}={}){Object.assign(this,{model,speak,dispatch,now});this.session=randomUUID();this.generation=0;this.screen=null;this.used=new Set();this.secret='';this.confirmation=null;}
  update(screen){
    if(!screen||!Number.isSafeInteger(screen.revision)||!['language','menu','input','secret','erase','approval','message','busy'].includes(screen.kind))throw Error('Invalid voice screen');
    if(this.screen&&screen.revision<=this.screen.revision)return false;
    this.generation++;this.secret='';this.confirmation=null;this.screen=structuredClone(screen);return true;
  }
  invalidate(){this.generation++;this.screen=null;this.secret='';this.confirmation=null;}
  valid(revision,generation){return !!this.screen&&this.screen.revision===revision&&this.generation===generation;}
  async utterance(raw,{id=randomUUID()}={}){
    if(!this.screen||this.used.has(id)||typeof raw!=='string'||raw.length>policy['max-utterance-chars'])return {status:'ignored'};
    this.used.add(id);if(this.used.size>128)this.used.delete(this.used.values().next().value);
    const revision=this.screen.revision,generation=this.generation,s=this.screen,text=clean(raw);
    const say=async (ja,en)=>{if(this.valid(revision,generation))await this.speak(s.language==='en'?en:ja);};
    const send=(action,value=null)=>{if(!this.valid(revision,generation))return {status:'stale'};this.generation++;this.secret='';this.dispatch({session:this.session,revision,utteranceId:id,action,value});return {status:'dispatched',action};};
    if(/^(戻る|やめる|キャンセル|back|cancel)$/.test(text)&&s.canBack)return send('back');
    if(s.kind==='secret'){
      // No model, history, spoken value, or transcript event in this branch.
      if(policy['secret-complete'].includes(text)){if(!this.secret){await say('まだ文字を入力していません。小文字のBを入力、のように話してください','No characters entered yet. Say lowercase B');return {status:'secret'};}const value=this.secret;this.secret='';return send('input',value);}
      if(policy['secret-delete'].includes(text)){this.secret=this.secret.slice(0,-1);await say('一文字消しました','Deleted one character');return {status:'secret'};}
      const value=secretCharacters(raw);
      if(value===null||this.secret.length+value.length>128){await say('一文字ずつ、大文字や記号も指定してください','Spell characters, including case and symbols');return {status:'secret'};}
      this.secret+=value;await say(`${this.secret.length}文字を入力しました`,`${this.secret.length} characters entered`);return {status:'secret'};
    }
    const settings=[[/^(音楽を止めて|bgmを止めて|音楽を停止|stop music)$/,'music_off'],[/^(音楽を流して|bgmを流して|play music)$/,'music_on'],[/^(音量を上げて|volume up)$/,'volume_up'],[/^(音量を下げて|volume down)$/,'volume_down']];
    const setting=settings.find(([pattern])=>pattern.test(text));
    if(setting){this.confirmation=null;return send('control',setting[1]);}
    if(s.kind==='erase'){
      if(!s.serial||!s.target){await say('製造番号を確認できません。画面で確認してください','Serial unavailable. Please check the screen');return {status:'refused'};}
      const suffix=s.serial.slice(-4),request=s.language==='en'?`erase ${suffix} and install`:`番号${suffix}のディスクを消してインストール`;
      if(text!==clean(request)){this.confirmation={revision,expires:this.now()+policy['confirmation-seconds']*1000};await say(`この操作で${s.target}の全データが失われます。実行する場合は「${request}」と話してください`,`All data on ${s.target} will be erased. To proceed say: ${request}`);return {status:'confirmation'};}
      if(!this.confirmation||this.now()>this.confirmation.expires){this.confirmation={revision,expires:this.now()+policy['confirmation-seconds']*1000};await say('対象を確認しました。実行する場合はもう一度話してください','Target checked. Repeat the confirmation to proceed');return {status:'confirmation'};}
      this.confirmation=null;return send('erase',s.target);
    }
    if(s.kind==='input'){if(/^(入力|enter)\s+/i.test(raw))return send('input',raw.replace(/^(入力|enter)\s+/i,''));}
    if(/^(次へ|続けて|続行|continue|next|再起動して|restart)$/.test(text)&&s.canContinue)return send('continue');
    if(s.kind==='approval'&&/^(音で送って|音でコードを送って|send code|send sound)$/.test(text))return send('send_code');
    if(s.kind==='language'){
      if(/^(日本語|日本語で|japanese)$/.test(text))return send('choose','ja');
      if(/^(英語|英語で|english)$/.test(text))return send('choose','en');
    }
    if(s.kind==='menu'){
      const match=text.match(/^(?:上から|選択|choose|option)?\s*(\d+)(?:番目|番)?$/);
      if(match&&s.choices?.[Number(match[1])-1])return send('choose',s.choices[Number(match[1])-1].id);
    }
    const result=await this.model({language:s.language,screen:{kind:s.kind,message:s.message,choices:s.choices||[],canBack:!!s.canBack,canContinue:!!s.canContinue},utterance:raw});
    if(!this.valid(revision,generation))return {status:'stale'};
    if(!result||!policy.actions.includes(result.action)||typeof result.speech!=='string'||result.speech.length>policy['max-speech-chars'])return {status:'refused'};
    if(result.action==='answer'){await this.speak(result.speech);return {status:'answered'};}
    if(result.action==='choose'&&['menu','language'].includes(s.kind)&&s.choices?.some(c=>c.id===result.choice))return send('choose',result.choice);
    if(result.action==='back'&&s.canBack)return send('back');
    if(result.action==='continue'&&s.canContinue)return send('continue');
    if(result.action==='send_code'&&s.kind==='approval')return send('send_code');
    return {status:'refused'};
  }
}
