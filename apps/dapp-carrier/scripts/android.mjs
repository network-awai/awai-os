import {readFile,writeFile,mkdir,copyFile,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const app=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(app,'../..');
const profiles=JSON.parse(await readFile(resolve(app,'profiles/apps.json'),'utf8'));
const requested=process.argv.slice(2);const selected=profiles.apps.filter(p=>!requested.length||requested.includes(p.key));if(selected.length!==requested.length&&requested.length)throw Error('Unknown profile');
const cli=resolve(app,'node_modules/.bin/tauri');
for(const profile of selected){
 const root=resolve(app,'generated',profile.key),native=resolve(root,'src-tauri');
 await cp(resolve(app,'generated/common-icons'),resolve(native,'icons'),{recursive:true});
 execFileSync('npm',['run','tauri','--','android','init','--ci'],{cwd:root,stdio:'inherit'});
 const android=resolve(native,'gen/android/app/src/main');
 const plugin=resolve(android,'java/network/awai/shell');await mkdir(plugin,{recursive:true});
 for(const file of ['AwaiPeerPlugin.kt','PeerReceiveService.kt'])await copyFile(resolve(repo,'packages/awai-shell-native/android',file),resolve(plugin,file));
 const manifest=resolve(android,'AndroidManifest.xml');let xml=await readFile(manifest,'utf8');
 xml=xml.replace(/android:allowBackup="[^"]*"/g,'').replace(/android:fullBackupContent="[^"]*"/g,'').replace(/android:dataExtractionRules="[^"]*"/g,'').replace('<application','<application android:allowBackup="false" android:fullBackupContent="false" android:dataExtractionRules="@xml/awai_peer_extraction_rules"');
 for(const permission of ['INTERNET','ACCESS_LOCAL_NETWORK','FOREGROUND_SERVICE','FOREGROUND_SERVICE_DATA_SYNC','POST_NOTIFICATIONS'])if(!xml.includes('android.permission.'+permission+'"'))xml=xml.replace(/(<manifest[^>]*>)/,`$1\n<uses-permission android:name="android.permission.${permission}"/>`);
 if(!xml.includes('network.awai.shell.PeerReceiveService'))xml=xml.replace('</application>','<service android:name="network.awai.shell.PeerReceiveService" android:exported="false" android:foregroundServiceType="dataSync" android:stopWithTask="false"/></application>');
 await writeFile(manifest,xml);
 const extraction=resolve(android,'res/xml');await mkdir(extraction,{recursive:true});const exclusions=['root','file','database','sharedpref','external'].map(domain=>`<exclude domain="${domain}" path="."/>`).join('');await writeFile(resolve(extraction,'awai_peer_extraction_rules.xml'),`<data-extraction-rules><cloud-backup disableIfNoEncryptionCapabilities="true">${exclusions}</cloud-backup><device-transfer>${exclusions}</device-transfer></data-extraction-rules>`);
 const resources={values:{awai_peer_receive_channel:'Peer receiving',awai_peer_receiving:'Receiving',awai_peer_receive_description:'Receiving the approved snapshot from the selected peer.',awai_peer_stop:'Stop receiving'},'values-ja':{awai_peer_receive_channel:'Peer の受信',awai_peer_receiving:'受信中',awai_peer_receive_description:'許可した相手とスナップショットを受信しています。',awai_peer_stop:'受信を停止'}};
 for(const [locale,strings]of Object.entries(resources)){const directory=resolve(android,'res',locale);await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'awai-peer.xml'),'<resources>'+Object.entries(strings).map(([name,value])=>`<string name="${name}">${value}</string>`).join('')+'</resources>');}
 console.log(profile.key+': native peer foreground-service sources prepared');
}
