export const ORG_KEY = 'otehon.fleet-organizations.v1';
export const blankOrganizations = () => ({ version: 1, organizations: [], memberships: {}, parents: {} });
export function organizationOptions(bots, state) {
  const source = [...new Set(bots.map(b => (b.circleIds?.find(c => typeof c === 'string' && c.startsWith('repo:')) ?? 'repo:未対応/unassigned').slice(5).split('/')[0]))];
  return [...source.map(name => ({ id: `org:${name}`, name, parentId: 'fleet' })), ...state.organizations];
}
export function validateOrganizations(state, bots) {
  if (state?.version !== 1 || !Array.isArray(state.organizations) || state.organizations.length > 200 || !state.memberships || !state.parents) throw new Error('組織データの形式が不正です');
  const options = organizationOptions(bots, state), ids = new Set(options.map(o => o.id));
  if (ids.size !== options.length) throw new Error('組織IDが重複しています');
  for (const [id, parent] of Object.entries(state.parents)) if (!ids.has(id) || (parent !== 'fleet' && !ids.has(parent))) throw new Error('移動する組織または親が不明です');
  for (const org of state.organizations) if (!/^org:custom:[\w-]+$/.test(org.id) || typeof org.name !== 'string' || !org.name.trim() || org.name.length > 100 || (org.linearIssue && !/^[A-Z][A-Z0-9]*-\d+$/.test(org.linearIssue))) throw new Error('組織名・Linear Issueを確認してください');
  for (const id of ids) {
    let current = id; const seen = new Set();
    while (current !== 'fleet') {
      if (!ids.has(current) || seen.has(current)) throw new Error('組織の循環・不明な親を拒否しました');
      seen.add(current); if (seen.size > 8) throw new Error('組織の階層は8段までです');
      const org = options.find(o => o.id === current);
      current = state.parents[current] ?? org.parentId ?? 'fleet';
    }
  }
  const entities = new Set(bots.flatMap(b => [b.id, ...(b.circleIds ?? [])]));
  for (const [entity, target] of Object.entries(state.memberships)) if (!entities.has(entity) || !ids.has(target)) throw new Error('所属先またはBot・Circleが不明です');
  return state;
}
export function changeOrganization(state, action, bots) {
  validateOrganizations(state, bots);
  const next = JSON.parse(JSON.stringify(state));
  if (action.type === 'create') next.organizations.push({ id: action.id, name: action.name.trim(), parentId: action.parentId, linearIssue: action.linearIssue?.trim() || null });
  else if (action.type === 'move') next.parents[action.id] = action.parentId;
  else if (action.type === 'assign') next.memberships[action.entityId] = action.parentId;
  else if (action.type === 'restore') delete next.memberships[action.entityId];
  else throw new Error('未対応の組織操作');
  return validateOrganizations(next, bots);
}
export function loadOrganizations(bots, storage) {
  try { return { state: validateOrganizations(JSON.parse(storage.getItem(ORG_KEY)) ?? blankOrganizations(), bots), error: null }; }
  catch { return { state: blankOrganizations(), error: '保存済み組織データを読めません。元データを保持しています。編集せず復旧してください。' }; }
}
export function saveOrganizations(state, bots, storage) {
  validateOrganizations(state, bots); storage.setItem(ORG_KEY, JSON.stringify(state)); return state;
}
