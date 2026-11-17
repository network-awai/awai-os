(async () => { const wait = ms => new Promise(r => setTimeout(r, ms));
  const k = () => Object.keys(localStorage).find(k => k.endsWith(':network.itonami.isekai'));
  for (const [id, v] of [['game', 'neon-run'], ['author', 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'], ['message', 'keep me?']]) { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); }
  document.querySelector('form').requestSubmit(); await wait(500);
  location.hash = '#/drafts'; await wait(400);
  const del = () => [...document.querySelectorAll('.actions button')][1];
  const stored = () => JSON.parse(localStorage.getItem(k())).data.drafts.length;
  const out = {saved: stored()};
  del().click(); await wait(300); out.afterFirstTap = {label: del().textContent, status: document.getElementById('status').textContent, stored: stored()};
  await wait(5300); out.after5s = {label: del().textContent, stored: stored()};
  del().click(); await wait(200); del().click(); await wait(500);
  out.afterTwoTaps = {status: document.getElementById('status').textContent, stored: stored()};
  return out; })()
