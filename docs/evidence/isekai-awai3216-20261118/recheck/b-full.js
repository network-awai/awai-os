(async () => { const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const [id, v] of [['game', 'neon-run'], ['author', 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'], ['message', 'fifty-first']]) { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); }
  document.querySelector('form').requestSubmit(); await wait(500);
  const k = Object.keys(localStorage).find(k => k.endsWith(':network.itonami.isekai'));
  return {status: document.getElementById('status').textContent, stored: JSON.parse(localStorage.getItem(k)).data.drafts.length}; })()
