export const PACK_LIMIT=12*1024*1024;
export function runtimeFor(origin=''){
 const operations=[];
 if(origin){const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password)throw Error('invalid-sync-origin');
 for(const [operation,method] of [['upload','PUT'],['download','GET']])operations.push({capability:'awai.drive.sync',service:'awai.fs',operation,endpoint:{origin,routes:[{method,'path-prefix':'/awai-drive/v1/packs/','query-params':[]}]},'data-categories':['encrypted-files','encrypted-metadata','opaque-pack-id'],consent:'each-operation'});}
 return {schema:'kotoba.app.client-runtime.v1',target:'browser',profile:'trusted-page-v1',entry:'index.html','local-state':{adapter:'memory',schema:'awai.drive.view.v1',version:1},workers:[],operations};
}
