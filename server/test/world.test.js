import test from "node:test";
import assert from "node:assert/strict";
import { clampPlayerPosition, movementDelta, PLAYER_RADIUS } from "../world.js";

const world = { width: 800, height: 520, margin: 28 };

test("keeps the complete player collision circle inside every arena edge", () => {
  assert.deepEqual(clampPlayerPosition(-100, -100, world), { x: 47, y: 47 });
  assert.deepEqual(clampPlayerPosition(900, 900, world), { x: 753, y: 473 });
  assert.deepEqual(clampPlayerPosition(400, 260, world), { x: 400, y: 260 });
  assert.equal(PLAYER_RADIUS, 19);
});

test("supports custom radius and rejects invalid or impossibly small worlds", () => {
  assert.deepEqual(clampPlayerPosition(0, 0, world, 10), { x: 38, y: 38 });
  assert.throws(() => clampPlayerPosition(NaN, 0, world), /Invalid player position/);
  assert.throws(() => clampPlayerPosition(0, 0, { width: 30, height: 30, margin: 20 }), /too small/);
});


test("preserves partial analog movement and caps diagonal movement", () => {
  assert.deepEqual(movementDelta(0.5, 0, 100, 1), { x: 50, y: 0 });
  const diagonal = movementDelta(1, 1, 100, 1);
  assert.ok(Math.abs(diagonal.x - 100 / Math.sqrt(2)) < 1e-10);
  assert.ok(Math.abs(diagonal.y - 100 / Math.sqrt(2)) < 1e-10);
  assert.deepEqual(movementDelta(0, 0, 100, 1), { x: 0, y: 0 });
});

test("rejects invalid movement delta inputs", () => {
  assert.throws(() => movementDelta(NaN, 0, 100, 1), /Invalid movement input/);
  assert.throws(() => movementDelta(0, 0, -1, 1), /Invalid movement input/);
  assert.throws(() => movementDelta(0, 0, 100, -1), /Invalid movement input/);
});
