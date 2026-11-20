import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const languages=['ja','en'];
export function readLanguage(dir='/var/lib/murakumo') {
  try {const value=readFileSync(join(dir,'ui-language'),'utf8').trim();return languages.includes(value)?value:null;}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function saveLanguage(value,dir='/var/lib/murakumo') {
  if(!languages.includes(value))throw Error('Unsupported language');
  mkdirSync(dir,{recursive:true,mode:0o700});
  const target=join(dir,'ui-language'),temporary=target+'.'+randomUUID()+'.tmp';
  writeFileSync(temporary,value+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,target);
}
export function chooseLanguage(ui,dir='/var/lib/murakumo') {
  let value=process.env.MURAKUMO_UI_LANG;
  // GTK chooses before launching the backend. Console fallback uses the same choices.
  if(process.env.MURAKUMO_UI_LANGUAGE_SELECTED!=='1') {
    value=ui.menu('言語を選択 / Choose your language', [['ja','日本語'],['en','English']])||readLanguage(dir)||'en';
  }
  saveLanguage(value,dir);process.env.MURAKUMO_UI_LANG=value;return value;
}
