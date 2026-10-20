import { validMode } from "./protocol.js";

export const TILE_SIZE = 48;
export const ARENA_WALL_RULES = Object.freeze({ iceHits: 12, heatSeconds: 5, meltSeconds: 5, coolPerSecond: 0.5 });
const KNOCKOUT_HALF = ["..............","..#...bb......","..#...bb..~~..","......bb..~~..","..bb......#...","..bb..##..#...","......##......","...~~.....#..."];
function mirrorRows(rows) {
  const horizontal = rows.map(row => row + [...row].reverse().join(""));
  return [...horizontal, ...[...horizontal].reverse()].map(row => [...row]);
}
function showdownTiles() {
  const width = 44, height = 28;
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return "#";
    if ((x % 6 === 0 && y % 5 === 0) || (x % 7 === 3 && y % 6 === 2)) return "#";
    if (x > 15 && x < 28 && y > 10 && y < 18) return "~";
    return ".";
  }));
}
export function createArena(mode = "knockout") {
  const tiles = mode === "showdown" ? showdownTiles() : mirrorRows(KNOCKOUT_HALF);
  const height = tiles.length, width = tiles[0].length, obstacles = [];
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const tile = tiles[row][col];
    if (tile === "#" || tile === "~") obstacles.push({ x: col*TILE_SIZE, y: row*TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE, tile, row, col });
  }
  return { width: width*TILE_SIZE, height: height*TILE_SIZE, margin: 0, tileSize: TILE_SIZE, columns: width, rows: height, tiles, obstacles, destroyedWalls: [], wallStates: [] };
}

/** Find the first wall on a short sampled ray without scanning every obstacle. */
export function findArenaWallAlongRay(arena, x, y, dx, dy, maxDistance, step = 8) {
  if (!arena || !Array.isArray(arena.tiles) || ![x, y, dx, dy, maxDistance, step].every(Number.isFinite) || maxDistance < 0 || step <= 0) {
    throw new TypeError("Invalid arena ray input");
  }
  const tileSize = Number.isFinite(arena.tileSize) && arena.tileSize > 0 ? arena.tileSize : TILE_SIZE;
  for (let sampleDistance = step; sampleDistance <= maxDistance; sampleDistance += step) {
    const col = Math.floor((x + dx * sampleDistance) / tileSize);
    const row = Math.floor((y + dy * sampleDistance) / tileSize);
    if (arena.tiles[row]?.[col] === "#") {
      return { row, col, distance: Math.max(0, sampleDistance - step), sampleDistance };
    }
  }
  return null;
}

function wallStateFor(arena, row, col) {
  let state = arena.wallStates.find(w => w.row === row && w.col === col);
  if (!state) {
    state = { row, col, heat: 0, iceHits: 0, iced: false, melt: 0 };
    arena.wallStates.push(state);
  }
  return state;
}
function copyWallState(state) {
  return { row: state.row, col: state.col, heat: state.heat, iceHits: state.iceHits, iced: state.iced, melt: state.melt };
}

/** Returns the current mutable state for an interior wall, or null for non-walls. */
export function getArenaWallState(arena, row, col) {
  if (!arena || !Number.isInteger(row) || !Number.isInteger(col) || arena.tiles[row]?.[col] !== "#") return null;
  return arena.wallStates.find(w => w.row === row && w.col === col) ?? null;
}

/** Small state deltas are included in snapshots; untouched walls remain implicit. */
export function snapshotArenaWallStates(arena) {
  if (!arena || !Array.isArray(arena.wallStates)) return [];
  return arena.wallStates
    .filter(w => w.heat > 0 || w.iceHits > 0 || w.iced || w.melt > 0)
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map(copyWallState);
}

/** One Ice-ball impact adds one hit; twelve hits turn the wall into an unbreakable ice wall. */
export function registerArenaIceWallHit(arena, row, col, hitThreshold = ARENA_WALL_RULES.iceHits) {
  if (!arena || !Number.isInteger(row) || !Number.isInteger(col) || row <= 0 || col <= 0 || row >= arena.rows - 1 || col >= arena.columns - 1 || arena.tiles[row]?.[col] !== "#") {
    return { changed: false, type: "no-wall", state: null };
  }
  const state = wallStateFor(arena, row, col);
  if (state.iced) return { changed: false, type: "already-iced", state: copyWallState(state) };
  state.heat = 0;
  state.melt = 0;
  state.iceHits = Math.min(hitThreshold, state.iceHits + 1);
  if (state.iceHits >= hitThreshold) {
    state.iced = true;
    state.melt = 0;
    return { changed: true, type: "iced", state: copyWallState(state) };
  }
  return { changed: true, type: "frosting", state: copyWallState(state) };
}

