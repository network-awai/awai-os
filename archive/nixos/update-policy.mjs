// Offline Kotoba policy runtime; no Maven/npm/git/network access on the Node.
import {loadString} from './update-policy-runtime/nbb_api.js';
import {readFile} from 'node:fs/promises';
const {source}=JSON.parse(await readFile(new URL('./update-policy-runtime/policy-source.json',import.meta.url),'utf8'));
await loadString(source,{disableConfig:true});
export async function decide(request) {
 const literal=JSON.stringify(JSON.stringify(request));
 return loadString(`(clj->js (let [r (js->clj (js/JSON.parse ${literal}) :keywordize-keys true)]
 (if (= "trial" (:operation r))
  (grant.update-lifecycle/trial-decision (update (:evidence r) :local-health keyword))
  (grant.update-lifecycle/decide
   (-> (:release r) (update :channel keyword) (update :security-risk keyword) (update :apply-risk keyword))
   (cond-> (:policy r) (:mode (:policy r)) (update :mode keyword) (:channel (:policy r)) (update :channel keyword) (:max-apply-risk (:policy r)) (update :max-apply-risk keyword))
   (:evidence r) (:now r)))))`,{disableConfig:true});
}
