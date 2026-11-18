(() => { const k = Object.keys(localStorage).find(k => k.endsWith(':network.itonami.isekai')); const env = JSON.parse(localStorage.getItem(k));
  const one = env.data.drafts[0]; env.data.drafts = Array.from({length: 50}, (_, i) => ({...one, id: 'full-' + i}));
  localStorage.setItem(k, JSON.stringify(env)); location.hash = '#/'; location.reload(); return env.revision; })()
