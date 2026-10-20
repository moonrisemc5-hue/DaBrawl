// Server-authoritative gadget charge and cooldown rules.
// Timings are based on the browser gadget cooldowns; special visual effects still require client parity.
export function getGadgetCooldownMs(player) {
  // Degeš channels smoke for two seconds; cooldown includes the channel, then 15s.
  if (player?.brawler === "deges") return 17_000;
  // Ice Cube keeps the existing 12s cooldown. Fire Dive starts its 20s cooldown only on landing.
  if (player?.brawler === "ramu") return player.ramuMode === "fire" ? 0 : 12_000;
  if (player?.brawler === "saiyan") {
    if (player.form === 2) return 7_000;
    if (player.form === 3) return 14_000;
    if (player.form === 4) return 13_000;
    if (player.form >= 5) return 15_000;
  }
  return 10_000;
}

export function gadgetCharges(player, at = Date.now()) {
  return player && Number.isFinite(player.gadgetReadyAt) && player.gadgetReadyAt > at ? 0 : 1;
}

export function tryConsumeGadget(player, at = Date.now()) {
  if (!player || !Number.isFinite(at) || gadgetCharges(player, at) < 1) return false;
  player.gadgetReadyAt = at + getGadgetCooldownMs(player);
  return true;
}

/** Start Ramu's Fire Dive cooldown at landing, not at launch. */
export function startRamuDiveCooldown(player, at, durationMs) {
  if (!player || player.brawler !== "ramu" || !Number.isFinite(at) || !Number.isFinite(durationMs) || durationMs < 0) return false;
  player.gadgetReadyAt = at + durationMs;
  return true;
}
