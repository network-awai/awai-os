import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botCycle } from '../src/bot-cycle.js';
import { blankOrganizations, changeOrganization, loadOrganizations, saveOrganizations, ORG_KEY } from '../src/fleet-organizations.js';
import { circlePack } from '../src/fleet-circles.js';
const now = 1800000000000;
const bot = { id: 'profile:bot', name: 'bot', repository: 'current/app', circleIds: ['repo:source/app'], state: 'waiting', configured: true,
  jobs: [{ sourceJobId: 'j', scope: 'adapted', configured: true, nextSlot: now + 1800000 }],
  sourceJobs: [{ id: 'j', schedule: { kind: 'cron', expr: '11 * * * *' } }] };
test('cron cycle is derived from the existing source and next slot, never an invented schedule', () => {
  const cycle = botCycle(bot, now, false);
  assert.equal(cycle.periodMs, 3600000); assert.equal(cycle.phase, .5); assert.equal(cycle.animated, true);
  assert.equal(botCycle(bot, now, true).animated, false);
  assert.equal(botCycle({ ...bot, configured: false }, now, false).animated, false);
  assert.equal(botCycle(bot, now + 3600000, false).cycleState, 'overdue');
  assert.equal(botCycle({ ...bot, sourceJobs: [{ id: 'j', schedule: { kind: 'cron', expr: '11 2 1 * *' } }] }, now, false).periodMs, null);
  assert.equal(botCycle({ ...bot, jobs: [], sourceJobs: [] }, now, false).animated, false);
});
test('nested organizations move display membership without changing catalog identity, schedule or total', () => {
  let state = blankOrganizations();
  state = changeOrganization(state, { type: 'create', id: 'org:custom:ops', name: '運用', parentId: 'org:source', linearIssue: 'AWAI-2795' }, [bot]);
  state = changeOrganization(state, { type: 'create', id: 'org:custom:watch', name: '監視', parentId: 'org:custom:ops' }, [bot]);
  const before = JSON.stringify(bot);
  state = changeOrganization(state, { type: 'assign', entityId: bot.id, parentId: 'org:custom:watch' }, [bot]);
  const view = circlePack([bot], { orgState: state, now });
  assert.equal(view.totalBots, 1); assert.equal(view.circleCount, 1);
  const leaf = view.nodes.find(n => n.kind === 'bot'), circle = view.nodes.find(n => n.id === leaf.parentId);
  assert.equal(circle.circleId, 'repo:source/app'); assert.equal(circle.parentId, 'org:custom:watch');
  assert.equal(view.nodes.find(n => n.id === 'org:custom:watch').parentId, 'org:custom:ops');
  assert.equal(JSON.stringify(bot), before);
  assert.throws(() => changeOrganization(state, { type: 'move', id: 'org:source', parentId: 'org:custom:watch' }, [bot]), /循環/);
  assert.throws(() => changeOrganization(state, { type: 'assign', entityId: 'profile:unknown', parentId: 'org:source' }, [bot]), /不明/);
  assert.throws(() => changeOrganization(state, { type: 'move', id: 'org:unknown', parentId: 'fleet' }, [bot]), /不明/);
  state = changeOrganization(state, { type: 'restore', entityId: bot.id }, [bot]);
  assert.equal(circlePack([bot], { orgState: state }).nodes.find(n => n.kind === 'bot').parentId, 'repo:source/app');
});
test('display organizations persist and corrupt prior storage is retained without overwrite', () => {
  const data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  let state = blankOrganizations();
  state = changeOrganization(state, { type: 'create', id: 'org:custom:ops', name: '運用', parentId: 'fleet' }, [bot]);
  saveOrganizations(state, [bot], storage);
  assert.deepEqual(loadOrganizations([bot], storage).state, state);
  data.set(ORG_KEY, '{corrupt');
  assert.ok(loadOrganizations([bot], storage).error); assert.equal(data.get(ORG_KEY), '{corrupt');
});
