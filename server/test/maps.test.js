import test from "node:test";
import assert from "node:assert/strict";
import { createArena, applyRoomMode, TILE_SIZE, registerArenaIceWallHit, advanceArenaWallFire, coolArenaWallStates, snapshotArenaWallStates, findArenaWallAlongRay } from "../maps.js";

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

test("only interior solid wall tiles can be destroyed and snapshots can replay the changes", async () => {
  const { removeArenaWall } = await import("../maps.js");
  const arena = createArena("knockout");
  assert.equal(removeArenaWall(arena, 1, 2), true);
  assert.equal(arena.tiles[1][2], ".");
  assert.equal(arena.destroyedWalls.some(w => w.row === 1 && w.col === 2), true);
  assert.equal(arena.obstacles.some(o => o.row === 1 && o.col === 2), false);
  assert.equal(removeArenaWall(arena, 0, 0), false);
  assert.equal(removeArenaWall(arena, 2, 11), false);
});

test("a charged beam stops at walls unless fully charged, then breaks interior walls", async () => {
  const { traceKameBeam } = await import("../maps.js");
  const arena = createArena("knockout");
  const x = 1.5 * TILE_SIZE, y = 1.5 * TILE_SIZE;
  const normal = traceKameBeam(arena, x, y, 0, 0.5);
  assert.ok(normal.length < 300 + 0.5 * 260);
  const fullArena = createArena("knockout");
  const full = traceKameBeam(fullArena, x, y, 0, 1);
  assert.equal(full.length, 560);
  assert.ok(full.destroyedWalls.length > 0);
});

test("Mastered Ultra Instinct beam spans the arena and removes interior walls in its path", async () => {
  const { traceMasteredBeam } = await import("../maps.js");
  const arena = createArena("knockout");
  const beam = traceMasteredBeam(arena, 2.5 * TILE_SIZE, 2.5 * TILE_SIZE, 0);
  assert.equal(beam.length, arena.width);
  assert.ok(beam.destroyedWalls.length > 0);
  for (const wall of beam.destroyedWalls) assert.equal(arena.tiles[wall.row][wall.col], ".");
});

test("applying a room mode rebuilds the actual arena and clears prior map damage", () => {
  const room = { mode: "knockout", world: createArena("knockout") };
  assert.equal(room.world.columns, 28);
  assert.equal(room.world.rows, 16);
  room.world.tiles[1][2] = ".";
  room.world.destroyedWalls.push({ row: 1, col: 2 });
  room.world.wallStates.push({ row: 2, col: 2, heat: 2, iceHits: 4, iced: false, melt: 0 });
  assert.equal(applyRoomMode(room, "showdown"), "showdown");
  assert.equal(room.mode, "showdown");
  assert.equal(room.world.columns, 44);
  assert.equal(room.world.rows, 28);
  assert.deepEqual(room.world.destroyedWalls, []);
  assert.deepEqual(room.world.wallStates, []);
  assert.equal(applyRoomMode(room, "invalid-mode"), "knockout");
  assert.equal(room.world.columns, 28);
});

test("twelve Ice-ball impacts turn a normal wall cyan and no attack can break it", async () => {
  const { removeArenaWall } = await import("../maps.js");
  const arena = createArena("knockout");
  for (let hit = 1; hit < 12; hit++) {
    const result = registerArenaIceWallHit(arena, 1, 2);
    assert.equal(result.changed, true);
    assert.equal(result.state.iced, false);
    assert.equal(result.state.iceHits, hit);
  }
  const frozen = registerArenaIceWallHit(arena, 1, 2);
  assert.equal(frozen.type, "iced");
  assert.equal(frozen.state.iceHits, 12);
  assert.equal(frozen.state.iced, true);
  assert.equal(snapshotArenaWallStates(arena)[0].iced, true);
  assert.equal(removeArenaWall(arena, 1, 2), false);
  assert.equal(arena.tiles[1][2], "#");
  assert.equal(registerArenaIceWallHit(arena, 1, 2).type, "already-iced");
});

test("Fire breaks normal walls after five seconds, with slow cooling if released early", async () => {
  const { removeArenaWall } = await import("../maps.js");
  const arena = createArena("knockout");
  assert.equal(advanceArenaWallFire(arena, 1, 2, 2).state.heat, 2);
  coolArenaWallStates(arena, 2);
  assert.equal(snapshotArenaWallStates(arena)[0].heat, 1);
  coolArenaWallStates(arena, 2);
  assert.equal(snapshotArenaWallStates(arena).length, 0);
  const broken = advanceArenaWallFire(arena, 1, 2, 5);
  assert.equal(broken.type, "broken");
  assert.equal(broken.state.heat, 5);
  assert.equal(arena.tiles[1][2], ".");
  assert.equal(removeArenaWall(arena, 1, 2), false);
});

test("five seconds of Fire melts Ice walls; a melted wall can then be heated and broken", () => {
  const arena = createArena("knockout");
  for (let i = 0; i < 12; i++) registerArenaIceWallHit(arena, 1, 2);
  assert.equal(advanceArenaWallFire(arena, 1, 2, 4.5).type, "melting");
  assert.equal(snapshotArenaWallStates(arena)[0].iced, true);
  assert.equal(advanceArenaWallFire(arena, 1, 2, 0.5).type, "melted");
  assert.equal(arena.tiles[1][2], "#");
  assert.equal(snapshotArenaWallStates(arena).length, 0);
  assert.equal(advanceArenaWallFire(arena, 1, 2, 5).type, "broken");
  assert.equal(arena.tiles[1][2], ".");
});

test("normal and Mastered Saiyan beams stop at an indestructible Ice wall", async () => {
  const { traceKameBeam, traceMasteredBeam, removeArenaWall } = await import("../maps.js");
  const arena = createArena("knockout");
  for (let i = 0; i < 12; i++) registerArenaIceWallHit(arena, 2, 2);
  const regular = traceKameBeam(arena, 2.5 * TILE_SIZE, 2.5 * TILE_SIZE, 0, 1);
  const mastered = traceMasteredBeam(arena, 2.5 * TILE_SIZE, 2.5 * TILE_SIZE, 0);
  assert.equal(regular.length, 0);
  assert.equal(mastered.length, 0);
  assert.equal(regular.destroyedWalls.length, 0);
  assert.equal(mastered.destroyedWalls.length, 0);
  assert.equal(removeArenaWall(arena, 2, 2), false);
});


test("samples a short Ramu flame ray through the tile grid and returns the first wall cell", () => {
  const arena = createArena("knockout");
  const hit = findArenaWallAlongRay(arena, 1.5*TILE_SIZE, 1.5*TILE_SIZE, 1, 0, 285, 8);
  assert.deepEqual(hit, { row: 1, col: 2, distance: 16, sampleDistance: 24 });
  assert.equal(findArenaWallAlongRay(arena, 5.5*TILE_SIZE, 7.5*TILE_SIZE, 1, 0, 40, 8), null);
  assert.throws(() => findArenaWallAlongRay(arena, 0, 0, 1, 0, 20, 0), TypeError);
});
