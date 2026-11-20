import {bind_native} from './awai-ui/index.js';
import {createHost} from './host.js';
import {clientRuntimeProblems, createClientConsentHost, createClientOperationBroker} from './runtime.js';
import corpusJson from './corpus.js';
import catalogJson from './catalog.js';
import {loadCorpus, loadCatalog, search, trace, lawByLocalId, endpoint} from './model.js';
import {pickLocale, translator} from './messages.js';
import {runtimeDescriptor, SELECTOR, createFullText, awaiFsCache, memoryCache, lawText} from './fulltext.js';

bind_native(document.documentElement, {tonal: '.tonal', text: '.link'});
const tauriInvoke = window.__TAURI__?.core?.invoke;
// One external operation: a law's full text from Yataverse, asked for each time (AWAI-3316). The corpus itself ships inside the app.
const descriptor = runtimeDescriptor();
if (clientRuntimeProblems(descriptor, [SELECTOR.capability], location.origin).length) throw Error('invalid-runtime');
const broker = createClientOperationBroker({runtime: descriptor, requestedCapabilities: [SELECTOR.capability], approvedOperations: descriptor.operations,
  hostSupportedOperations: [[SELECTOR.capability, SELECTOR.service, SELECTOR.operation]], consentHost: createClientConsentHost()});
const fullText = createFullText({invoke: (selector, payload, options) => broker.invoke(selector, payload, options), cache: tauriInvoke ? awaiFsCache(tauriInvoke) : memoryCache()});

let locale = pickLocale(navigator.languages), t = translator(locale);
document.documentElement.lang = locale;
const corpus = loadCorpus(corpusJson), catalog = loadCatalog(catalogJson);
const host = createHost({appId: 'network.itonami.horei'});
const $ = id => document.getElementById(id);
let num = new Intl.NumberFormat(locale), plural = new Intl.PluralRules(locale);
const countKey = (key, n) => (plural.select(n) === 'one' ? key + 'One' : key);
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; }
function link(text, hash, cls = 'link') { const a = el('a', text, cls); a.href = hash; return a; }
const lawHash = law => '#/law/' + encodeURIComponent(law.localId);
const say = text => { $('status').textContent = text; };

function chips(law) {
  const p = el('p', null, 'chips');
  p.append(el('span', t('kind.' + law.kind), 'chip'), el('span', t('status.' + law.status), law.status === 'law.status/in-force' ? 'chip current' : 'chip'));
  if (law.category) p.append(el('span', law.category, 'chip'));
  return p;
}

// ---- search ----
let lastQuery = '', lastStatus = '';
function renderSearch(query = lastQuery) {
  const view = $('view'); view.replaceChildren();
  const form = el('form'); form.role = 'search'; form.addEventListener('submit', e => e.preventDefault());
  const label = el('label', t('search.label')); label.htmlFor = 'q';
  const input = el('input'); input.id = 'q'; input.type = 'search'; input.value = query; input.autocomplete = 'off'; input.enterKeyHint = 'search';
  const slabel = el('label', t('search.status')); slabel.htmlFor = 'filter';
  const select = el('select'); select.id = 'filter';
  for (const [v, k] of [['', 'search.all'], ['law.status/in-force', 'search.current']]) { const o = el('option', t(k)); o.value = v; o.selected = v === lastStatus; select.append(o); }
  form.append(label, input, slabel, select);
  const summary = el('p', null, 'muted'); summary.setAttribute('aria-live', 'polite');
  const list = el('ul', null, 'results');
  view.append(form, summary, list);
  let composing = false;
  const update = () => {
    const {total, results} = search(corpus, input.value, {status: select.value || null});
    list.replaceChildren();
    summary.textContent = !input.value.trim() ? t('search.idle', {count: num.format(corpus.laws.length)})
      : !total ? t('search.none')
      : total > results.length ? t('search.countTop', {total: num.format(total), shown: num.format(results.length)}) : t(countKey('search.count', total), {total: num.format(total)});
    for (const law of results) { const li = el('li'); li.append(link(law.title, lawHash(law), 'result'), el('p', law.number, 'muted'), chips(law)); list.append(li); }
    lastQuery = input.value; lastStatus = select.value;
    history.replaceState(null, '', input.value ? '#/search/' + encodeURIComponent(input.value) : '#/');
  };
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  input.addEventListener('input', () => { if (!composing) update(); });
  select.addEventListener('change', update);
  update(); input.focus();
}

