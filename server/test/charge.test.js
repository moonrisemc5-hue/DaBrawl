import test from "node:test";
import assert from "node:assert/strict";
import { beginKameCharge, finishKameCharge, kameChargePower, KAME_MIN_HOLD_MS, KAME_FULL_HOLD_MS } from "../charge.js";

test("Kame charge is timed by the server and reaches full power at the cap", () => {
  const player = { kameChargeStartedAt: 0 };
  assert.equal(beginKameCharge(player, 1000), true);
  assert.equal(beginKameCharge(player, 1100), false);
  assert.equal(kameChargePower(player.kameChargeStartedAt, 1299), 0);
  assert.equal(kameChargePower(player.kameChargeStartedAt, 1350), 50 / (KAME_FULL_HOLD_MS - KAME_MIN_HOLD_MS));
  assert.equal(kameChargePower(player.kameChargeStartedAt, 5000), 1);
  assert.equal(finishKameCharge(player, 2700), 1);
  assert.equal(player.kameChargeStartedAt, 0);
});

test("short or invalid Kame holds do not produce a beam", () => {
  const player = { kameChargeStartedAt: 1000 };
  assert.equal(finishKameCharge(player, 1000 + KAME_MIN_HOLD_MS - 1), null);
  assert.equal(player.kameChargeStartedAt, 0);
  assert.equal(finishKameCharge(player, 5000), null);
  assert.equal(kameChargePower(1000, 900), 0);
  assert.equal(beginKameCharge(player, NaN), false);
});
