import test from "node:test";
import assert from "node:assert/strict";
import { BRAWLERS } from "../brawlers.js";

test("all browser brawlers have explicit server rules", () => {
  for (const id of ["kuku", "shachi", "saiyan"]) assert.ok(BRAWLERS[id], `Missing ${id}`);
});

test("Kuku's server baseline matches the browser balance", () => {
  assert.equal(BRAWLERS.kuku.hp, 7000);
  assert.equal(BRAWLERS.kuku.speed, 135);
  assert.equal(BRAWLERS.kuku.pellets, 8);
  assert.equal(BRAWLERS.kuku.range, 230);
  assert.equal(BRAWLERS.kuku.spread, 0.68);
});

test("Shachi has tank stats and a slam super", () => {
  assert.equal(BRAWLERS.shachi.hp, 8000);
  assert.equal(BRAWLERS.shachi.pellets, 2);
  assert.equal(BRAWLERS.shachi.superKind, "slam");
});

test("Saiyan uses short-range attacks and transformation super", () => {
  assert.equal(BRAWLERS.saiyan.hp, 6500);
  assert.equal(BRAWLERS.saiyan.range, 65);
  assert.equal(BRAWLERS.saiyan.superKind, "transform");
});
