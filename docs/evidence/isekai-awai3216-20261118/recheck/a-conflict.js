(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const key = Object.keys(localStorage).find(k => k.endsWith(':network.itonami.isekai'));
  const fill = (g, m) => { location.hash = '#/'; return wait(300).then(() => {
    for (const [id, v] of [['game', g], ['parent', ''], ['author', 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'], ['message', m]]) { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); }
    document.querySelector('form').requestSubmit(); return wait(500); }); };
  const out = {};
  await fill('neon-run', 'first'); out.first = document.getElementById('status').textContent;
  const k = key ?? Object.keys(localStorage).find(k => k.endsWith(':network.itonami.isekai'));
  const env = JSON.parse(localStorage.getItem(k)); out.revisionBefore = env.revision;
  env.revision += 1; localStorage.setItem(k, JSON.stringify(env));   // another window wrote
  await fill('neon-run', 'second'); out.afterConflict = document.getElementById('status').textContent;
  await fill('neon-run', 'third'); out.retry = document.getElementById('status').textContent;
  const end = JSON.parse(localStorage.getItem(k)); out.revisionEnd = end.revision; out.messages = end.data.drafts.map(d => d.draft.message);
  return out;
})()
