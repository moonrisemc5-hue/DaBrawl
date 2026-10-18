import test from "node:test";
import assert from "node:assert/strict";
import { gadgetCharges, getGadgetCooldownMs, tryConsumeGadget } from "../abilities.js";

test("gadget starts with one charge and consumes it exactly once", () => {
  const player = { brawler: "kuku", form: 0, gadgetReadyAt: 0 };
  assert.equal(gadgetCharges(player, 1000), 1);
  assert.equal(tryConsumeGadget(player, 1000), true);
  assert.equal(player.gadgetReadyAt, 11000);
  assert.equal(gadgetCharges(player, 1000), 0);
  assert.equal(tryConsumeGadget(player, 2000), false);
  assert.equal(player.gadgetReadyAt, 11000);
});

test("gadget charge refills at the exact cooldown boundary", () => {
  const player = { brawler: "shachi", form: 0, gadgetReadyAt: 11000 };
  assert.equal(gadgetCharges(player, 10999), 0);
  assert.equal(gadgetCharges(player, 11000), 1);
  assert.equal(tryConsumeGadget(player, 11000), true);
  assert.equal(player.gadgetReadyAt, 21000);
});

test("gadget cooldown matches browser form-specific cooldowns", () => {
  assert.equal(getGadgetCooldownMs({ brawler: "kuku" }), 10000);
  assert.equal(getGadgetCooldownMs({ brawler: "shachi" }), 10000);
  assert.equal(getGadgetCooldownMs({ brawler: "saiyan", form: 1 }), 10000);
  assert.equal(getGadgetCooldownMs({ brawler: "saiyan", form: 2 }), 7000);
  assert.equal(getGadgetCooldownMs({ brawler: "saiyan", form: 3 }), 14000);
  assert.equal(getGadgetCooldownMs({ brawler: "saiyan", form: 4 }), 13000);
  assert.equal(getGadgetCooldownMs({ brawler: "saiyan", form: 5 }), 15000);
});

test("invalid player or time cannot consume a gadget charge", () => {
  assert.equal(tryConsumeGadget(null, 1000), false);
  assert.equal(tryConsumeGadget({ gadgetReadyAt: 0 }, NaN), false);
});
