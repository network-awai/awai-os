import circleRoles from './circle-role-catalog.js';
import catalog from './responsibility-catalog.js';
const fleetRoles = [
  ['configuration', '構成監視', ['codinator']],
  ['recovery', 'cron・復旧監督', ['cron-health', 'fleet-watchdog']],
  ['capability', 'モデル・権限整合', ['fleet-model-watch', 'fleet-capability-watch']],
  ['improvement', '継続改善・容量', ['fleet-kaizen', 'global-infra-capacity', 'maturity-fleet', 'manager']],
];
const mapped = new Map();
for (const circle of catalog.circles) for (const id of circle.botIds) {
  if (mapped.has(id)) throw new Error('duplicate-responsibility-assignment');
  mapped.set(id, circle.id);
}
const node = (id, label, kind = 'responsibility', purpose = null) => ({ id, label, kind, purpose, children: [] });
export function responsibilityTree(bots) {
  const root = node('fleet', 'Itonami自律運用', 'fleet', 'Bot・App・実行証跡を結び、復旧可能な分散運用を維持する');
  const nodes = new Map([['circle:root', root]]);
  for (const p of catalog.parents.filter(p => p.parent)) nodes.set(p.id, node(p.id, p.name));
  for (const c of catalog.circles) nodes.set(c.id, node(c.id, c.name, 'responsibility', c.purpose));
  for (const p of [...catalog.parents.filter(p => p.parent), ...catalog.circles]) nodes.get(p.parent).children.push(nodes.get(p.id));
  const pending = node('circle:pending', '配置確認', 'responsibility', '目的・責任・既存Appとの対応を確認してから割り当てる');
  root.children.push(pending);
  const fleet = nodes.get('circle:platform:fleet-reliability');
  const roles = new Map();
  for (const [id, title, members] of fleetRoles) {
    const r = node(`role:fleet:${id}`, title, 'responsibility-role');
    fleet.children.push(r); for (const name of members) roles.set(`profile:${name}`, r);
  }
  const assignmentRoles = new Map();
  for (const [circleId, definitions] of Object.entries(circleRoles)) {
    const circle = nodes.get(circleId); if (!circle) throw new Error('missing-role-circle');
    for (const [key, title, members] of definitions) {
      const r = node('role:' + circleId.slice(7) + ':' + key, title, 'responsibility-role'); circle.children.push(r);
      for (const name of members) { const id = 'profile:' + name; if (mapped.get(id) !== circleId || assignmentRoles.has(id)) throw new Error('invalid-role-assignment'); assignmentRoles.set(id, r); }
    }
  }
  for (const bot of bots) {
    const circle = nodes.get(mapped.get(bot.id)) ?? pending;
    let parent = assignmentRoles.get(bot.id) ?? circle;
    if (circle === fleet) parent = roles.get(bot.id) ?? circle;
    if (circle.id === 'circle:simulation') {
      const family = bot.name.match(/^physai-(isic|isco|cofog|unspsc|jsic|marketplace|souji)(?:-|$)/)?.[1]?.toUpperCase() ?? 'その他';
      const id = `circle:simulation:${family}`;
      if (!nodes.has(id)) { const group = node(id, family); nodes.set(id, group); circle.children.push(group); }
      parent = nodes.get(id);
    }
    parent.children.push({ ...bot, kind: 'bot', label: bot.name });
  }
  // Remove unused catalog branches for smaller snapshots; keep every live actor, including new IDs.
  function prune(n) { if (n.kind === 'bot') return true; n.children = n.children.filter(prune); return n.children.length > 0; }
  prune(root);
  return root;
}
export function circleGoal(scope, bots, { stale = false } = {}) {
  const ids = new Set(bots.map(b => b.id));
  if (ids.size !== bots.length) throw new Error('duplicate-goal-actor');
  const configured = bots.filter(b => b.configured).length;
  const bound = bots.filter(b => b.linear?.issues?.length).length;
  const issueKeys = [...new Set(bots.flatMap(b => b.linear?.issues ?? []))].sort();
  return {
    id: `goal:${scope.id}`, parentGoalId: scope.parentId ? `goal:${scope.parentId}` : null,
    title: scope.purpose ?? `${scope.label}の責任・成果を追跡可能にする`,
    status: 'draft', ownerRoleId: null, timeframe: null, progress: null,
    keyResults: [
      { id: 'outcome', title: '責任に対応する成果を受入条件と証跡で確認する', value: null, target: null, unit: '検証済成果 / 観測期間' },
      { id: 'recovery', title: '異常・重複実行から復旧できることを検証する', value: null, target: null, unit: '重複件数・復旧時間' },
    ],
    metrics: { actors: bots.length, configured, held: bots.length - configured, issueBound: bound, observation: stale ? 'stale' : 'current' },
    issueKeys,
  };
}
