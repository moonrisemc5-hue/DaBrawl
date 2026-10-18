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

export function isTargetDamageable(target, attacker, atTime) {
  return Boolean(target && attacker &&
    target.alive === true &&
    target.id !== attacker.id &&
    target.team !== attacker.team &&
    !(Number.isFinite(target.invulnerableUntil) && target.invulnerableUntil > atTime) &&
    !(Number.isFinite(target.transformUntil) && target.transformUntil > atTime));
}

export function findProjectileContact(projectile, players, atTime, radius = 19) {
  const x1 = Number.isFinite(projectile.previousX) ? projectile.previousX : projectile.x;
  const y1 = Number.isFinite(projectile.previousY) ? projectile.previousY : projectile.y;
  const radiusSquared = radius * radius;
  let firstContact = null;
  let firstHitT = Infinity;
  for (const target of players) {
    if (!isTargetDamageable(target, { id: projectile.ownerId, team: projectile.team }, atTime)) continue;
    const contact = closestPointOnSegment(target.x, target.y, x1, y1, projectile.x, projectile.y);
    if (contact.distanceSquared <= radiusSquared && contact.t < firstHitT) {
      firstContact = { player: target, t: contact.t };
      firstHitT = contact.t;
    }
  }
  return firstContact;
}
export function findProjectileHit(projectile, players, atTime, radius = 19) {
  return findProjectileContact(projectile, players, atTime, radius)?.player ?? null;
}

function segmentRectEntry(x1, y1, x2, y2, rect, padding = 0) {
  const left = rect.x - padding, right = rect.x + rect.width + padding;
  const top = rect.y - padding, bottom = rect.y + rect.height + padding;
  const dx = x2 - x1, dy = y2 - y1;
  let enter = 0, exit = 1;
  for (const [origin, delta, min, max] of [[x1, dx, left, right], [y1, dy, top, bottom]]) {
    if (Math.abs(delta) < 1e-12) {
      if (origin < min || origin > max) return null;
      continue;
    }
    let a = (min - origin) / delta, b = (max - origin) / delta;
    if (a > b) [a, b] = [b, a];
    enter = Math.max(enter, a);
    exit = Math.min(exit, b);
    if (enter > exit) return null;
  }
  return enter >= 0 && enter <= 1 ? enter : null;
}

/** Returns the first solid tile crossed by a projectile during this tick. */
export function findProjectileObstacleHit(projectile, obstacles, radius = 2) {
  const x1 = Number.isFinite(projectile.previousX) ? projectile.previousX : projectile.x;
  const y1 = Number.isFinite(projectile.previousY) ? projectile.previousY : projectile.y;
  let first = null;
  for (const obstacle of obstacles ?? []) {
    const t = segmentRectEntry(x1, y1, projectile.x, projectile.y, obstacle, radius);
    if (t !== null && (!first || t < first.t)) first = { obstacle, t };
  }
  return first;
}

export function projectileStillInRange(projectile, worldWidth, worldHeight) {
  return projectile.traveled < projectile.range &&
    projectile.x >= 0 && projectile.x <= worldWidth &&
    projectile.y >= 0 && projectile.y <= worldHeight;
}
