import test from "node:test";
import assert from "node:assert/strict";
import { advanceProjectile, findProjectileHit, projectileStillInRange, isTargetDamageable } from "../combat.js";

test("advances projectile position and traveled distance deterministically", () => {
  const projectile = { x: 10, y: 20, angle: 0, speed: 100, traveled: 5, range: 100 };
  advanceProjectile(projectile, 0.2);
  assert.equal(projectile.x, 30);
  assert.equal(projectile.y, 20);
  assert.equal(projectile.traveled, 25);
  assert.equal(projectile.previousX, 10);
  assert.equal(projectile.previousY, 20);
});

test("projectiles stop exactly at their remaining range", () => {
  const projectile = { x: 10, y: 20, angle: 0, speed: 600, traveled: 50, range: 65 };
  advanceProjectile(projectile, 0.1);
  assert.equal(projectile.x, 25);
  assert.equal(projectile.traveled, 65);
  assert.equal(projectileStillInRange(projectile, 800, 520), false);
});

test("projectile hit selection ignores owner, allies, dead players, and invulnerable players", () => {
  const projectile = { x: 100, y: 100, ownerId: "owner", team: 0 };
  const players = [
    { id: "owner", team: 0, alive: true, x: 100, y: 100 },
    { id: "ally", team: 0, alive: true, x: 100, y: 100 },
    { id: "dead", team: 1, alive: false, x: 100, y: 100 },
    { id: "protected", team: 1, alive: true, x: 100, y: 100, invulnerableUntil: 2000 },
    { id: "target", team: 1, alive: true, x: 115, y: 100, invulnerableUntil: 0 }
  ];
  assert.equal(findProjectileHit(projectile, players, 1000, 19)?.id, "target");
});

test("swept collision catches fast projectiles and selects the first contact", () => {
  const projectile = { x: 100, y: 50, previousX: 0, previousY: 50, ownerId: "owner", team: 0 };
  const players = [
    { id: "target", team: 1, alive: true, x: 50, y: 66, invulnerableUntil: 0 },
    { id: "closer-to-path", team: 1, alive: true, x: 75, y: 52, invulnerableUntil: 0 }
  ];
  assert.equal(findProjectileHit(projectile, players, 1000, 19)?.id, "target");
});

test("a projectile hits the first opponent along its path, not the closest perpendicular target", () => {
  const projectile = { x: 100, y: 50, previousX: 0, previousY: 50, ownerId: "owner", team: 0 };
  const players = [
    { id: "later-but-nearer-to-line", team: 1, alive: true, x: 80, y: 50, invulnerableUntil: 0 },
    { id: "first-contact", team: 1, alive: true, x: 25, y: 65, invulnerableUntil: 0 }
  ];
  assert.equal(findProjectileHit(projectile, players, 1000, 19)?.id, "first-contact");
});

test("does not hit targets outside the collision radius", () => {
  const projectile = { x: 0, y: 0, ownerId: "owner", team: 0 };
  assert.equal(findProjectileHit(projectile, [
    { id: "target", team: 1, alive: true, x: 20, y: 0, invulnerableUntil: 0 }
  ], 1000, 19), null);
});

test("projectile expires on range or world bounds", () => {
  assert.equal(projectileStillInRange({ traveled: 99, range: 100, x: 50, y: 50 }, 100, 520), true);
  assert.equal(projectileStillInRange({ traveled: 100, range: 100, x: 50, y: 50 }, 100, 520), false);
  assert.equal(projectileStillInRange({ traveled: 10, range: 100, x: -1, y: 50 }, 100, 520), false);
  assert.equal(projectileStillInRange({ traveled: 10, range: 100, x: 50, y: 521 }, 800, 520), false);
});

import { findProjectileObstacleHit, findProjectileContact } from "../combat.js";

test("projectiles stop at the first wall along their swept path", () => {
  const projectile = { previousX: 0, previousY: 50, x: 100, y: 50 };
  const hit = findProjectileObstacleHit(projectile, [
    { x: 70, y: 30, width: 10, height: 40, tile: "#" },
    { x: 30, y: 30, width: 10, height: 40, tile: "~" }
  ]);
  assert.equal(hit.obstacle.tile, "~");
  assert.ok(hit.t < 0.5);
});

test("reports player contact order so a wall behind a target does not block the earlier hit", () => {
  const projectile = { previousX: 0, previousY: 50, x: 100, y: 50, ownerId: "owner", team: 0 };
  const contact = findProjectileContact(projectile, [
    { id: "target", team: 1, alive: true, x: 25, y: 50, invulnerableUntil: 0 }
  ], 1000, 19);
  const wall = findProjectileObstacleHit(projectile, [{ x: 70, y: 30, width: 10, height: 40 }]);
  assert.ok(contact.t < wall.t);
});

test("all damage sources share friendly-fire, knockout, transformation, and invulnerability rules", () => {
  const attacker = { id: "attacker", team: 0 };
  const target = { id: "target", team: 1, alive: true, hp: 100 };
  assert.equal(isTargetDamageable(target, attacker, 1000), true);
  assert.equal(isTargetDamageable({ ...target, team: 0 }, attacker, 1000), false);
  assert.equal(isTargetDamageable({ ...target, alive: false }, attacker, 1000), false);
  assert.equal(isTargetDamageable({ ...target, invulnerableUntil: 1001 }, attacker, 1000), false);
  assert.equal(isTargetDamageable({ ...target, invulnerableUntil: 1000 }, attacker, 1000), true);
  assert.equal(isTargetDamageable({ ...target, transformUntil: 1001 }, attacker, 1000), false);
  assert.equal(isTargetDamageable({ ...target, transformUntil: 1000 }, attacker, 1000), true);
  assert.equal(isTargetDamageable(target, target, 1000), false);
});

test("projectile collision ignores a target during transformation protection", () => {
  const projectile = { x: 100, y: 100, ownerId: "owner", team: 0 };
  const target = { id: "target", team: 1, alive: true, x: 100, y: 100, transformUntil: 2000 };
  assert.equal(findProjectileHit(projectile, [target], 1000, 19), null);
});
