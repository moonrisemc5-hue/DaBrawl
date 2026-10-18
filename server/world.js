export const PLAYER_RADIUS = 19;

export function clampPlayerPosition(x, y, world, radius = PLAYER_RADIUS) {
  if (!world || !Number.isFinite(world.width) || !Number.isFinite(world.height) || !Number.isFinite(world.margin) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) throw new TypeError("Invalid player position or world bounds");
  const minX = world.margin + radius, minY = world.margin + radius;
  const maxX = world.width - world.margin - radius, maxY = world.height - world.margin - radius;
  if (minX > maxX || minY > maxY) throw new RangeError("World is too small for player collision radius");
  return { x: Math.max(minX, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)) };
}

function positionClearOfObstacles(position, world, radius) {
  return !(world?.obstacles ?? []).some(obstacle => intersectsObstacle(position.x, position.y, radius, obstacle));
}

function nearestClearPosition(x, y, world, radius, fallback) {
  const desired = clampPlayerPosition(x, y, world, radius);
  if (positionClearOfObstacles(desired, world, radius)) return desired;
  // Search locally in small deterministic rings so separation nudges never push a
  // player through a wall. Eight-unit spacing is finer than the 48-unit map tiles.
  for (let distance = 8; distance <= 96; distance += 8) {
    const candidates = [];
    for (let dx = -distance; dx <= distance; dx += 8) {
      for (let dy = -distance; dy <= distance; dy += 8) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue;
        const point = clampPlayerPosition(desired.x + dx, desired.y + dy, world, radius);
        if (positionClearOfObstacles(point, world, radius)) candidates.push(point);
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y));
    if (candidates.length) return candidates[0];
  }
  return fallback;
}

export function resolvePlayerCollisions(players, world, radius = PLAYER_RADIUS) {
  if (!Array.isArray(players) || !Number.isFinite(radius) || radius < 0) throw new TypeError("Invalid player collision inputs");
  const positions = players.map(player => {
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) throw new TypeError("Invalid player position");
    return nearestClearPosition(player.x, player.y, world, radius, clampPlayerPosition(player.x, player.y, world, radius));
  });
  const diameter = radius * 2;
  for (let pass = 0; pass < 24; pass++) {
    let changed = false;
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i], b = positions[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);
      if (distance >= diameter) continue;
      if (distance < 1e-8) {
        const angle = ((i + 1) * 2.399963229728653) % (Math.PI * 2);
        dx = Math.cos(angle); dy = Math.sin(angle); distance = 1;
      }
      const push = (diameter - distance) / 2, nx = dx / distance, ny = dy / distance;
      positions[i] = clampPlayerPosition(a.x - nx * push, a.y - ny * push, world, radius);
      positions[j] = clampPlayerPosition(b.x + nx * push, b.y + ny * push, world, radius);
      changed = true;
    }
    if (!changed) break;
  }
  const stillOverlapping = () => {
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      if (Math.hypot(positions[j].x - positions[i].x, positions[j].y - positions[i].y) < diameter - 1e-7) return true;
    }
    return false;
  };
  // Pairwise relaxation is smooth for ordinary movement. If a crowded cluster
  // cannot be separated near a boundary, use a deterministic free-cell fallback
  // rather than allowing persistent overlaps after the final pass.
  if (stillOverlapping() && diameter > 0) {
    const minX = world.margin + radius, minY = world.margin + radius;
    const maxX = world.width - world.margin - radius, maxY = world.height - world.margin - radius;
    const cells = [];
    for (let y = minY; y <= maxY + 1e-7; y += diameter) {
      for (let x = minX; x <= maxX + 1e-7; x += diameter) cells.push({ x, y });
    }
    const placed = [];
    for (let i = 0; i < positions.length; i++) {
      const desired = positions[i];
      const candidates = cells.filter(cell => positionClearOfObstacles(cell, world, radius) && placed.every(other => Math.hypot(cell.x - other.x, cell.y - other.y) >= diameter - 1e-7));
      candidates.sort((a, b) => Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y));
      if (!candidates.length) break;
      placed.push(candidates[0]);
    }
    if (placed.length === positions.length) return placed;
  }
  return positions;
}
export function movementDelta(x, y, speed, dt) {
  if (![x, y, speed, dt].every(Number.isFinite) || speed < 0 || dt < 0) {
    throw new TypeError("Invalid movement input");
  }
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) {
    x /= magnitude;
    y /= magnitude;
  }
  return { x: x * speed * dt, y: y * speed * dt };
}


// Rectangles use { x, y, width, height } in world coordinates. The server
// supplies the actual map geometry through world.obstacles; an empty list
// intentionally means no terrain collision is enabled yet.
function intersectsObstacle(x, y, radius, obstacle) {
  const nearestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.width));
  const nearestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.height));
  return Math.hypot(x - nearestX, y - nearestY) < radius - 1e-7;
}

function validObstacles(world) {
  const obstacles = world?.obstacles ?? [];
  if (!Array.isArray(obstacles)) throw new TypeError("World obstacles must be an array");
  for (const o of obstacles) {
    if (!o || ![o.x, o.y, o.width, o.height].every(Number.isFinite) || o.width <= 0 || o.height <= 0) {
      throw new TypeError("Invalid world obstacle rectangle");
    }
  }
  return obstacles;
}

/**
 * Move a circular player through a rectangle-obstacle world. Movement is
 * resolved on each axis independently, allowing the player to slide along
 * walls rather than getting stuck on a diagonal corner.
 */
export function movePlayerWithObstacles(x, y, dx, dy, world, radius = PLAYER_RADIUS) {
  if (![x, y, dx, dy, radius].every(Number.isFinite) || radius < 0) {
    throw new TypeError("Invalid obstacle movement input");
  }
  const obstacles = validObstacles(world);
  const start = clampPlayerPosition(x, y, world, radius);
  let nextX = clampPlayerPosition(start.x + dx, start.y, world, radius).x;
  if (obstacles.some(o => intersectsObstacle(nextX, start.y, radius, o))) nextX = start.x;
  let nextY = clampPlayerPosition(nextX, start.y + dy, world, radius).y;
  if (obstacles.some(o => intersectsObstacle(nextX, nextY, radius, o))) nextY = start.y;
  return { x: nextX, y: nextY };
}
