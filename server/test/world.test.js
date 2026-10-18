import test from "node:test";
import assert from "node:assert/strict";
import { clampPlayerPosition, movementDelta, resolvePlayerCollisions, PLAYER_RADIUS } from "../world.js";

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

test("separates overlapping players and keeps them inside the arena", () => {
  const resolved = resolvePlayerCollisions([{x:200,y:200},{x:210,y:200}], world);
  assert.ok(Math.hypot(resolved[1].x-resolved[0].x,resolved[1].y-resolved[0].y) >= PLAYER_RADIUS*2-1e-8);
  for (const p of resolved) {
    assert.ok(p.x >= world.margin + PLAYER_RADIUS && p.x <= world.width-world.margin-PLAYER_RADIUS);
    assert.ok(p.y >= world.margin + PLAYER_RADIUS && p.y <= world.height-world.margin-PLAYER_RADIUS);
  }
});

test("separates multiple players deterministically, including coincident spawn points", () => {
  const players = [{x:400,y:260},{x:400,y:260},{x:400,y:260}];
  const first = resolvePlayerCollisions(players, world);
  assert.deepEqual(first, resolvePlayerCollisions(players, world));
  for (let i=0;i<first.length;i++) for (let j=i+1;j<first.length;j++)
    assert.ok(Math.hypot(first[j].x-first[i].x,first[j].y-first[i].y) >= PLAYER_RADIUS*2-0.01);
});

test("rejects invalid collision inputs", () => {
  assert.throws(() => resolvePlayerCollisions(null, world), /Invalid player collision inputs/);
  assert.throws(() => resolvePlayerCollisions([{x:NaN,y:0}], world), /Invalid player position/);
});

test("falls back to non-overlapping deterministic cells for a crowded edge spawn", () => {
  const crowded = Array.from({ length: 6 }, () => ({ x: world.margin + PLAYER_RADIUS, y: world.margin + PLAYER_RADIUS }));
  const first = resolvePlayerCollisions(crowded, world);
  assert.deepEqual(first, resolvePlayerCollisions(crowded, world));
  for (let i = 0; i < first.length; i++) {
    assert.ok(first[i].x >= world.margin + PLAYER_RADIUS && first[i].x <= world.width - world.margin - PLAYER_RADIUS);
    assert.ok(first[i].y >= world.margin + PLAYER_RADIUS && first[i].y <= world.height - world.margin - PLAYER_RADIUS);
    for (let j = i + 1; j < first.length; j++) assert.ok(Math.hypot(first[j].x - first[i].x, first[j].y - first[i].y) >= PLAYER_RADIUS * 2 - 1e-7);
  }
});


test("blocks a player's collision circle at rectangle obstacles", async () => {
  const { movePlayerWithObstacles } = await import("../world.js");
  const obstacleWorld = { ...world, obstacles: [{ x: 300, y: 180, width: 100, height: 100 }] };
  const stopped = movePlayerWithObstacles(270, 230, 40, 0, obstacleWorld);
  assert.equal(stopped.x, 270);
  assert.equal(stopped.y, 230);
  const fromInsideEdge = movePlayerWithObstacles(270, 160, 40, 20, obstacleWorld);
  assert.equal(fromInsideEdge.x, 310);
  assert.equal(fromInsideEdge.y, 160);
});

test("slides along obstacle faces and validates obstacle geometry", async () => {
  const { movePlayerWithObstacles } = await import("../world.js");
  const obstacleWorld = { ...world, obstacles: [{ x: 300, y: 180, width: 100, height: 100 }] };
  const slid = movePlayerWithObstacles(270, 150, 40, 30, obstacleWorld);
  assert.equal(slid.x, 310);
  assert.equal(slid.y, 150);
  assert.throws(() => movePlayerWithObstacles(100, 100, 1, 1, { ...world, obstacles: [{ x: 0, y: 0, width: -1, height: 10 }] }), /Invalid world obstacle/);
});
