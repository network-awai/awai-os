(async () => { const wait = ms => new Promise(r => setTimeout(r, ms));
  const k = Object.keys(localStorage).find(k => k.endsWith(':network.itonami.isekai')); const before = localStorage.getItem(k);
  const out = {startup: document.getElementById('status').textContent, saveDisabled: document.querySelector('form button[type=submit]').disabled};
  for (const [id, v] of [['game', 'neon-run'], ['author', 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'], ['message', 'overwrite?']]) { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); }
  document.querySelector('form').requestSubmit(); await wait(500); out.afterSubmit = document.getElementById('status').textContent;
  location.hash = '#/drafts'; await wait(400); out.draftsView = document.getElementById('status').textContent;
  out.storageUnchanged = localStorage.getItem(k) === before; return out; })()
