import test from "node:test";
import assert from "node:assert/strict";
import { advanceProjectile, findProjectileHit, projectileStillInRange } from "../combat.js";

test("advances projectile position and traveled distance deterministically", () => {
  const projectile = { x: 10, y: 20, angle: 0, speed: 100, traveled: 5, range: 100 };
  advanceProjectile(projectile, 0.2);
  assert.equal(projectile.x, 30);
  assert.equal(projectile.y, 20);
  assert.equal(projectile.traveled, 25);
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
