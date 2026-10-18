// Deterministic projectile primitives shared by the authoritative simulation and tests.
export function advanceProjectile(projectile, dt) {
  projectile.previousX = projectile.x;
  projectile.previousY = projectile.y;
  const requestedDistance = Math.max(0, projectile.speed * dt);
  const remainingRange = Number.isFinite(projectile.range)
    ? Math.max(0, projectile.range - projectile.traveled)
    : requestedDistance;
  const distance = Math.min(requestedDistance, remainingRange);
  const dx = Math.cos(projectile.angle) * distance;
  const dy = Math.sin(projectile.angle) * distance;
  projectile.x += dx;
  projectile.y += dy;
  projectile.traveled += Math.hypot(dx, dy);
  return projectile;
}

function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return { t, distanceSquared: (px - x) ** 2 + (py - y) ** 2 };
}

export function findProjectileHit(projectile, players, atTime, radius = 19) {
  const x1 = Number.isFinite(projectile.previousX) ? projectile.previousX : projectile.x;
  const y1 = Number.isFinite(projectile.previousY) ? projectile.previousY : projectile.y;
  const radiusSquared = radius * radius;
  let firstHit = null;
  let firstHitT = Infinity;
  for (const target of players) {
    if (!target.alive || target.id === projectile.ownerId || target.team === projectile.team ||
        (Number.isFinite(target.invulnerableUntil) && target.invulnerableUntil > atTime)) continue;
    const contact = closestPointOnSegment(target.x, target.y, x1, y1, projectile.x, projectile.y);
    if (contact.distanceSquared <= radiusSquared && contact.t < firstHitT) {
      firstHit = target;
      firstHitT = contact.t;
    }
  }
  return firstHit;
}

export function projectileStillInRange(projectile, worldWidth, worldHeight) {
  return projectile.traveled < projectile.range &&
    projectile.x >= 0 && projectile.x <= worldWidth &&
    projectile.y >= 0 && projectile.y <= worldHeight;
}
