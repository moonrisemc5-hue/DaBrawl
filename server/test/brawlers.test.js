import test from "node:test";
import assert from "node:assert/strict";
import { BRAWLERS, getBrawlerStats, getNextSaiyanForm } from "../brawlers.js";

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

test("Saiyan uses short-range base attacks and transformation super", () => {
  assert.equal(BRAWLERS.saiyan.hp, 6500);
  assert.equal(BRAWLERS.saiyan.range, 65);
  assert.equal(BRAWLERS.saiyan.superKind, "transform");
});

test("Saiyan form stats preserve the browser's persistent form progression", () => {
  const player = { brawler: "saiyan", form: 0 };
  assert.equal(getBrawlerStats(player).damage, 400);
  player.form = 1;
  assert.equal(getBrawlerStats(player).hp, 7500);
  assert.equal(getBrawlerStats(player).damage, 500);
  player.form = 2;
  assert.equal(getBrawlerStats(player).hp, 8500);
  assert.equal(getBrawlerStats(player).range, 420);
  assert.equal(getBrawlerStats(player).bulletSpeed, 650);
  player.form = 3;
  assert.equal(getBrawlerStats(player).damage, 2100);
  assert.equal(getBrawlerStats(player).range, 440);
  player.form = 4;
  assert.equal(getBrawlerStats(player).hp, 10000);
  assert.equal(getBrawlerStats(player).range, 140);
  player.form = 5;
  assert.equal(getBrawlerStats(player).hp, 10500);
  assert.equal(getBrawlerStats(player).damage, 800);
  assert.equal(getBrawlerStats({ brawler: "kuku", form: 5 }).hp, 7000);
});

test("Saiyan form progression is sequential and stops at the final form", () => {
  const player = { brawler: "saiyan", form: 0 };
  assert.equal(getNextSaiyanForm(player), 1);
  player.form = 1;
  assert.equal(getNextSaiyanForm(player), 2);
  player.form = 4;
  assert.equal(getNextSaiyanForm(player), 5);
  player.form = 5;
  assert.equal(getNextSaiyanForm(player), null);
  player.form = 99;
  assert.equal(getNextSaiyanForm(player), null);
});

test("non-Saiyan players cannot request Saiyan form progression", () => {
  assert.equal(getNextSaiyanForm({ brawler: "kuku", form: 0 }), null);
  assert.equal(getNextSaiyanForm({ brawler: "shachi", form: 0 }), null);
  assert.equal(getNextSaiyanForm(null), null);
});

test("Saiyan form stats include browser-aligned Kame beam damage scaling", () => {
  assert.equal(getBrawlerStats({ brawler: "saiyan", form: 0 }).beamDamageStart, 700);
  assert.equal(getBrawlerStats({ brawler: "saiyan", form: 1 }).beamDamageMax, 3200);
  assert.equal(getBrawlerStats({ brawler: "saiyan", form: 5 }).beamDamageMax, 5700);
});
