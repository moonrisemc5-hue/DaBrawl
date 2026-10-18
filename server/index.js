import http from "node:http";
import { URL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, WebSocket } from "ws";
import { clamp, finite, cleanText, validAxes, validRoomCode, validMode, parseClientMessage } from "./protocol.js";

const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const TICK_MS = 50;
const ROOM_TTL_MS = 120_000;
const MAX_PLAYERS = 6;
const MAX_ROOMS = 1000;
const WORLD = { width: 800, height: 520, margin: 28 };
const BRAWLERS = {
  kuku: { hp: 3000, speed: 205, damage: 260, range: 230, cooldown: 380, spread: 0.68, pellets: 8, superDamage: 650, superRange: 340 },
  saiyan: { hp: 3600, speed: 220, damage: 240, range: 300, cooldown: 420, spread: 0.12, pellets: 1, superDamage: 700, superRange: 400 },
  default: { hp: 3200, speed: 210, damage: 220, range: 280, cooldown: 400, spread: 0.18, pellets: 1, superDamage: 600, superRange: 360 },
};
const auth = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const rooms = new Map();
let nextProjectileId = 1;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const cleanText = (s, max = 28) => String(s ?? "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, max) || "Player";
const now = () => Date.now();

function makeRoom(code, mode = "knockout") {
  return { code, mode: validMode(mode),
    phase: "waiting", createdAt: now(), updatedAt: now(), startedAt: 0, endsAt: 0, tick: 0,
    players: new Map(), projectiles: [], events: [], winner: null };
}
function makePlayer(user, msg, slot) {
  const brawler = BRAWLERS[msg.brawler] ? msg.brawler : "default";
  return { id: user.id, name: cleanText(msg.name), brawler, team: slot % 2, slot,
    x: slot % 2 ? 620 : 180, y: 150 + Math.floor(slot / 2) * 70, aim: slot % 2 ? Math.PI : 0,
    hp: BRAWLERS[brawler].hp, maxHp: BRAWLERS[brawler].hp, alive: true, meter: 0,
    form: 0, transformUntil: 0, input: { x: 0, y: 0 }, seq: -1, lastFire: 0, lastSuper: 0,
    connected: true, socket: null, lastSeen: now(), invulnerableUntil: 0 };
}
function emit(room, type, data = {}) {
  const packet = JSON.stringify({ type, room: room.code, tick: room.tick, serverTime: now(), ...data });
  for (const p of room.players.values()) if (p.socket?.readyState === WebSocket.OPEN) p.socket.send(packet);
}
function snapshot(room) {
  return { mode: room.mode, phase: room.phase, startedAt: room.startedAt, endsAt: room.endsAt,
    winner: room.winner, tick: room.tick, players: [...room.players.values()].map(p => ({
      id:p.id,name:p.name,brawler:p.brawler,team:p.team,slot:p.slot,x:p.x,y:p.y,aim:p.aim,
      hp:p.hp,maxHp:p.maxHp,alive:p.alive,meter:p.meter,form:p.form,
      transforming:p.transformUntil>now(),connected:p.connected
    })), projectiles: room.projectiles.map(b => ({ id:b.id,ownerId:b.ownerId,x:b.x,y:b.y,angle:b.angle,super:b.super })) };
}
function sendState(room) { emit(room, "state", { state: snapshot(room) }); }
function event(room, name, data = {}) { room.events.push({ name, at: now(), ...data }); if (room.events.length > 80) room.events.shift(); emit(room, "event", { event: name, ...data }); }

function startMatch(room) {
  if (room.phase !== "waiting" || room.players.size < 2) return;
  room.phase = "countdown"; room.startedAt = now() + 2500; room.endsAt = room.startedAt + 180_000;
  event(room, "match-countdown", { startAt: room.startedAt });
}
function joinRoom(room, user, msg, socket) {
  let player = room.players.get(user.id);
  if (!player) {
    if (room.players.size >= MAX_PLAYERS) throw new Error("Room is full");
    if (room.phase !== "waiting") throw new Error("Match already started");
    player = makePlayer(user, msg, room.players.size);
    room.players.set(user.id, player);
  }
  player.name = cleanText(msg.name || player.name);
  if (BRAWLERS[msg.brawler]) player.brawler = msg.brawler;
  player.socket = socket; player.connected = true; player.lastSeen = now(); room.updatedAt = now();
  return player;
}
function doFire(room, p, isSuper = false) {
  const stats = BRAWLERS[p.brawler] || BRAWLERS.default;
  const t = now();
  if (!p.alive || p.transformUntil > t) return;
  if (isSuper) {
    if (p.meter < 100 || t - p.lastSuper < 1200) return;
    p.meter = 0; p.lastSuper = t;
  } else if (t - p.lastFire < stats.cooldown) return;
  else p.lastFire = t;
  const count = isSuper ? 1 : stats.pellets;
  for (let i = 0; i < count; i++) {
    const spread = isSuper ? 0 : stats.spread;
    const angle = p.aim + (count === 1 ? 0 : (i / (count - 1) - .5) * spread) + (Math.random() - .5) * .035;
    room.projectiles.push({ id: nextProjectileId++, ownerId: p.id, team: p.team,
      x: p.x + Math.cos(angle) * 18, y: p.y + Math.sin(angle) * 18, angle,
      speed: isSuper ? 560 : 470, damage: isSuper ? stats.superDamage : stats.damage,
      range: isSuper ? stats.superRange : stats.range, traveled: 0, super: isSuper });
  }
  p.meter = clamp(p.meter + (isSuper ? 0 : 8), 0, 100);
  event(room, isSuper ? "super-fired" : "attack-fired", { playerId:p.id, aim:p.aim });
}
function stepRoom(room, dt) {
  const t = now(); room.tick++; room.updatedAt = t;
  if (room.phase === "countdown" && t >= room.startedAt) { room.phase = "playing"; event(room, "match-started"); }
  if (room.phase === "playing") {
    for (const p of room.players.values()) {
      if (!p.connected || !p.alive) continue;
      const stats = BRAWLERS[p.brawler] || BRAWLERS.default;
      const x = p.input.x, y = p.input.y, mag = Math.hypot(x,y) || 1;
      p.x = clamp(p.x + x / mag * stats.speed * dt, WORLD.margin, WORLD.width-WORLD.margin);
      p.y = clamp(p.y + y / mag * stats.speed * dt, WORLD.margin, WORLD.height-WORLD.margin);
      if (p.transformUntil && t >= p.transformUntil) p.transformUntil = 0;
    }
    const survivors = [...room.players.values()].filter(p => p.alive);
    if (room.mode !== "showdown" && survivors.length && new Set(survivors.map(p => p.team)).size <= 1) {
      room.phase = "ended"; room.winner = survivors[0]?.team ?? null; event(room, "match-ended", { winner: room.winner });
    } else if (t >= room.endsAt) {
      room.phase = "ended"; const scores = new Map(); for (const p of survivors) scores.set(p.team,(scores.get(p.team)||0)+p.hp);
      room.winner = [...scores].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? null; event(room, "match-ended", { winner: room.winner, reason:"timer" });
    }
  }
  const keep = [];
  for (const b of room.projectiles) {
    const dx = Math.cos(b.angle) * b.speed * dt, dy = Math.sin(b.angle) * b.speed * dt;
    b.x += dx; b.y += dy; b.traveled += Math.hypot(dx,dy);
    let hit = null;
    for (const target of room.players.values()) {
      if (!target.alive || target.id === b.ownerId || target.team === b.team || target.invulnerableUntil > t) continue;
      if (Math.hypot(target.x-b.x,target.y-b.y) <= 19) { hit = target; break; }
    }
    if (hit) {
      hit.hp = Math.max(0, hit.hp-b.damage); hit.meter = clamp(hit.meter+12,0,100);
      const owner = room.players.get(b.ownerId); if (owner) owner.meter = clamp(owner.meter+18,0,100);
      event(room, "hit", { projectileId:b.id, attackerId:b.ownerId, targetId:hit.id, damage:b.damage, hp:hit.hp });
      if (hit.hp <= 0) { hit.alive=false; hit.input={x:0,y:0}; event(room,"knockout",{playerId:hit.id,by:b.ownerId}); }
    } else if (b.traveled < b.range && b.x >= 0 && b.x <= WORLD.width && b.y >= 0 && b.y <= WORLD.height) keep.push(b);
  }
  room.projectiles = keep;
  if (room.phase === "ended") room.projectiles = [];
}
function cleanupRoom(room) {
  for (const [id,p] of room.players) {
    if (p.connected || now()-p.lastSeen < ROOM_TTL_MS) continue;
    room.players.delete(id);
  }
  if (!room.players.size && now()-room.updatedAt > ROOM_TTL_MS) rooms.delete(room.code);
}
const server = http.createServer((req,res) => {
  const path = new URL(req.url || "/", "http://localhost").pathname;
  if (path === "/health") { res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"}); res.end(JSON.stringify({ok:true,service:"dabrawl-authoritative-server",uptimeSeconds:Math.floor(process.uptime()),rooms:rooms.size})); return; }
  res.writeHead(404,{"content-type":"application/json"}); res.end(JSON.stringify({error:"not found"}));
});
const wss = new WebSocketServer({ noServer:true, maxPayload:4096, perMessageDeflate:false });
server.on("upgrade", async (req,socket,head) => {
  try {
    const u = new URL(req.url || "/", "http://localhost");
    if (u.pathname !== "/match" || !auth) { socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const protocols = String(req.headers["sec-websocket-protocol"] || "").split(",").map(x=>x.trim());
    const tokenProto = protocols.find(x=>x.startsWith("jwt-"));
    const token = tokenProto?.slice(4);
    if (!token || token.length > 8192 || !protocols.includes("dabrawl-v1")) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const {data,error} = await auth.auth.getUser(token);
    if (error || !data.user) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const roomCode = (u.searchParams.get("room") || "").trim().slice(0,64);
    if (!validRoomCode(roomCode)) { socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req,socket,head,ws => {
      wss.emit("connection",ws,req,{user:data.user,roomCode});
    });
  } catch { socket.destroy(); }
});
wss.on("connection", (ws,_req,meta) => {
  let room=rooms.get(meta.roomCode);
  if (!room) { if (rooms.size >= MAX_ROOMS) { ws.close(1013,"Server is at room capacity"); return; } room=makeRoom(meta.roomCode); rooms.set(meta.roomCode,room); }
  let player;
  try { player=joinRoom(room,meta.user,{name:meta.user.user_metadata?.username || meta.user.email?.split("@")[0] || "Player"},ws); }
  catch(err) { ws.close(1008,String(err.message||"Cannot join room").slice(0,120)); return; }
  let messageWindowStart=now(), messageCount=0;
  ws.on("message", raw => {
    const receivedAt=now();
    if (receivedAt-messageWindowStart>=1000) { messageWindowStart=receivedAt; messageCount=0; }
    if (++messageCount>120) { ws.close(1008,"Message rate limit exceeded"); return; }
    try {
      const m=parseClientMessage(raw.toString());
      if (m.type==="join") {
        if (room.phase!=="waiting" && room.players.size<MAX_PLAYERS) throw new Error("Match already started");
        player.name=cleanText(m.name || player.name);
        if (room.phase==="waiting" && BRAWLERS[m.brawler]) {
          player.brawler=m.brawler;
          player.maxHp=BRAWLERS[player.brawler].hp;
          player.hp=player.maxHp;
        }
        if (room.phase==="waiting") room.mode=validMode(m.mode);
        if (m.ready===true) startMatch(room);
        emit(room,"player-joined",{playerId:player.id}); sendState(room);
      } else if (m.type==="ready") { if (m.ready===true) startMatch(room); sendState(room); }
      else if (m.type==="input") {
        const seq=Math.floor(finite(m.seq,-1)); if (seq<=player.seq) return;
        player.seq=seq; player.input=validAxes(m.x,m.y); player.aim=clamp(finite(m.aim,player.aim),-Math.PI*2,Math.PI*2);
        player.lastSeen=now(); ws.send(JSON.stringify({type:"ack",seq,serverTime:now()}));
      } else if (m.type==="action") {
        if (m.action==="fire") doFire(room,player,false);
        else if (m.action==="super") doFire(room,player,true);
        else if (m.action==="transform") {
          if (player.alive && player.meter>=50 && player.transformUntil<=now()) {
            player.meter-=50; player.form=clamp(Math.floor(finite(m.form,player.form+1)),1,5); player.transformUntil=now()+1800;
            event(room,"transform",{playerId:player.id,form:player.form});
          }
        } else if (m.action==="gadget") {
          if (player.alive) { const a=player.aim; player.x=clamp(player.x+Math.cos(a)*70,WORLD.margin,WORLD.width-WORLD.margin); player.y=clamp(player.y+Math.sin(a)*70,WORLD.margin,WORLD.height-WORLD.margin); event(room,"gadget",{playerId:player.id}); }
        } else if (m.action==="ping") ws.send(JSON.stringify({type:"pong",clientSentAt:finite(m.clientSentAt),serverTime:now()}));
        else throw new Error("Unsupported action");
      } else if (m.type==="ping") ws.send(JSON.stringify({type:"pong",clientSentAt:finite(m.clientSentAt),serverTime:now()}));
      else throw new Error("Unsupported message type");
    } catch(err) { ws.send(JSON.stringify({type:"error",message:String(err.message||"Invalid message").slice(0,120)})); }
  });
  ws.on("close",()=>{ if (player.socket !== ws) return; player.connected=false; player.input={x:0,y:0}; player.socket=null; player.lastSeen=now(); room.updatedAt=now(); event(room,"player-disconnected",{playerId:player.id}); });
  ws.on("error",()=>{ if (player.socket !== ws) return; player.connected=false; player.input={x:0,y:0}; player.socket=null; player.lastSeen=now(); });
  emit(room,"player-joined",{playerId:player.id}); sendState(room);
});
let lastTickAt=now();
const ticker=setInterval(()=> {
  const tickAt=now(); const dt=Math.min(.1,Math.max(0,(tickAt-lastTickAt)/1000)); lastTickAt=tickAt;
  for (const room of rooms.values()) { stepRoom(room,dt||TICK_MS/1000); sendState(room); cleanupRoom(room); }
},TICK_MS);
server.listen(PORT,"0.0.0.0",()=>console.log("DaBrawl authoritative server listening on",PORT));
process.on("SIGTERM",()=>{clearInterval(ticker);for(const ws of wss.clients)ws.close(1012,"Server restarting");server.close(()=>process.exit(0));});
process.on("SIGINT",()=>{clearInterval(ticker);for(const ws of wss.clients)ws.close(1012,"Server restarting");server.close(()=>process.exit(0));});
