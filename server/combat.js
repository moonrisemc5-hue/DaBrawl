// Deterministic projectile primitives shared by the authoritative simulation and tests.
export function advanceProjectile(projectile, dt) {
  const dx = Math.cos(projectile.angle) * projectile.speed * dt;
  const dy = Math.sin(projectile.angle) * projectile.speed * dt;
  projectile.x += dx;
  projectile.y += dy;
  projectile.traveled += Math.hypot(dx, dy);
  return projectile;
}

export function findProjectileHit(projectile, players, atTime, radius = 19) {
  for (const target of players) {
    if (!target.alive || target.id === projectile.ownerId || target.team === projectile.team ||
        (Number.isFinite(target.invulnerableUntil) && target.invulnerableUntil > atTime)) continue;
    if (Math.hypot(target.x - projectile.x, target.y - projectile.y) <= radius) return target;
  }
  return null;
}

export function projectileStillInRange(projectile, worldWidth, worldHeight) {
  return projectile.traveled < projectile.range &&
    projectile.x >= 0 && projectile.x <= worldWidth &&
    projectile.y >= 0 && projectile.y <= worldHeight;
}
