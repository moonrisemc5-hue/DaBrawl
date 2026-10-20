// Server-authoritative gadget charge and cooldown rules.
// Timings are based on the browser gadget cooldowns; special visual effects still require client parity.
export function getGadgetCooldownMs(player) {
  // Degeš has a 900ms toss, a 3s green-beer pool, then a 15s cooldown.
  if (player?.brawler === "deges") return 18_900;
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
