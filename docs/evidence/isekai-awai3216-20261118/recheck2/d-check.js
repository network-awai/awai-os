(() => { const k = Object.keys(localStorage).find(k => k.endsWith(':network.itonami.isekai'));
  return {status: document.getElementById('status').textContent, deleteButtons: document.querySelectorAll('.actions button').length, stored: JSON.parse(localStorage.getItem(k)).data.drafts.length}; })()
