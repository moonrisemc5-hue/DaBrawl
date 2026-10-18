import test from "node:test";
import assert from "node:assert/strict";
import { createArena, TILE_SIZE } from "../maps.js";

test("builds knockout and duel maps at the browser's 28 by 16 tile size", () => {
  for (const mode of ["knockout", "duel"]) {
    const arena = createArena(mode);
    assert.equal(arena.columns, 28);
    assert.equal(arena.rows, 16);
    assert.equal(arena.width, 28 * TILE_SIZE);
    assert.equal(arena.height, 16 * TILE_SIZE);
    assert.equal(arena.tiles[1][2], "#");
    assert.ok(arena.obstacles.some(o => o.tile === "~"));
  }
});
test("builds the browser's showdown map and perimeter walls", () => {
  const arena = createArena("showdown");
  assert.equal(arena.columns, 44);
  assert.equal(arena.rows, 28);
  assert.equal(arena.tiles[0].every(tile => tile === "#"), true);
  assert.equal(arena.tiles.at(-1).every(tile => tile === "#"), true);
  assert.ok(arena.obstacles.some(o => o.tile === "~"));
});
test("does not treat bushes as solid collision obstacles", () => {
  const arena = createArena("knockout");
  assert.ok(arena.tiles.some(row => row.includes("b")));
  assert.ok(arena.obstacles.every(o => o.tile === "#" || o.tile === "~"));
});

import { removeArenaWall } from "../maps.js";

test("only interior solid wall tiles can be destroyed and snapshots can replay the changes", () => {
  const arena = createArena("knockout");
  assert.equal(removeArenaWall(arena, 1, 2), true);
  assert.equal(arena.tiles[1][2], ".");
  assert.equal(arena.destroyedWalls.some(w => w.row === 1 && w.col === 2), true);
  assert.equal(arena.obstacles.some(o => o.row === 1 && o.col === 2), false);
  assert.equal(removeArenaWall(arena, 0, 0), false);
  assert.equal(removeArenaWall(arena, 2, 11), false);
});

import { traceKameBeam } from "../maps.js";
test("a charged beam stops at walls unless fully charged, then breaks interior walls", () => {
  const arena = createArena("knockout");
  const x = 1.5 * TILE_SIZE, y = 1.5 * TILE_SIZE;
  const normal = traceKameBeam(arena, x, y, 0, 0.5);
  assert.ok(normal.length < 300 + 0.5 * 260);
  const fullArena = createArena("knockout");
  const full = traceKameBeam(fullArena, x, y, 0, 1);
  assert.equal(full.length, 560);
  assert.ok(fullArena.destroyedWalls.length > 0);
});

import { traceMasteredBeam } from "../maps.js";

test("Mastered Ultra Instinct beam spans the arena and removes interior walls in its path", () => {
  const arena = createArena("knockout");
  const beam = traceMasteredBeam(arena, 2.5 * TILE_SIZE, 2.5 * TILE_SIZE, 0);
  assert.equal(beam.length, arena.width);
  assert.ok(beam.destroyedWalls.length > 0);
  for (const wall of beam.destroyedWalls) assert.equal(arena.tiles[wall.row][wall.col], ".");
});
