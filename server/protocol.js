export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
export function cleanText(value, max = 28) {
  return Array.from(String(value ?? "")).filter(ch => { const code = ch.charCodeAt(0); return ch !== "<" && ch !== ">" && code >= 32 && code !== 127; }).join("").trim().slice(0, max) || "Player";
}
export function validAxes(x, y) {
  x = finite(x, Number.NaN); y = finite(y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1 || Math.abs(y) > 1) throw new Error("Invalid movement axes");
  const magnitude = Math.hypot(x, y);
  return magnitude > 1 ? { x: x / magnitude, y: y / magnitude } : { x, y };
}
export const validRoomCode = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
export const validMode = value => ["knockout", "duel", "showdown"].includes(value) ? value : "knockout";
export function parseClientMessage(raw) {
  let message;
  try { message = JSON.parse(String(raw)); } catch { throw new Error("Invalid JSON message"); }
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.type !== "string") throw new Error("Invalid message");

  const optionalString = (key, max) => {
    if (message[key] !== undefined && (typeof message[key] !== "string" || message[key].length > max)) {
      throw new Error(`Invalid ${key}`);
    }
  };
  switch (message.type) {
    case "join":
      optionalString("name", 80);
      optionalString("brawler", 32);
      optionalString("mode", 32);
      if (message.ready !== undefined && typeof message.ready !== "boolean") throw new Error("Invalid ready flag");
      break;
    case "ready":
      if (typeof message.ready !== "boolean") throw new Error("Invalid ready flag");
      break;
    case "input":
      if (!Number.isSafeInteger(message.seq) || message.seq < 0) throw new Error("Invalid input sequence");
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) throw new Error("Invalid movement axes");
      if (message.aim !== undefined && !Number.isFinite(message.aim)) throw new Error("Invalid aim");
      break;
    case "action":
      if (!["fire", "super", "transform", "gadget", "ping"].includes(message.action)) throw new Error("Unsupported action");
      if (message.form !== undefined && !Number.isFinite(message.form)) throw new Error("Invalid form");
      if (message.clientSentAt !== undefined && !Number.isFinite(message.clientSentAt)) throw new Error("Invalid ping timestamp");
      break;
    case "ping":
      if (message.clientSentAt !== undefined && !Number.isFinite(message.clientSentAt)) throw new Error("Invalid ping timestamp");
      break;
    default:
      throw new Error("Unsupported message type");
  }
  return message;
}

export const isCombatPhase = phase => phase === "playing";

export function assignTeams(playerCount, mode) {
  const count = Math.max(0, Math.floor(finite(playerCount, 0)));
  const valid = validMode(mode);
  if (valid === "showdown") return Array.from({ length: count }, (_, index) => index);
  if (valid === "duel") return Array.from({ length: count }, (_, index) => index % 2);
  const split = Math.ceil(count / 2);
  return Array.from({ length: count }, (_, index) => index < split ? 0 : 1);
}

export const canConfigureRoom = (actorId, ownerId, phase) => phase === "waiting" && Boolean(actorId) && actorId === ownerId;
