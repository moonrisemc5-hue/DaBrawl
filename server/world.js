export const PLAYER_RADIUS = 19;

export function clampPlayerPosition(x, y, world, radius = PLAYER_RADIUS) {
  if (!world || !Number.isFinite(world.width) || !Number.isFinite(world.height) || !Number.isFinite(world.margin) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) throw new TypeError("Invalid player position or world bounds");
  const minX = world.margin + radius, minY = world.margin + radius;
  const maxX = world.width - world.margin - radius, maxY = world.height - world.margin - radius;
  if (minX > maxX || minY > maxY) throw new RangeError("World is too small for player collision radius");
  return { x: Math.max(minX, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)) };
}

export function resolvePlayerCollisions(players, world, radius = PLAYER_RADIUS) {
  if (!Array.isArray(players) || !Number.isFinite(radius) || radius < 0) throw new TypeError("Invalid player collision inputs");
  const positions = players.map(player => {
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) throw new TypeError("Invalid player position");
    return clampPlayerPosition(player.x, player.y, world, radius);
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
