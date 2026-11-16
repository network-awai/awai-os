import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MOTION_PATTERNS, PARTICLE_PALETTE, particlePose } from "../src/particle-motion.js";

test("all five morphs stay finite and within the decoration bounds across the timeline", () => {
  assert.equal(MOTION_PATTERNS.length, 5);
  for (const pattern of MOTION_PATTERNS) {
    assert.ok(pattern.duration <= 1000);
    for (let frame = 0; frame <= 60; frame++) for (let i = 0; i < 240; i++) {
      const p = particlePose(pattern.id, i, 240, frame / 60);
      assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, `${pattern.id} escaped`);
      assert.ok(Number.isFinite(p.radius) && p.radius > 0 && p.alpha >= 0 && p.alpha <= 1);
    }
  }
});
test("transfer preserves particle identity and reaches the destination without faking a storage receipt", () => {
  for (let i = 0; i < 240; i++) {
    const a = particlePose("transfer", i, 240, 0), b = particlePose("transfer", i, 240, 1);
    assert.ok(Math.abs((b.x - a.x) - 0.5) < 1e-9);
    assert.equal(a.color, b.color); assert.equal(a.y, b.y);
  }
});
test("each endpoint is deterministic, clamped progress settles, malformed requests are rejected", () => {
  for (const p of MOTION_PATTERNS) {
    assert.deepEqual(particlePose(p.id, 10, 240, 1), particlePose(p.id, 10, 240, 20));
    assert.deepEqual(particlePose(p.id, 10, 240, 0), particlePose(p.id, 10, 240, -1));
  }
  assert.throws(() => particlePose("unknown", 0, 240, 0));
  assert.throws(() => particlePose("focus", 240, 240, 0));
  assert.throws(() => particlePose("focus", 0, 240, NaN));
});

test("particle colors are only the four Awai brand primitives plus alpha", () => {
  assert.deepEqual(Object.values(PARTICLE_PALETTE), ["#ffffff", "#1e50a2", "#bc002d", "#14110f"]);
  for (const p of MOTION_PATTERNS) for (let i = 0; i < 240; i++)
    assert.ok(Object.hasOwn(PARTICLE_PALETTE, particlePose(p.id, i, 240, .5).color));
});
test("transfer cloud has two dimensional spread instead of collapsing onto a line", () => {
  const points = Array.from({ length: 240 }, (_, i) => particlePose("transfer", i, 240, 1));
  const mx = points.reduce((s,p) => s+p.x,0)/points.length, my = points.reduce((s,p) => s+p.y,0)/points.length;
  const cov = points.reduce((s,p) => s+(p.x-mx)*(p.y-my),0);
  const xx = points.reduce((s,p) => s+(p.x-mx)**2,0), yy = points.reduce((s,p) => s+(p.y-my)**2,0);
  assert.ok(Math.abs(cov / Math.sqrt(xx*yy)) < .2);
});
