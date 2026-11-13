import assert from 'node:assert/strict';
import { test } from 'node:test';
import { circlePack } from '../src/fleet-circles.js';
const bot = (id, circle, state = 'waiting') => ({ id, name: id, repository: 'current/app', circleIds: [circle], state, configured: state !== 'held' });
test('all Bots and catalog Circles coexist in one nested view despite current App aliases', () => {
  const bots = [bot('a', 'repo:original/app'), bot('b', 'repo:original/app', 'held'), bot('c', 'repo:other/app')];
  const view = circlePack(bots);
  assert.equal(view.totalBots, 3); assert.equal(view.circleCount, 2);
  assert.equal(view.nodes.length, 1 + 2 + 2 + 3);
  assert.equal(view.nodes.find(n => n.id === 'a').parentId, 'repo:original/app');
  assert.equal(view.nodes.find(n => n.id === 'a').repository, 'current/app');
  assert.equal(view.nodes.find(n => n.id === 'repo:original/app').parentId, 'org:original');
  assert.throws(() => circlePack([bots[0], bots[0]]), /duplicate-circle-bot/);
});
test('stale configured observations become unknown while intentional holds remain held', () => {
  const view = circlePack([bot('a', 'repo:org/a'), bot('b', 'repo:org/a', 'attention'), bot('c', 'repo:org/a', 'held')], { stale: true });
  assert.deepEqual(view.nodes[0].counts, { waiting: 0, queued: 0, held: 1, attention: 0, unknown: 2 });
});
test('every child is enclosed, siblings do not overlap, and search does not remove or move nodes', () => {
  const bots = Array.from({ length: 899 }, (_, i) => bot(`b${i}`, `repo:org${i % 4}/app${i % 761}`));
  const view = circlePack(bots), searched = circlePack(bots, { query: 'b898' });
  assert.equal(view.nodes.filter(n => n.kind === 'bot').length, 899);
  assert.equal(searched.nodes.length, view.nodes.length);
  assert.equal(searched.nodes[0].matchCount, 1);
  for (const n of view.nodes) {
    assert.deepEqual([n.x, n.y, n.radius], [searched.nodes.find(s => s.id === n.id).x, searched.nodes.find(s => s.id === n.id).y, searched.nodes.find(s => s.id === n.id).radius]);
    if (!n.parentId) continue;
    const parent = view.nodes.find(p => p.id === n.parentId);
    assert.ok(Math.hypot(n.x - parent.x, n.y - parent.y) + n.radius <= parent.radius + 1e-7);
  }
  for (const parent of view.nodes.filter(n => n.kind !== 'bot')) {
    const children = view.nodes.filter(n => n.parentId === parent.id);
    for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
      assert.ok(Math.hypot(children[i].x - children[j].x, children[i].y - children[j].y) + 1e-7 >= children[i].radius + children[j].radius);
    }
  }
  assert.equal(circlePack([]).nodes.length, 1);
});
