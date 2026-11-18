(() => { const k = Object.keys(localStorage).find(k => k.endsWith(':network.itonami.isekai')); const env = JSON.parse(localStorage.getItem(k));
  env.data = {schema: 'itonami.isekai.drafts.v0', drafts: [{legacy: true}]}; localStorage.setItem(k, JSON.stringify(env)); location.hash = '#/'; location.reload(); return env.revision; })()