/** Fire warms a normal wall, or melts an iced one. Normal walls need five seconds. */
export function advanceArenaWallFire(arena, row, col, seconds, rules = ARENA_WALL_RULES) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError("Invalid wall-fire duration");
  if (!arena || !Number.isInteger(row) || !Number.isInteger(col) || row <= 0 || col <= 0 || row >= arena.rows - 1 || col >= arena.columns - 1 || arena.tiles[row]?.[col] !== "#") {
    return { changed: false, type: "no-wall", state: null };
  }
  const state = wallStateFor(arena, row, col);
  if (seconds === 0) return { changed: false, type: state.iced ? "melting" : "heating", state: copyWallState(state) };
  if (state.iced) {
    state.melt = Math.min(rules.meltSeconds, state.melt + seconds);
    if (state.melt >= rules.meltSeconds) {
      state.iced = false;
      state.iceHits = 0;
      state.melt = 0;
      state.heat = 0;
      return { changed: true, type: "melted", state: copyWallState(state) };
    }
    return { changed: true, type: "melting", state: copyWallState(state) };
  }
  // Fire clears incomplete frost as it heats the wall.
  state.iceHits = 0;
  state.melt = 0;
  state.heat = Math.min(rules.heatSeconds, state.heat + seconds);
  if (state.heat >= rules.heatSeconds) {
    const finished = copyWallState(state);
    removeArenaWall(arena, row, col);
    return { changed: true, type: "broken", state: finished };
  }
  return { changed: true, type: "heating", state: copyWallState(state) };
}

/** Unattended heat and melt progress cool at half their build rate. */
export function coolArenaWallStates(arena, seconds, activeKeys = new Set(), coolPerSecond = ARENA_WALL_RULES.coolPerSecond) {
  if (!arena || !Array.isArray(arena.wallStates)) return [];
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(coolPerSecond) || coolPerSecond < 0) {
    throw new TypeError("Invalid wall cooling duration");
  }
  const cooled = [];
  for (const state of arena.wallStates) {
    if (activeKeys.has(`${state.row}:${state.col}`)) continue;
    const oldHeat = state.heat, oldMelt = state.melt;
    state.heat = Math.max(0, state.heat - seconds * coolPerSecond);
    state.melt = Math.max(0, state.melt - seconds * coolPerSecond);
    if (state.heat !== oldHeat || state.melt !== oldMelt) cooled.push(copyWallState(state));
  }
  arena.wallStates = arena.wallStates.filter(w => w.iced || w.iceHits > 0 || w.heat > 0 || w.melt > 0);
  return cooled;
}

export function removeArenaWall(arena, row, col) {
  if (!arena || !Number.isInteger(row) || !Number.isInteger(col) ||
      row <= 0 || col <= 0 || row >= arena.rows - 1 || col >= arena.columns - 1 ||
      arena.tiles[row]?.[col] !== "#") return false;
  if (arena.wallStates?.some(w => w.row === row && w.col === col && w.iced)) return false;
  arena.tiles[row][col] = ".";
  arena.obstacles = arena.obstacles.filter(o => !(o.row === row && o.col === col && o.tile === "#"));
  arena.wallStates = (arena.wallStates ?? []).filter(w => !(w.row === row && w.col === col));
  if (!arena.destroyedWalls.some(w => w.row === row && w.col === col)) arena.destroyedWalls.push({ row, col });
  return true;
}

/** Trace a Saiyan beam using the browser's 8-unit terrain sampling and wall-break rule. */
export function traceKameBeam(arena, x, y, angle, charge) {
  const maxLength = 300 + Math.max(0, Math.min(1, charge)) * 260;
  const destroysWalls = charge >= 0.95;
  const dx = Math.cos(angle), dy = Math.sin(angle), destroyedWalls = [];
  let length = 0;
  for (; length < maxLength; length += 8) {
    const col = Math.floor((x + dx * length) / arena.tileSize);
    const row = Math.floor((y + dy * length) / arena.tileSize);
    const tile = arena.tiles[row]?.[col] ?? "#";
    if (tile !== "#") continue;
    if (!destroysWalls) return { length, destroyedWalls: [] };
    if (removeArenaWall(arena, row, col)) destroyedWalls.push({ row, col });
    else return { length, destroyedWalls };
  }
  return { length: maxLength, destroyedWalls };
}

/** Trace the full-width Mastered Ultra Instinct beam and break every interior wall it crosses. */
export function traceMasteredBeam(arena, x, y, angle) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const maxLength = arena.width;
  const destroyed = [];
  for (let length = 0; length < maxLength; length += 8) {
    const col = Math.floor((x + dx * length) / arena.tileSize);
    const row = Math.floor((y + dy * length) / arena.tileSize);
    const tile = arena.tiles[row]?.[col] ?? "#";
    if (tile === "#") {
      if (removeArenaWall(arena, row, col)) destroyed.push({ row, col });
      else if (arena.wallStates?.some(w => w.row === row && w.col === col && w.iced)) return { length, destroyedWalls: destroyed };
    }
  }
  return { length: maxLength, destroyedWalls: destroyed };
}

/** Replace a waiting room's arena when its owner selects a mode. */
export function applyRoomMode(room, mode) {
  if (!room || typeof room !== "object") throw new TypeError("Room is required");
  const normalizedMode = validMode(mode);
  room.mode = normalizedMode;
  room.world = createArena(normalizedMode);
  return normalizedMode;
}
