export const TILE_SIZE = 48;
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
  return { width: width*TILE_SIZE, height: height*TILE_SIZE, margin: 0, tileSize: TILE_SIZE, columns: width, rows: height, tiles, obstacles, destroyedWalls: [] };
}

export function removeArenaWall(arena, row, col) {
  if (!arena || !Number.isInteger(row) || !Number.isInteger(col) ||
      row <= 0 || col <= 0 || row >= arena.rows - 1 || col >= arena.columns - 1 ||
      arena.tiles[row]?.[col] !== "#") return false;
  arena.tiles[row][col] = ".";
  arena.obstacles = arena.obstacles.filter(o => !(o.row === row && o.col === col && o.tile === "#"));
  if (!arena.destroyedWalls.some(w => w.row === row && w.col === col)) arena.destroyedWalls.push({ row, col });
  return true;
}

/** Trace a Saiyan beam using the browser's 8-unit terrain sampling and wall-break rule. */
export function traceKameBeam(arena, x, y, angle, charge) {
  const maxLength = 300 + Math.max(0, Math.min(1, charge)) * 260;
  const destroysWalls = charge >= 0.95;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let length = 0;
  for (; length < maxLength; length += 8) {
    const col = Math.floor((x + dx * length) / arena.tileSize);
    const row = Math.floor((y + dy * length) / arena.tileSize);
    const tile = arena.tiles[row]?.[col] ?? "#";
    if (tile !== "#") continue;
    if (!destroysWalls) return { length, destroyedWalls: [] };
    removeArenaWall(arena, row, col);
  }
  return { length: maxLength, destroyedWalls: [...arena.destroyedWalls] };
}
