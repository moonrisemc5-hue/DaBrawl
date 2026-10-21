// Baseline values are aligned with BR in the browser game's index.html.
// Saiyan's persistent form overrides are copied from the browser FM table.
// Terrain and charged attacks have server-owned rules; exact form-specific animation timing remains client-side.
const SAIYAN_FORMS = Object.freeze({
  1: Object.freeze({ hp: 7500, damage: 500, beamDamageStart: 800, beamDamageMax: 3200 }),
  2: Object.freeze({ hp: 8500, damage: 1500, range: 420, bulletSpeed: 650, beamDamageStart: 1600, beamDamageMax: 2600 }),
  3: Object.freeze({ hp: 9500, damage: 2100, range: 440, bulletSpeed: 700, beamDamageStart: 2200, beamDamageMax: 3200 }),
  4: Object.freeze({ hp: 10000, damage: 700, range: 140, bulletSpeed: 750, beamDamageStart: 1200, beamDamageMax: 5200 }),
  5: Object.freeze({ hp: 10500, damage: 800, range: 180, bulletSpeed: 800, beamDamageStart: 1400, beamDamageMax: 5700 })
});

export const BRAWLERS = Object.freeze({
  kuku: Object.freeze({ hp: 7000, speed: 135, damage: 312.5, range: 230, cooldown: 1600, spread: 0.68, pellets: 8, bulletSpeed: 550, superDamage: 333.3, superRange: 340, superKind: "projectile" }),
  shachi: Object.freeze({ hp: 10000, speed: 145, damage: 1000, range: 160, cooldown: 1200, spread: 0.20, pellets: 2, bulletSpeed: 480, superDamage: 2500, superRange: 120, superKind: "slam" }),
  saiyan: Object.freeze({ hp: 6500, speed: 150, damage: 400, range: 65, cooldown: 1200, spread: 0, pellets: 1, bulletSpeed: 600, superDamage: 0, superRange: 0, superKind: "transform", beamDamageStart: 700, beamDamageMax: 2200, forms: SAIYAN_FORMS }),
  deges: Object.freeze({ hp: 7600, speed: 138, damage: 1062, range: 300, cooldown: 2400, spread: 0, pellets: 1, bulletSpeed: 430, superDamage: 1375.5, superRange: 330, superKind: "projectile", heal: 2250, superHeal: 3750, superBulletSpeed: 300, gadgetKind: "smoke-heal", gadgetChannelMs: 2000, gadgetCooldownMs: 17000 }),
  ramu: Object.freeze({ hp: 8000, speed: 142, damage: 1000, range: 250, cooldown: 750, spread: 0, pellets: 1, bulletSpeed: 480, superDamage: 0, superRange: 0, superKind: "transform", fireDamage: 1000, fireRange: 285, fireTickMs: 350, fireInitialReachMs: 400, fireReachSpeed: 720, fireSuperCharge: 6.6, fireEnergyDrainPerSecond: 0.18, fireEnergyRegenPerSecond: 0.13, fireLockMs: 200, iceBurstShots: 3, iceBurstIntervalMs: 170, freezeHits: 8, freezeDurationMs: 2000, gadgetKind: "crystal-shield", fireGadgetKind: "flame-dive", gadgetShieldMs: 2800, gadgetDiveMs: 5220, gadgetDiveLiftMs: 220, gadgetDiveCooldownMs: 20000, gadgetCooldownMs: 12000 }),
  hacker: Object.freeze({ hp: 6800, speed: 125, damage: 620, range: 470, cooldown: 1800, reloadMs: 1600, spread: 0, pellets: 1, bulletSpeed: 520, superDamage: 0, superRange: 430, superKind: "takeover", gadgetKind: "remote-link", gadgetCooldownMs: 2000 }),
  default: Object.freeze({ hp: 7000, speed: 135, damage: 312.5, range: 230, cooldown: 1600, spread: 0.68, pellets: 8, bulletSpeed: 550, superDamage: 333.3, superRange: 340, superKind: "projectile" }),
});

// Client-provided form numbers are never trusted. Progression is always one form at a time.
export function getNextSaiyanForm(player) {
  if (player?.brawler !== "saiyan") return null;
  const currentForm = Number.isInteger(player.form) ? player.form : 0;
  const nextForm = currentForm + 1;
  return SAIYAN_FORMS[nextForm] ? nextForm : null;
}

export function getBrawlerStats(player) {
  const base = BRAWLERS[player?.brawler] || BRAWLERS.default;
  const form = base.forms?.[player?.form];
  if (!form) return base;
  return { ...base, ...form };
}
