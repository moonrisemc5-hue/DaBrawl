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
  return { width: width*TILE_SIZE, height: height*TILE_SIZE, margin: 0, tileSize: TILE_SIZE, columns: width, rows: height, tiles, obstacles };
}
