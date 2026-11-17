import { botActivity, activitySummary } from './fleet-activity.js';
import { hierarchy, pack } from 'd3-hierarchy';
import { responsibilityTree, circleGoal } from './fleet-responsibilities.js';
import { botCycle } from './bot-cycle.js';
import { blankOrganizations, organizationOptions, validateOrganizations } from './fleet-organizations.js';
export const CIRCLE_STATES = ['running', 'recovering', 'waiting', 'queued', 'held', 'attention', 'unknown'];
const emptyCounts = () => Object.fromEntries(CIRCLE_STATES.map(s => [s, 0]));

// Catalog Circle identity is independent of current App repository aliases.
// Search highlights the full hierarchy; it never removes the other circles.
export function circlePack(bots, { stale = false, query = '', now = Date.now(), orgState = blankOrganizations(), grouping = 'repository' } = {}) {
  if (new Set(bots.map(b => b.id)).size !== bots.length) throw new Error('duplicate-circle-bot');
  const rootData = { id: 'fleet', kind: 'fleet', label: 'Itonami', children: [] };
  validateOrganizations(orgState, bots);
  const orgs = new Map(), circles = new Map(), catalogCircles = new Set();
  const options = organizationOptions(bots, orgState);
  for (const org of options) orgs.set(org.id, { id: org.id, kind: 'organization', label: org.name, linearIssue: org.linearIssue ?? null, counts: emptyCounts(), matchCount: 0, children: [] });
  for (const org of options) {
    const parent = orgState.parents[org.id] ?? org.parentId ?? 'fleet';
    (parent === 'fleet' ? rootData : orgs.get(parent)).children.push(orgs.get(org.id));
  }
  const q = query.trim().toLowerCase();
  for (const bot of bots) {
    const circleId = bot.circleIds?.find(c => typeof c === 'string' && c.startsWith('repo:')) ?? 'unassigned';
    const source = circleId === 'unassigned' ? 'Circle未登録' : circleId.slice(5);
    const org = source.includes('/') ? source.split('/')[0] : '未対応';
    const targetOrg = orgState.memberships[bot.id] ?? orgState.memberships[circleId] ?? `org:${org}`;
    const placement = targetOrg === `org:${org}` ? circleId : `placement:${targetOrg}:${circleId}`;
    catalogCircles.add(circleId);
    if (!circles.has(placement)) {
      const node = { id: placement, kind: 'circle', label: source, circleId, children: [] };
      circles.set(placement, node); orgs.get(targetOrg).children.push(node);
    }
    const raw = stale && bot.configured ? 'unknown' : bot.state;
    const state = CIRCLE_STATES.includes(raw) ? raw : 'unknown';
    const counts = emptyCounts(); counts[state] = 1;
    const matched = !q || `${bot.name} ${bot.repository} ${source} ${(bot.linear?.issues ?? []).join(' ')}`.toLowerCase().includes(q);
    circles.get(placement).children.push({ id: bot.id, kind: 'bot', label: bot.name,
      repository: bot.repository, counts, state, matchCount: matched ? 1 : 0,
      issues: bot.linear?.issues ?? [], circleId, linearProject: bot.linear?.project ?? null,
      activity: botActivity(bot, now, stale), cycle: botCycle(bot, now, stale) });
  }
  if (grouping === 'responsibility') {
    const tree = responsibilityTree(bots);
    rootData.children = tree.children; rootData.label = tree.label; rootData.purpose = tree.purpose;
    const decorated = new Map([...circles.values()].flatMap(c => c.children).map(b => [b.id, b]));
    function decorate(n, weight = 1, inheritedMatch = false) {
      const scopeMatch = inheritedMatch || (!!q && `${n.label} ${n.purpose ?? ''}`.toLowerCase().includes(q));
      if (n.kind === 'bot') { Object.assign(n, decorated.get(n.id)); if (scopeMatch) n.matchCount = 1; n.layoutWeight = weight; return; }
      for (const child of n.children) decorate(child, weight / n.children.length, scopeMatch);
    }
    decorate(rootData);
  }
  const root = hierarchy(rootData).sum(d => d.kind === 'bot' ? (d.layoutWeight ?? 1) : 0)
    .sort((a, b) => b.value - a.value || a.data.id.localeCompare(b.data.id));
  pack().size([1000, 1000]).padding(d => d.depth === 0 ? 8 : grouping === 'responsibility' && d.data.kind !== 'bot' ? 20 : d.data.kind === 'organization' ? 12 : .8)(root);
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
  return { totalBots: bots.length, circleCount: catalogCircles.size, organizationCount: orgs.size, charterCount: grouping === 'responsibility' ? root.descendants().filter(n => n.data.kind === 'responsibility' && n.data.purpose && n.data.id !== 'circle:pending').length : 0, grouping, responsibilityCount: grouping === 'responsibility' ? root.descendants().filter(n => n.data.kind === 'responsibility').length : 0,
    nodes: root.descendants().map(n => ({ id: n.data.id, kind: n.data.kind, label: n.data.label,
      parentId: n.parent?.data.id ?? null, ancestorIds: n.ancestors().slice(1).map(a => a.data.id), depth: n.depth, x: Number.isFinite(n.x) ? n.x : 500,
      y: Number.isFinite(n.y) ? n.y : 500, radius: Number.isFinite(n.r) ? n.r : n.depth === 0 ? 500 : 0,
      count: Object.values(n.data.counts).reduce((a, b) => a + b, 0), counts: n.data.counts, matchCount: n.data.matchCount,
      activity: n.data.kind === 'bot' ? n.data.activity : activitySummary(n.leaves().filter(l=>l.data.kind==='bot').map(l=>bots.find(b=>b.id===l.data.id)),now,stale),
      purpose: n.data.purpose ?? null,
      goal: grouping === 'responsibility' && n.data.kind !== 'bot' ? circleGoal({ ...n.data, parentId: n.parent?.data.id }, n.leaves().filter(l => l.data.kind === 'bot').map(l => bots.find(b => b.id === l.data.id)), { stale }) : null,
      state: n.data.state ?? null, repository: n.data.repository ?? null,
      issues: n.data.issues ?? [], circleId: n.data.circleId ?? null,
      cycle: n.data.cycle ?? null, linearProject: n.data.linearProject ?? null, linearIssue: n.data.linearIssue ?? null })) };
}
