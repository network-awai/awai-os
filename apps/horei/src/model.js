// Horei model: pure functions over the bundled corpus. No I/O, no network.
export const CORPUS_SCHEMA = 'itonami.horei.corpus.v1';
export const CATALOG_SCHEMA = 'itonami.horei.catalog.v1';

// Search normalisation: NFKC folds full-width/half-width forms, then case-fold.
export const normalize = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function loadCorpus(json) {
  if (json?.schema !== CORPUS_SCHEMA || !Array.isArray(json.laws) || !Array.isArray(json.relations)) throw Error('invalid-corpus');
  const laws = json.laws.map((r, index) => {
    if (!Array.isArray(r) || r.length !== json.columns.length) throw Error('invalid-corpus');
    const [localId, title, abbrev, number, kind, status, category, promulgatedAt, effectiveAt, repealedAt, textSha256, textBytes] = r;
    return Object.freeze({index, localId, key: json.keyPrefix + localId, title, abbrev, number,
      kind: json.kinds[kind], status: json.statuses[status], category, promulgatedAt, effectiveAt, repealedAt,
      textSha256, textBytes, sourceUrl: json.urlBase + localId,
      haystack: normalize(title + '\u0000' + abbrev + '\u0000' + number + '\u0000' + localId)});
  });
  const byLocalId = new Map(laws.map(l => [l.localId, l.index]));
  const outgoing = laws.map(() => []), incoming = laws.map(() => []);
  const external = new Map(); // key outside the corpus -> relations naming it
  json.relations.forEach(([from, to, kind, at, evidence], id) => {
    const rel = Object.freeze({id, from, to, kind: json.relationKinds[kind], at, evidence});
    if (typeof from === 'number') outgoing[from].push(rel);
    else (external.get(from) ?? external.set(from, []).get(from)).push(rel);
    if (typeof to === 'number') incoming[to].push(rel);
  });
  for (const list of [...outgoing, ...incoming]) list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return Object.freeze({dataset: json.dataset, jurisdiction: json.jurisdiction, keyPrefix: json.keyPrefix,
    laws, byLocalId, outgoing, incoming, relationCount: json.relations.length});
}

// Ranked substring search. Every whitespace-separated term must match.
export function search(corpus, query, {limit = 50, status = null} = {}) {
  const terms = String(query ?? '').normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return {total: 0, results: []};
  const hits = [];
  for (const law of corpus.laws) {
    if (status && law.status !== status) continue;
    if (!terms.every(t => law.haystack.includes(t))) continue;
    const t = normalize(law.title), a = normalize(law.abbrev), q = terms.join('');
    const score = (a === q || t === q ? 0 : a.split(',').includes(q) ? 1 : t.startsWith(q) ? 2 : 3)
      * 10 + (law.status === 'law.status/in-force' ? 0 : 5);
    hits.push([score, law.title.length, law]);
  }
  hits.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2].index - y[2].index);
  return {total: hits.length, results: hits.slice(0, limit).map(h => h[2])};
}

export const lawByLocalId = (corpus, id) => (corpus.byLocalId.has(id) ? corpus.laws[corpus.byLocalId.get(id)] : null);

// One end of a relation, described for display whether or not it is in the corpus.
export function endpoint(corpus, end, evidence) {
  if (typeof end === 'number') return {inCorpus: true, law: corpus.laws[end]};
  const localId = String(end).startsWith(corpus.keyPrefix) ? String(end).slice(corpus.keyPrefix.length) : String(end);
  // Upstream writes an all-zero ID when e-Gov names no amending act; say so instead of showing zeros.
  if (/^0+$/.test(localId) && !evidence) return {inCorpus: false, key: end, localId, unknown: true, label: ''};
  return {inCorpus: false, key: end, localId, label: evidence || localId};
}

// Walk the amendment graph from one law, cycle-safe and bounded.
// direction 'incoming' = laws that amended this one (遡る); 'outgoing' = laws this one amended.
export function trace(corpus, start, {direction = 'incoming', maxDepth = 8, maxNodes = 400} = {}) {
  const edges = direction === 'incoming' ? corpus.incoming : corpus.outgoing;
  const seen = new Set([start]);
  let count = 0, truncated = false;
  function walk(index, depth) {
    return edges[index].map(rel => {
      const other = direction === 'incoming' ? rel.from : rel.to;
      const node = {rel, end: endpoint(corpus, other, direction === 'incoming' ? rel.evidence : ''), children: [], repeat: false};
      if (++count > maxNodes) { truncated = true; return null; }
      if (typeof other === 'number') {
        if (seen.has(other)) node.repeat = true;
        else if (depth + 1 < maxDepth) { seen.add(other); node.children = walk(other, depth + 1); }
        else if (edges[other].length) truncated = true;
      }
      return node;
    }).filter(Boolean);
  }
  const children = walk(start, 0);
  return {children, nodes: Math.min(count, maxNodes), truncated};
}

// Catalog: jurisdictions with the legislatures, courts and legal sources that name them.
export function loadCatalog(json) {
  if (json?.schema !== CATALOG_SCHEMA || !Array.isArray(json.entities)) throw Error('invalid-catalog');
  const by = new Map();
  const slot = code => by.get(code) ?? by.set(code, {code, name: code, kind: '', legislatures: [], courts: [], sources: []}).get(code);
  for (const e of json.entities) {
    if (e['jurisdiction/code']) Object.assign(slot(e['jurisdiction/code']), {name: e['jurisdiction/name'] ?? e['jurisdiction/code'], kind: e['jurisdiction/kind'] ?? ''});
    else if (e['legislature/id']) slot(e['legislature/jurisdiction']).legislatures.push({name: e['legislature/name'], url: e['legislature/official-url'] ?? ''});
    else if (e['court/id']) slot(e['court/jurisdiction']).courts.push({name: e['court/name'], url: e['court/official-url'] ?? ''});
    else if (e['legal-source/id']) slot(e['legal-source/jurisdiction']).sources.push({name: e['legal-source/name'], status: e['legal-source/status'] ?? '', license: e['legal-source/license'] ?? '', dataset: e['legal-source/dataset'] ?? ''});
  }
  const list = [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  return Object.freeze({jurisdictions: list, entities: json.entities.length});
}
