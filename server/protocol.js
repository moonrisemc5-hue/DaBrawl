export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
export function cleanText(value, max = 28) {
  return String(value ?? "").replace(/[<>\\u0000-\\u001f\\u007f]/g, "").trim().slice(0, max) || "Player";
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
