// Server-authoritative charge timing for Saiyan's held Kame attack.
export const KAME_MIN_HOLD_MS = 300;
export const KAME_FULL_HOLD_MS = 1700;

export function beginKameCharge(player, at = Date.now()) {
  if (!player || !Number.isFinite(at) || player.kameChargeStartedAt > 0) return false;
  player.kameChargeStartedAt = at;
  return true;
}

export function kameChargePower(startedAt, at = Date.now()) {
  if (!Number.isFinite(startedAt) || startedAt <= 0 || !Number.isFinite(at) || at < startedAt) return 0;
  return Math.max(0, Math.min(1, (at - startedAt - KAME_MIN_HOLD_MS) / (KAME_FULL_HOLD_MS - KAME_MIN_HOLD_MS)));
}

export function finishKameCharge(player, at = Date.now()) {
  if (!player || !Number.isFinite(at) || !Number.isFinite(player.kameChargeStartedAt) || player.kameChargeStartedAt <= 0) return null;
  const startedAt = player.kameChargeStartedAt;
  player.kameChargeStartedAt = 0;
  const held = at - startedAt;
  if (held < KAME_MIN_HOLD_MS) return null;
  return kameChargePower(startedAt, at);
}
