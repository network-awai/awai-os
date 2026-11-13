import { hierarchy, pack } from 'd3-hierarchy';
export const CIRCLE_STATES = ['waiting', 'queued', 'held', 'attention', 'unknown'];
const emptyCounts = () => Object.fromEntries(CIRCLE_STATES.map(s => [s, 0]));

// Catalog Circle identity is independent of current App repository aliases.
// Search highlights the full hierarchy; it never removes the other circles.
export function circlePack(bots, { stale = false, query = '' } = {}) {
  if (new Set(bots.map(b => b.id)).size !== bots.length) throw new Error('duplicate-circle-bot');
  const rootData = { id: 'fleet', kind: 'fleet', label: 'Itonami', children: [] };
  const orgs = new Map(), circles = new Map();
  const q = query.trim().toLowerCase();
  for (const bot of bots) {
    const circleId = bot.circleIds?.find(c => typeof c === 'string' && c.startsWith('repo:')) ?? 'unassigned';
    const source = circleId === 'unassigned' ? 'Circle未登録' : circleId.slice(5);
    const org = source.includes('/') ? source.split('/')[0] : '未対応';
    if (!orgs.has(org)) {
      const node = { id: `org:${org}`, kind: 'organization', label: org, children: [] };
      orgs.set(org, node); rootData.children.push(node);
    }
    if (!circles.has(circleId)) {
      const node = { id: circleId, kind: 'circle', label: source, children: [] };
      circles.set(circleId, node); orgs.get(org).children.push(node);
    }
    const raw = stale && bot.configured ? 'unknown' : bot.state;
    const state = CIRCLE_STATES.includes(raw) ? raw : 'unknown';
    const counts = emptyCounts(); counts[state] = 1;
    const matched = !q || `${bot.name} ${bot.repository} ${source} ${(bot.linear?.issues ?? []).join(' ')}`.toLowerCase().includes(q);
    circles.get(circleId).children.push({ id: bot.id, kind: 'bot', label: bot.name,
      repository: bot.repository, counts, state, matchCount: matched ? 1 : 0,
      issues: bot.linear?.issues ?? [], circleId });
  }
  const root = hierarchy(rootData).sum(d => d.kind === 'bot' ? 1 : 0)
    .sort((a, b) => b.value - a.value || a.data.id.localeCompare(b.data.id));
  pack().size([1000, 1000]).padding(d => d.depth === 0 ? 8 : d.depth === 1 ? 3 : .8)(root);
  root.eachAfter(node => {
    if (!node.children) return;
    node.data.counts = emptyCounts(); node.data.matchCount = 0;
    for (const child of node.children) {
      for (const s of CIRCLE_STATES) node.data.counts[s] += child.data.counts[s];
      node.data.matchCount += child.data.matchCount;
    }
  });
  // Empty roots still provide a usable full-view boundary.
  if (!bots.length) { rootData.counts = emptyCounts(); rootData.matchCount = 0; }
  return { totalBots: bots.length, circleCount: circles.size, organizationCount: orgs.size,
    nodes: root.descendants().map(n => ({ id: n.data.id, kind: n.data.kind, label: n.data.label,
      parentId: n.parent?.data.id ?? null, depth: n.depth, x: Number.isFinite(n.x) ? n.x : 500,
      y: Number.isFinite(n.y) ? n.y : 500, radius: Number.isFinite(n.r) ? n.r : 500,
      count: n.value, counts: n.data.counts, matchCount: n.data.matchCount,
      state: n.data.state ?? null, repository: n.data.repository ?? null,
      issues: n.data.issues ?? [], circleId: n.data.circleId ?? null })) };
}
