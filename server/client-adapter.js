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
    team: finite(player.team) ? player.team : null,
    slot: finite(player.slot) ? player.slot : null,
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
  "knockout": "knockout",
  "transform": "transform",
  "gadget": "gadget",
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
        players,
        projectiles: Array.isArray(state.projectiles) ? state.projectiles.filter(p =>
          p && typeof p.id === "number" && typeof p.ownerId === "string" &&
          finite(p.x) && finite(p.y) && finite(p.angle) && typeof p.super === "boolean"
        ).map(p => ({ id:p.id, ownerId:p.ownerId, x:p.x, y:p.y, angle:p.angle, super:p.super })) : []
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
