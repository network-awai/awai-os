// Model downloads as canonical client-runtime operations (AWAI-3307). One host-stream artifact operation
// per pinned catalog file: a fixed GET of its immutable revision on huggingface.co, delivery redirects
// limited to Hugging Face's CDN hosts, and the file's SHA-256 and exact size as the byte budget.
// AWAI-3842: each operation carries its finding-9 disclosure. Hugging Face, Inc. is a US company, so the
// foreign-recipient fields are required; the info URL is the recipient's own site (verified 200 on 2026-11-22).
export const DOWNLOAD_CAPABILITY='awai.murakumo.model-download';
export const DOWNLOAD_SERVICE='huggingface';
export const operationFor=id=>`download-${id}`;
const DOWNLOAD_DISCLOSURE={recipient:'Hugging Face',country:'US','country-name':'United States',
 'foreign-info-url':'https://huggingface.co/',data:['public model file request'],'special-care':false,
 purpose:'download the pinned model file for on-device inference',frequency:'one-time',
 withdrawal:'cancel before it finishes, or delete the downloaded file',
 note:'Only the file request is sent. No account, prompt, or personal data leaves the device.'};
export function runtimeFor(catalog){
 return {schema:'kotoba.app.client-runtime.v1',target:'browser',profile:'trusted-page-v1',entry:'index.html',
  'local-state':{adapter:'memory',schema:'awai.murakumo.view.v1',version:1},workers:[],
  operations:catalog.models.map(m=>({capability:DOWNLOAD_CAPABILITY,service:DOWNLOAD_SERVICE,operation:operationFor(m.id),consent:'each-operation',
   'data-categories':['public-model-file'],endpoint:{origin:'https://huggingface.co',method:'GET',path:`/${m.repo}/resolve/${m.revision}/${m.file}`},
   'redirect-origins':['https://*.cdn.hf.co'],artifact:{revision:m.revision,sha256:m.sha256,'max-bytes':m.bytes,delivery:'host-stream'},
   disclosure:{...DOWNLOAD_DISCLOSURE}}))};
}