// ---- detail ----
function relationItem(rel, other, evidence) {
  const li = el('li'), end = endpoint(corpus, other, evidence);
  const date = el('time', rel.at || t('rel.dateUnknown')); if (rel.at) date.dateTime = rel.at;
  li.append(date, ' ');
  if (end.inCorpus) li.append(link(end.law.title, lawHash(end.law)));
  else if (end.unknown) li.append(el('span', t('rel.unknownAmender'), 'muted'));
  else li.append(el('span', end.label), ' ', el('span', `(${t('rel.outside')})`, 'muted'));
  return li;
}
function renderTree(nodes) {
  const ul = el('ul', null, 'tree');
  for (const n of nodes) {
    const li = relationItem(n.rel, n.end.inCorpus ? n.end.law.index : n.end.key, n.rel.evidence);
    if (n.repeat) li.append(' ', el('span', `(${t('rel.repeat')})`, 'muted'));
    if (n.children.length) li.append(renderTree(n.children));
    ul.append(li);
  }
  return ul;
}
function relationSection(view, id, title, rels, pick, withEvidence, extra) {
  const s = el('section'); s.setAttribute('aria-labelledby', id);
  const h = el('h3', title); h.id = id; s.append(h);
  if (!rels.length) s.append(el('p', t('rel.empty'), 'muted'));
  else {
    const ul = el('ul', null, 'relations');
    for (const r of rels) ul.append(relationItem(r, pick(r), withEvidence ? r.evidence : ''));
    s.append(ul);
    if (extra) s.append(extra);
  }
  view.append(s);
}
function renderLaw(localId) {
  const law = lawByLocalId(corpus, localId), view = $('view'); view.replaceChildren();
  if (!law) { view.append(el('h2', t('law.missing')), link(t('law.back'), '#/')); return; }
  const back = link('← ' + t('law.back'), lastQuery ? '#/search/' + encodeURIComponent(lastQuery) : '#/');
  const h = el('h2', law.title); h.tabIndex = -1;
  const dl = el('dl');
  const rows = [['field.number', law.number], ['field.abbrev', law.abbrev], ['field.kind', t('kind.' + law.kind)], ['field.status', t('status.' + law.status)],
    ['field.category', law.category], ['field.promulgated', law.promulgatedAt], ['field.effective', law.effectiveAt], ['field.repealed', law.repealedAt],
    ['field.id', law.localId], ['field.source', law.sourceUrl]];
  for (const [k, v] of rows) if (v) dl.append(el('dt', t(k)), el('dd', v));
  const text = el('section'); text.setAttribute('aria-labelledby', 'text-h');
  const th = el('h3', t('text.heading')); th.id = 'text-h';
  const note = el('p', law.textSha256 ? t('text.absent') : t('text.none'), 'muted');
  text.append(th, note);
  if (law.textSha256) {
    const body = el('div', null, 'law-text'); body.hidden = true;
    const button = el('button', t('text.fetch'), 'tonal'); button.type = 'button'; button.hidden = true;
    const hint = el('p', t('text.fetchNote'), 'muted'); hint.hidden = true;
    const show = (r, key) => { body.textContent = lawText(r.bytes); body.hidden = false; button.hidden = hint.hidden = true; note.textContent = t(key); };
    const fail = e => {
      const m = String(e?.message ?? '');
      const key = /not approved|cancelled/.test(m) ? 'text.denied' : m === 'mismatch' ? 'text.mismatch' : m === 'absent' ? 'text.remoteAbsent' : m === 'format' ? 'text.format' : 'text.unavailable';
      note.textContent = t(key); say(t(key));
    };
    button.addEventListener('click', async e => {
      if (!e.isTrusted) return;
      button.disabled = true; say(t('text.fetching'));
      try { const r = await fullText.fetch(law); show(r, !tauriInvoke ? 'text.webOnly' : r.source === 'cache' ? 'text.cached' : 'text.fetched'); say(note.textContent); body.focus(); }
      catch (err) { fail(err); } finally { button.disabled = false; }
    });
    body.tabIndex = -1;
    const d = el('details'); d.append(el('summary', t('text.details')), el('p', t('text.hash', {hash: law.textSha256}), 'mono'), el('p', t('text.bytes', {bytes: num.format(law.textBytes)})));
    text.append(button, hint, body, d);
    fullText.cached(law).then(r => { if (!view.contains(text)) return; if (r) show(r, tauriInvoke ? 'text.cached' : 'text.webOnly'); else button.hidden = hint.hidden = false; })
      .catch(() => { button.hidden = hint.hidden = false; });
  }
  view.append(back, h, chips(law), dl, text);

  const inc = corpus.incoming[law.index], out = corpus.outgoing[law.index];
  let extra = null;
  if (inc.some(r => typeof r.from === 'number')) {
    extra = el('div');
    const button = el('button', t('trace.button'), 'tonal'); button.type = 'button';
    const box = el('div');
    button.addEventListener('click', e => {
      if (!e.isTrusted) return;
      const tr = trace(corpus, law.index, {direction: 'incoming'});
      box.replaceChildren(renderTree(tr.children));
      if (tr.truncated) box.append(el('p', t('trace.truncated'), 'muted'));
      say(t(countKey('trace.done', tr.nodes), {count: num.format(tr.nodes)}));
      button.hidden = true;
      box.querySelector('a,span')?.closest('li')?.querySelector('a')?.focus();
    });
    extra.append(button, box);
  }
  relationSection(view, 'inc-h', t('rel.incoming', {count: num.format(inc.length)}), inc, r => r.from, true, extra);
  relationSection(view, 'out-h', t('rel.outgoing', {count: num.format(out.length)}), out, r => r.to, false, null);
  h.focus();
}

