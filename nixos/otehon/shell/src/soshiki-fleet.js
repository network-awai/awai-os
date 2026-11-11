// Browser-local file import. No service request or execution authority.
const pin = p => p && /^[\w.-]+\/[\w.-]+$/.test(p.repository)
  && /^[a-f0-9]{40}$/.test(p.commit) && /^sha256-tree:[a-f0-9]{64}$/.test(p.checksum);
const short = (s, n) => typeof s === 'string' ? s.trim().slice(0, n) : '';

export function importFleet(state, catalog) {
  try {
    if (catalog?.schema !== 'awai.bot-fleet.v1' || !/^[a-f0-9]{40}$/.test(catalog['registry-revision'])) throw Error();
    const org = catalog.organization;
    if (![org?.circles, org?.roles, org?.bots].every(Array.isArray)
        || org.bots.length > 10000 || org.circles.length > 10000 || org.roles.length > 10000) throw Error();
    const circles = org.circles.map(c => ({id: c.id, name: short(c.name, 80), purpose: short(c.purpose, 280), parentId: c['parent-id']}));
    const roles = org.roles.map(r => ({id: r.id, name: short(r.name, 80), purpose: short(r.purpose, 280),
      circleId: r['circle-id'], accountabilities: ['Record verified work in Linear'], skills: [],
      metric: 'Verified acceptance units per stated interval', assignee: {kind: 'bot', name: r.assignee?.name}}));
    const bots = org.bots.map(b => {
      if (!pin(b.profile)) throw Error();
      return {id: b.id, name: short(b.name, 80), purpose: short(b.purpose, 280), skills: [],
        circleIds: b['circle-ids'], roleIds: b['role-ids'], approval: 'ask',
        fleet: {registryRevision: catalog['registry-revision'], profile: b.profile,
          linear: b.linear, schedule: b.schedule, runtime: {state: 'not-started', grants: []}}};
    });
    for (const rows of [circles, roles, bots]) {
      if (new Set(rows.map(r => r.id)).size !== rows.length
          || rows.some(r => typeof r.id !== 'string' || !r.name)) throw Error();
    }
    const circleMap = new Map(circles.map(c => [c.id, c]));
    for (const circle of circles) {
      const seen = new Set([circle.id]); let parent = circle.parentId;
      while (parent != null) {
        if (seen.has(parent) || !circleMap.has(parent)) throw Error();
        seen.add(parent); parent = circleMap.get(parent).parentId;
      }
    }
    const roleIds = new Set(roles.map(r => r.id));
    if (roles.some(r => !circleMap.has(r.circleId) || !bots.some(b => b.name === r.assignee.name))
        || bots.some(b => !Array.isArray(b.circleIds) || !Array.isArray(b.roleIds)
          || b.circleIds.some(id => !circleMap.has(id)) || b.roleIds.some(id => !roleIds.has(id)))) throw Error();
    const merged = {...state};
    for (const [key, incoming] of [['circles', circles], ['roles', roles], ['bots', bots]]) {
      const existing = new Map(state[key].map(r => [r.id, r]));
      const added = [];
      for (const row of incoming) {
        if (existing.has(row.id)) {
          if (JSON.stringify(existing.get(row.id)) !== JSON.stringify(row)) return {error: 'fleet-conflict'};
        } else {
          if (state[key].some(r => r.name === row.name)) return {error: 'fleet-conflict'};
          added.push(row);
        }
      }
      merged[key] = [...state[key], ...added];
    }
    return {state: merged};
  } catch { return {error: 'bad-fleet'}; }
}
