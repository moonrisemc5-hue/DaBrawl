export const PLAYER_RADIUS = 19;

export function clampPlayerPosition(x, y, world, radius = PLAYER_RADIUS) {
  if (!world || !Number.isFinite(world.width) || !Number.isFinite(world.height) || !Number.isFinite(world.margin) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) throw new TypeError("Invalid player position or world bounds");
  const minX = world.margin + radius, minY = world.margin + radius;
  const maxX = world.width - world.margin - radius, maxY = world.height - world.margin - radius;
  if (minX > maxX || minY > maxY) throw new RangeError("World is too small for player collision radius");
  return { x: Math.max(minX, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)) };
}