// ---- catalog ----
function renderCatalog() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('catalog.heading')); h.tabIndex = -1;
  view.append(h, el('p', t('catalog.note', {count: num.format(catalog.jurisdictions.length)}), 'muted'));
  const label = el('label', t('catalog.filter')); label.htmlFor = 'jq';
  const input = el('input'); input.id = 'jq'; input.type = 'search'; input.autocomplete = 'off';
  const list = el('ul', null, 'catalog');
  view.append(label, input, list);
  const update = () => {
    const q = input.value.trim().toLowerCase(); list.replaceChildren();
    for (const j of catalog.jurisdictions) {
      if (q && !j.name.toLowerCase().includes(q) && !j.code.toLowerCase().includes(q)) continue;
      const li = el('li'), d = el('details');
      d.append(el('summary', `${j.name} (${j.code})`));
      for (const [key, items, note] of [['catalog.legislatures', j.legislatures, x => x.url], ['catalog.courts', j.courts, x => x.url],
        ['catalog.sources', j.sources, x => [x.license, x.dataset && t('catalog.dataset', {name: x.dataset})].filter(Boolean).join(' / ')]]) {
        if (!items.length) continue;
        d.append(el('h3', t(key)));
        const ul = el('ul');
        for (const it of items) { const i = el('li', it.name); const n = note(it); if (n) i.append(' ', el('span', n, 'muted')); ul.append(i); }
        d.append(ul);
      }
      li.append(d); list.append(li);
    }
  };
  input.addEventListener('input', update); update();
  h.focus();
}

function route() {
  const hash = location.hash, onCatalog = hash.startsWith('#/catalog');
  for (const a of document.querySelectorAll('nav a')) {
    if (a.hash.startsWith('#/catalog') === onCatalog) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  say('');
  if (hash.startsWith('#/law/')) renderLaw(decodeURIComponent(hash.slice(6)));
  else if (onCatalog) renderCatalog();
  else renderSearch(hash.startsWith('#/search/') ? decodeURIComponent(hash.slice(9)) : lastQuery);
}
function chrome() {
  document.title = t('app.title');
  $('title').textContent = t('app.title');
  $('nav').setAttribute('aria-label', t('nav.label'));
  $('nav-search').textContent = t('nav.search');
  $('nav-catalog').textContent = t('nav.catalog');
  $('footer').textContent = t('footer');
}
function showEnvironment() {
  $('environment').textContent = t('env.line', {runtime: t(host.info().runtime === 'web' ? 'env.web' : 'env.tauri'), count: num.format(corpus.laws.length)});
}
window.addEventListener('hashchange', route);
// On Android a locale change recreates the activity (locale is not in the
// manifest's configChanges, AWAI-3437) and the page reloads. Runtimes that change
// the language without a reload (desktop WebView, browser) arrive here instead.
window.addEventListener('languagechange', () => {
  const next = pickLocale(navigator.languages); if (next === locale) return;
  locale = next; t = translator(locale); document.documentElement.lang = locale;
  num = new Intl.NumberFormat(locale); plural = new Intl.PluralRules(locale);
  chrome(); showEnvironment(); route();
});
async function start() {
  chrome();
  try { await host.initialize(); } catch { say(t('host.failed')); }
  showEnvironment();
  route();
}
start();
