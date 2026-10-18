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
