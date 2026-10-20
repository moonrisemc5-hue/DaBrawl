// Pure schema adapter for the future browser integration.
// This module deliberately does not open sockets, mutate game state, or apply damage.
// It is safe to test independently while the existing Supabase Realtime path stays live.

const finite = value => typeof value === "number" && Number.isFinite(value);
const text = value => typeof value === "string" ? value : "";

export function adaptServerPlayer(player) {
  if (!player || typeof player !== "object" || typeof player.id !== "string" || !player.id) return null;
  if (!finite(player.x) || !finite(player.y) || !finite(player.hp) || !finite(player.maxHp)) return null;
  return {
    id: player.id,
    name: text(player.name),
    x: player.x,
    y: player.y,
    a: finite(player.aim) ? player.aim : 0,
    hp: player.hp,
    mh: player.maxHp,
    alive: player.alive === true,
    // Meter units are passed through as a raw value; gameplay parity still needs validation.
    sc: finite(player.meter) ? player.meter : 0,
    form: finite(player.form) ? player.form : 0,
    tfn: finite(player.form) ? player.form : 0,
    tf: player.transforming === true ? 1 : 0,
    brawler: text(player.brawler),
    ramuMode: player.ramuMode === "ice" || player.ramuMode === "fire" ? player.ramuMode : null,
    fireEnergy: finite(player.fireEnergy) ? Math.max(0, Math.min(1, player.fireEnergy)) : null,
    fireLockMs: finite(player.fireLockMs) ? Math.max(0, player.fireLockMs) : null,
    ramuFlameHeld: player.ramuFlameHeld === true,
    ramuDiveUntil: finite(player.ramuDiveUntil) ? player.ramuDiveUntil : null,
    ramuDiveMoveMs: finite(player.ramuDiveMoveMs) ? Math.max(0, player.ramuDiveMoveMs) : null,
    ramuShieldMs: finite(player.ramuShieldMs) ? Math.max(0, player.ramuShieldMs) : null,
    freezeMeter: finite(player.freezeMeter) ? Math.max(0, Math.min(1, player.freezeMeter)) : null,
    frozenMs: finite(player.frozenMs) ? Math.max(0, player.frozenMs) : null,
    burnMs: finite(player.burnMs) ? Math.max(0, player.burnMs) : null,
    smokeMs: finite(player.smokeMs) ? Math.max(0, player.smokeMs) : null,
    team: finite(player.team) ? player.team : null,
    slot: finite(player.slot) ? player.slot : null,
    // Preserve authoritative gadget timing without guessing the browser's units.
    gadgetCharges: finite(player.gadgetCharges) ? Math.max(0, player.gadgetCharges) : null,
    gadgetCooldownMs: finite(player.gadgetCooldownMs) ? Math.max(0, player.gadgetCooldownMs) : null,
    kameCooldownMs: finite(player.kameCooldownMs) ? Math.max(0, player.kameCooldownMs) : null,
    muiCharging: player.muiCharging === true,
    connected: player.connected === true,
    ready: player.ready === true
  };
}

const EVENT_KINDS = Object.freeze({
  "match-countdown": "countdown",
  "match-countdown-cancelled": "countdown-cancelled",
  "match-started": "match-started",
  "attack-fired": "attack-fired",
  "super-fired": "super-fired",
  "super-slam": "super-fired",
  "hit": "hit-confirmed",
  "freeze": "freeze",
  "burn-tick": "burn",
  "ramu-impact": "area-impact",
  "ramu-flame-start": "fire-start",
  "ramu-flame-stop": "fire-stop",
  "ramu-flame-empty": "fire-empty",
  "knockout": "knockout",
  "transform": "transform",
  "gadget": "gadget",
  "wall-break": "wall-break",
  "wall-state": "wall-state",
  "kame-fired": "kame-fired",
  "mui-charging": "mui-charging",
  "mui-beam-fired": "mui-beam-fired",
  "match-ended": "match-ended",
  "player-joined": "player-joined",
  "player-disconnected": "player-disconnected"
});

export function adaptServerPacket(packet) {
  if (!packet || typeof packet !== "object" || typeof packet.type !== "string") return null;
  if (packet.type === "state") {
    const state = packet.state;
    if (!state || typeof state !== "object" || !Array.isArray(state.players)) return null;
    const players = state.players.map(adaptServerPlayer);
    if (players.some(player => player === null)) return null;
    return {
      kind: "state",
      room: text(packet.room),
      tick: finite(packet.tick) ? packet.tick : (finite(state.tick) ? state.tick : 0),
      serverTime: finite(packet.serverTime) ? packet.serverTime : null,
      state: {
        mode: text(state.mode),
        phase: text(state.phase),
        startedAt: finite(state.startedAt) ? state.startedAt : 0,
        endsAt: finite(state.endsAt) ? state.endsAt : 0,
        winner: state.winner ?? null,
        ownerId: text(state.ownerId),
        destroyedWalls: Array.isArray(state.destroyedWalls) ? state.destroyedWalls.filter(w => w && Number.isInteger(w.row) && Number.isInteger(w.col)).map(w => ({ row: w.row, col: w.col })) : [],
        wallStates: Array.isArray(state.wallStates) ? state.wallStates.filter(w => w && Number.isInteger(w.row) && Number.isInteger(w.col) && finite(w.heat) && Number.isInteger(w.iceHits) && finite(w.melt)).map(w => ({ row:w.row, col:w.col, heat:Math.max(0,Math.min(5,w.heat)), iceHits:Math.max(0,Math.min(12,w.iceHits)), iced:w.iced===true, melt:Math.max(0,Math.min(5,w.melt)) })) : [],
        beams: Array.isArray(state.beams) ? state.beams.filter(b => b && Number.isSafeInteger(b.id) && typeof b.ownerId === "string" && [b.x,b.y,b.aim,b.length,b.width,b.expiresAt].every(finite)).map(b => ({ id:b.id, ownerId:b.ownerId, x:b.x, y:b.y, aim:b.aim, length:b.length, width:b.width, expiresAt:b.expiresAt })) : [],
        players,
        projectiles: Array.isArray(state.projectiles) ? state.projectiles.filter(p =>
          p && typeof p.id === "number" && typeof p.ownerId === "string" &&
          finite(p.x) && finite(p.y) && finite(p.angle) && typeof p.super === "boolean"
        ).map(p => ({ id:p.id, ownerId:p.ownerId, x:p.x, y:p.y, angle:p.angle, super:p.super, iceBall:p.iceBall===true, fireBall:p.fireBall===true, activateAt:finite(p.activateAt)?p.activateAt:0, damage:finite(p.damage)?Math.max(0,p.damage):0 })) : []
      }
    };
  }
  if (packet.type === "event") {
    if (typeof packet.event !== "string") return null;
    return {
      kind: "event",
      room: text(packet.room),
      tick: finite(packet.tick) ? packet.tick : 0,
      name: EVENT_KINDS[packet.event] || "unknown",
      sourceName: packet.event,
      data: Object.fromEntries(Object.entries(packet).filter(([key]) =>
        !["type", "room", "tick", "serverTime", "event"].includes(key)
      ))
    };
  }
  if (packet.type === "ack" || packet.type === "pong") {
    return {
      kind: packet.type,
      seq: Number.isSafeInteger(packet.seq) ? packet.seq : null,
      clientSentAt: finite(packet.clientSentAt) ? packet.clientSentAt : null,
      serverTime: finite(packet.serverTime) ? packet.serverTime : null
    };
  }
  if (packet.type === "error") return { kind: "error", message: text(packet.message).slice(0, 120) };
  return null;
}
