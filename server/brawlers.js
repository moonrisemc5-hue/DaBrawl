// Core combat values aligned with BR in the browser game's index.html.
// This first server ruleset is intentionally explicit about unsupported special mechanics.
export const BRAWLERS = Object.freeze({
  kuku: Object.freeze({ hp: 7000, speed: 135, damage: 312.5, range: 230, cooldown: 1600, spread: 0.68, pellets: 8, bulletSpeed: 550, superDamage: 333.3, superRange: 340, superKind: "projectile" }),
  shachi: Object.freeze({ hp: 8000, speed: 145, damage: 1000, range: 160, cooldown: 1200, spread: 0.20, pellets: 2, bulletSpeed: 480, superDamage: 2500, superRange: 120, superKind: "slam" }),
  saiyan: Object.freeze({ hp: 6500, speed: 150, damage: 400, range: 65, cooldown: 1200, spread: 0, pellets: 1, bulletSpeed: 600, superDamage: 0, superRange: 0, superKind: "transform" }),
  default: Object.freeze({ hp: 7000, speed: 135, damage: 312.5, range: 230, cooldown: 1600, spread: 0.68, pellets: 8, bulletSpeed: 550, superDamage: 333.3, superRange: 340, superKind: "projectile" }),
});
