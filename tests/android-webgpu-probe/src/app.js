import {runProbe, browserUsage} from './probe.js';

const $ = id => document.getElementById(id);
const label = {ok: 'WebGPU は使えます', unavailable: 'WebGPU は使えません', failed: 'WebGPU の検査に失敗しました'};

async function main() {
  $('status').textContent = '検査しています…';
  const result = await runProbe({gpu: navigator.gpu, canvas: $('frame'), usage: browserUsage(globalThis),
    userAgent: navigator.userAgent});
  document.body.dataset.status = result.status;
  $('verdict').textContent = label[result.status] ?? result.status;
  $('reason').textContent = result.reason ?? '';
  $('result').textContent = JSON.stringify(result, null, 2);
  $('status').textContent = '';
  // Read from logcat by the verification script; the line holds no user data.
  console.log('WEBGPU_PROBE_RESULT ' + JSON.stringify(result));
}

main().catch(e => {
  document.body.dataset.status = 'failed';
  $('verdict').textContent = label.failed;
  $('reason').textContent = String(e?.message ?? e);
  console.log('WEBGPU_PROBE_RESULT ' + JSON.stringify({status: 'failed', reason: String(e?.message ?? e)}));
});
