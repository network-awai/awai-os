// Model downloads as canonical client-runtime operations (AWAI-3307). One host-stream artifact operation
// per pinned catalog file: a fixed GET of its immutable revision on huggingface.co, delivery redirects
// limited to Hugging Face's CDN hosts, and the file's SHA-256 and exact size as the byte budget.
export const DOWNLOAD_CAPABILITY='awai.murakumo.model-download';
export const DOWNLOAD_SERVICE='huggingface';
export const operationFor=id=>`download-${id}`;
export function runtimeFor(catalog){
 return {schema:'kotoba.app.client-runtime.v1',target:'browser',profile:'trusted-page-v1',entry:'index.html',
  'local-state':{adapter:'memory',schema:'awai.murakumo.view.v1',version:1},workers:[],
  operations:catalog.models.map(m=>({capability:DOWNLOAD_CAPABILITY,service:DOWNLOAD_SERVICE,operation:operationFor(m.id),consent:'each-operation',
   'data-categories':['public-model-file'],endpoint:{origin:'https://huggingface.co',method:'GET',path:`/${m.repo}/resolve/${m.revision}/${m.file}`},
   'redirect-origins':['https://*.cdn.hf.co'],artifact:{revision:m.revision,sha256:m.sha256,'max-bytes':m.bytes,delivery:'host-stream'}}))};
}
