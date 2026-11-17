import {bind_native} from './awai-ui/index.js';
// Product-local adapter: existing DOM/React events own behavior and approval.
bind_native(document.documentElement,{tonal:'.secondary,.theme-switcher button',text:'.dapp,.new-chat,.device-dock button,.node-dock button'});
const root=document.documentElement;
const applyTheme=()=>{root.dataset.awaiTheme={Asa:'light',Hiru:'hiru',Yoru:'dark'}[root.dataset.theme]||'light'};
applyTheme();new MutationObserver(applyTheme).observe(root,{attributes:true,attributeFilter:['data-theme']});
