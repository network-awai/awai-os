import {showNodeStatus} from '/etc/murakumo/node-status.mjs';
import {dialogUI, setupNetwork, text} from '/etc/murakumo/network-setup.mjs';
import {link,savedLink} from '/etc/murakumo/account-link.mjs';
import {approvalScreen,registerWithUI,runSetup} from '/etc/murakumo/registration-ui.mjs';
import {spawnSync} from 'node:child_process';

import {completeLocal,readLocal} from '/etc/murakumo/local-setup.mjs';
import {chooseLanguage} from '/etc/murakumo/language.mjs';
import {showRemote} from '/etc/murakumo/remote-ui.mjs';
import {showUpdates} from '/etc/murakumo/update-ui.mjs';
const ui=dialogUI('installed');
chooseLanguage(ui);
await runSetup({
  ui,t:text,showStatus:()=>showNodeStatus(ui,text),showRemote:()=>showRemote(ui,text),showUpdates:()=>showUpdates(ui,text),readSaved:savedLink,readLocal,completeLocal,
  network:options=>setupNetwork({stage:'installed',ui,...options}),
  register:onFailure=>registerWithUI({link,screen:approvalScreen,ui,t:text,onFailure}),
  poweroff:()=>spawnSync('systemctl',['poweroff'],{stdio:'inherit'}).status===0,
});
