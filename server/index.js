import http from "node:http";
import { URL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, WebSocket } from "ws";
import { clamp, finite, cleanText, validAxes, validRoomCode, validMode, parseClientMessage, isCombatPhase, assignTeams, canConfigureRoom, shouldCloseForProtocolViolations } from "./protocol.js";

const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const TICK_MS = 50;
const INPUT_TIMEOUT_MS = 250;
const ROOM_TTL_MS = 120_000;
const MAX_PLAYERS = 6;
const MAX_ROOMS = 100;
const WORLD = { width: 800, height: 520, margin: 28 };
import { BRAWLERS, getBrawlerStats, getNextSaiyanForm } from "./brawlers.js";
import { advanceProjectile, findProjectileHit, projectileStillInRange } from "./combat.js";
import { gadgetCharges, tryConsumeGadget } from "./abilities.js";
import { clampPlayerPosition, PLAYER_RADIUS } from "./world.js";
const auth = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const rooms = new Map();
let nextProjectileId = 1;

const now = () => Date.now();

function makeRoom(code, mode = "knockout") {
  return { code, mode: validMode(mode),
    phase: "waiting", createdAt: now(), updatedAt: now(), emptySince: 0, startedAt: 0, endsAt: 0, tick: 0,
    players: new Map(), projectiles: [], events: [], winner: null };
}
function makePlayer(user, msg, slot) {
  const brawler = BRAWLERS[msg.brawler] ? msg.brawler : "default";
  return { id: user.id, name: cleanText(msg.name), brawler, team: slot % 2, slot,
    x: slot % 2 ? 620 : 180, y: 150 + Math.floor(slot / 2) * 70, aim: slot % 2 ? Math.PI : 0,
    hp: BRAWLERS[brawler].hp, maxHp: BRAWLERS[brawler].hp, alive: true, meter: 0,
    form: 0, transformUntil: 0, gadgetReadyAt: 0, input: { x: 0, y: 0 }, seq: -1, lastFire: 0, lastSuper: 0,
    connected: true, socket: null, lastSeen: now(), invulnerableUntil: 0, ready: false };
}
function emit(room, type, data = {}) {
  const packet = JSON.stringify({ type, room: room.code, tick: room.tick, serverTime: now(), ...data });
  for (const p of room.players.values()) if (p.socket?.readyState === WebSocket.OPEN) p.socket.send(packet);
}
function snapshot(room) {
  return { mode: room.mode, phase: room.phase, startedAt: room.startedAt, endsAt: room.endsAt,
    winner: room.winner, ownerId: room.ownerId, tick: room.tick, players: [...room.players.values()].map(p => ({
      id:p.id,name:p.name,brawler:p.brawler,team:p.team,slot:p.slot,x:p.x,y:p.y,aim:p.aim,
      hp:p.hp,maxHp:p.maxHp,alive:p.alive,meter:p.meter,form:p.form,
      gadgetCharges:gadgetCharges(p),gadgetCooldownMs:Math.max(0,p.gadgetReadyAt-now()),
      transforming:p.transformUntil>now(),connected:p.connected,ready:p.ready
    })), projectiles: room.projectiles.map(b => ({ id:b.id,ownerId:b.ownerId,x:b.x,y:b.y,angle:b.angle,super:b.super })) };
}
function sendState(room) { emit(room, "state", { state: snapshot(room) }); }
function event(room, name, data = {}) { room.events.push({ name, at: now(), ...data }); if (room.events.length > 80) room.events.shift(); emit(room, "event", { event: name, ...data }); }

function cancelCountdown(room, reason) {
  if (room.phase !== "countdown") return;
  room.phase = "waiting";
  room.startedAt = 0;
  room.endsAt = 0;
  for (const p of room.players.values()) p.ready = false;
  event(room, "match-countdown-cancelled", { reason });
}
function startMatch(room) {
  if (room.phase !== "waiting" || room.players.size < 2 || ![...room.players.values()].every(p => p.connected && p.ready)) return;
  const roster = [...room.players.values()].sort((a, b) => a.slot - b.slot);
  assignTeams(roster.length, room.mode).forEach((team, index) => { roster[index].team = team; });
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
  if (player.socket && player.socket !== socket) player.socket.close(4001, "Reconnected from another session");
  player.name = cleanText(msg.name || player.name);
  if (BRAWLERS[msg.brawler]) player.brawler = msg.brawler;
  room.emptySince = 0;
  player.socket = socket; player.connected = true; player.lastSeen = now(); room.updatedAt = now();
  return player;
}
function doFire(room, p, isSuper = false) {
  if (!isCombatPhase(room.phase)) return;
  const stats = getBrawlerStats(p);
  const t = now();
  if (!p.alive || p.transformUntil > t) return;
  // A max-form Saiyan has no next transformation; reject before consuming super meter.
  if (isSuper && stats.superKind === "transform" && getNextSaiyanForm(p) === null) return;
  if (isSuper) {
    if (p.meter < 100 || t - p.lastSuper < 1200) return;
    p.meter = 0; p.lastSuper = t;
  } else if (t - p.lastFire < stats.cooldown) return;
  else p.lastFire = t;
  if (isSuper && stats.superKind === "transform") {
    const nextForm = getNextSaiyanForm(p);
    if (nextForm === null) return;
    const nextStats = BRAWLERS.saiyan.forms[nextForm];
    const healthDelta = nextStats.hp - p.maxHp;
    p.maxHp = nextStats.hp;
    p.hp = clamp(p.hp + healthDelta, 0, p.maxHp);
    p.form = nextForm;
    p.transformUntil = t + 1800;
    event(room, "transform", { playerId:p.id, form:p.form });
    sendState(room);
    return;
  }
  if (isSuper && stats.superKind === "slam") {
    let hits = 0;
    for (const target of room.players.values()) {
      if (!target.alive || target.team === p.team || target.id === p.id) continue;
      if (Math.hypot(target.x-p.x,target.y-p.y) > stats.superRange) continue;
      target.hp = Math.max(0, target.hp-stats.superDamage);
      target.meter = clamp(target.meter+12,0,100);
      hits++;
      event(room,"hit",{attackerId:p.id,targetId:target.id,damage:stats.superDamage,hp:target.hp,super:true});
      if (target.hp<=0) { target.alive=false; target.input={x:0,y:0}; event(room,"knockout",{playerId:target.id,by:p.id}); }
    }
    event(room,"super-slam",{playerId:p.id,hits});
    return;
  }
  const count = isSuper ? 1 : stats.pellets;
  for (let i = 0; i < count; i++) {
    const spread = isSuper ? 0 : stats.spread;
    const angle = p.aim + (count === 1 ? 0 : (i / (count - 1) - .5) * spread) + (Math.random() - .5) * .035;
    room.projectiles.push({ id: nextProjectileId++, ownerId: p.id, team: p.team,
      x: p.x + Math.cos(angle) * 18, y: p.y + Math.sin(angle) * 18, angle,
      speed: isSuper ? Math.max(560,stats.bulletSpeed) : stats.bulletSpeed, damage: isSuper ? stats.superDamage : stats.damage,
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
      if (t - p.lastSeen > INPUT_TIMEOUT_MS) p.input = { x: 0, y: 0 };
      const stats = getBrawlerStats(p);
      const x = p.input.x, y = p.input.y, mag = Math.hypot(x,y) || 1;
      const nextPosition = clampPlayerPosition(p.x + x / mag * stats.speed * dt, p.y + y / mag * stats.speed * dt, WORLD, PLAYER_RADIUS);
      p.x = nextPosition.x;
      p.y = nextPosition.y;
      if (p.transformUntil && t >= p.transformUntil) p.transformUntil = 0;
    }
    const survivors = [...room.players.values()].filter(p => p.alive);
    const survivingTeams = new Set(survivors.map(p => p.team));
    if (survivors.length === 0) {
      room.phase = "ended"; room.winner = null; event(room, "match-ended", { winner: null, reason: "draw" });
    } else if (survivingTeams.size === 1) {
      room.phase = "ended"; room.winner = survivors[0].team; event(room, "match-ended", { winner: room.winner, reason: "elimination" });
    } else if (t >= room.endsAt) {
      room.phase = "ended"; const scores = new Map(); for (const p of survivors) scores.set(p.team,(scores.get(p.team)||0)+p.hp);
      room.winner = [...scores].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? null; event(room, "match-ended", { winner: room.winner, reason:"timer" });
    }
  }
  if (!isCombatPhase(room.phase)) room.projectiles = [];
  const keep = [];
  for (const b of room.projectiles) {
    advanceProjectile(b, dt);
    const hit = findProjectileHit(b, room.players.values(), t, 19);
    if (hit) {
      hit.hp = Math.max(0, hit.hp-b.damage); hit.meter = clamp(hit.meter+12,0,100);
      const owner = room.players.get(b.ownerId); if (owner) owner.meter = clamp(owner.meter+18,0,100);
      event(room, "hit", { projectileId:b.id, attackerId:b.ownerId, targetId:hit.id, damage:b.damage, hp:hit.hp });
      if (hit.hp <= 0) { hit.alive=false; hit.input={x:0,y:0}; event(room,"knockout",{playerId:hit.id,by:b.ownerId}); }
    } else if (projectileStillInRange(b, WORLD.width, WORLD.height)) keep.push(b);
  }
  room.projectiles = keep;
  if (room.phase === "ended") room.projectiles = [];
}
function cleanupRoom(room) {
  for (const [id,p] of room.players) {
    if (p.connected || now()-p.lastSeen < ROOM_TTL_MS) continue;
    room.players.delete(id);
  }
  if (!room.players.size) {
    if (!room.emptySince) room.emptySince = now();
    if (now() - room.emptySince > ROOM_TTL_MS) rooms.delete(room.code);
  } else {
    room.emptySince = 0;
  }
}
const server = http.createServer((req,res) => {
  const path = new URL(req.url || "/", "http://localhost").pathname;
  if (path === "/health") { res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"}); res.end(JSON.stringify({ok:true,service:"dabrawl-authoritative-server",uptimeSeconds:Math.floor(process.uptime()),rooms:rooms.size})); return; }
  res.writeHead(404,{"content-type":"application/json"}); res.end(JSON.stringify({error:"not found"}));
});
const wss = new WebSocketServer({ noServer:true, maxPayload:4096, perMessageDeflate:false, handleProtocols: protocols => protocols.has("dabrawl-v1") ? "dabrawl-v1" : false });
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
  if (!room) { if (rooms.size >= MAX_ROOMS) { ws.close(1013,"Server is at room capacity"); return; } room=makeRoom(meta.roomCode); room.ownerId=meta.user.id; rooms.set(meta.roomCode,room); }
  let player;
  try { player=joinRoom(room,meta.user,{name:meta.user.user_metadata?.username || meta.user.email?.split("@")[0] || "Player"},ws); }
  catch(err) { ws.close(1008,String(err.message||"Cannot join room").slice(0,120)); return; }
  let messageWindowStart=now(), messageCount=0, protocolViolations=0;
  ws.on("message", raw => {
    const receivedAt=now();
    if (receivedAt-messageWindowStart>=1000) { messageWindowStart=receivedAt; messageCount=0; }
    if (++messageCount>120) { ws.close(1008,"Message rate limit exceeded"); return; }
    try {
      const m=parseClientMessage(raw.toString());
      if (m.type==="join") {
        player.name=cleanText(m.name || player.name);
        if (room.phase==="waiting" && BRAWLERS[m.brawler]) {
          player.brawler=m.brawler;
          player.maxHp=BRAWLERS[player.brawler].hp;
          player.hp=player.maxHp;
        }
        if (canConfigureRoom(player.id, room.ownerId, room.phase) && m.mode !== undefined) room.mode=validMode(m.mode);
        if (typeof m.ready === "boolean") player.ready=m.ready;
        if (m.ready===true) startMatch(room);
        emit(room,"player-joined",{playerId:player.id}); sendState(room);
      } else if (m.type==="ready") { player.ready=m.ready===true; if (player.ready) startMatch(room); sendState(room); }
      else if (m.type==="input") {
        const seq=Math.floor(finite(m.seq,-1)); if (seq<=player.seq) return;
        player.seq=seq; player.input=validAxes(m.x,m.y); player.aim=clamp(finite(m.aim,player.aim),-Math.PI*2,Math.PI*2);
        player.lastSeen=now(); ws.send(JSON.stringify({type:"ack",seq,serverTime:now()}));
      } else if (m.type==="action") {
        if (m.action==="fire") doFire(room,player,false);
        else if (m.action==="super") doFire(room,player,true);
        else if (m.action==="transform") {
          const nextForm = getNextSaiyanForm(player);
          if (isCombatPhase(room.phase) && player.alive && player.meter>=50 && player.transformUntil<=now() && nextForm !== null) {
            player.meter-=50;
            const nextStats=BRAWLERS.saiyan.forms[nextForm];
            const healthDelta=nextStats.hp-player.maxHp;
            player.maxHp=nextStats.hp;
            player.hp=clamp(player.hp+healthDelta,0,player.maxHp);
            player.form=nextForm;
            player.transformUntil=now()+1800;
            event(room,"transform",{playerId:player.id,form:player.form});
          }
        } else if (m.action==="gadget") {
          const at=now();
          if (isCombatPhase(room.phase) && player.alive && player.transformUntil<=at && tryConsumeGadget(player,at)) {
            const a=player.aim;
            const dashPosition=clampPlayerPosition(player.x+Math.cos(a)*70,player.y+Math.sin(a)*70,WORLD,PLAYER_RADIUS);
            player.x=dashPosition.x; player.y=dashPosition.y;
            event(room,"gadget",{playerId:player.id,cooldownMs:Math.max(0,player.gadgetReadyAt-at),charges:gadgetCharges(player,at)});
            sendState(room);
          }
        } else if (m.action==="ping") ws.send(JSON.stringify({type:"pong",clientSentAt:finite(m.clientSentAt),serverTime:now()}));
        else throw new Error("Unsupported action");
      } else if (m.type==="ping") ws.send(JSON.stringify({type:"pong",clientSentAt:finite(m.clientSentAt),serverTime:now()}));
      else throw new Error("Unsupported message type");
    } catch(err) {
      protocolViolations++;
      if (shouldCloseForProtocolViolations(protocolViolations)) {
        ws.close(1008, "Too many invalid messages");
        return;
      }
      ws.send(JSON.stringify({type:"error",message:String(err.message||"Invalid message").slice(0,120)}));
    }
  });
  ws.on("close",()=>{ if (player.socket !== ws) return; player.connected=false; player.input={x:0,y:0}; player.socket=null; player.lastSeen=now(); room.updatedAt=now(); cancelCountdown(room, "player-disconnected"); event(room,"player-disconnected",{playerId:player.id}); });
  ws.on("error",()=>{ if (player.socket !== ws) return; player.connected=false; player.input={x:0,y:0}; player.socket=null; player.lastSeen=now(); cancelCountdown(room, "connection-error"); });
  emit(room,"player-joined",{playerId:player.id}); sendState(room);
});
let lastTickAt=now();
const ticker=setInterval(()=> {
  const tickAt=now(); const dt=Math.min(.1,Math.max(0,(tickAt-lastTickAt)/1000)); lastTickAt=tickAt;
  for (const room of rooms.values()) { stepRoom(room,dt||TICK_MS/1000); sendState(room); cleanupRoom(room); }
},TICK_MS);
server.listen(PORT,"0.0.0.0",()=>console.log(`DaBrawl authoritative server listening on :${PORT}`));
process.on("SIGTERM",()=>{ clearInterval(ticker); for (const ws of wss.clients) ws.close(1012,"Server restarting"); server.close(()=>process.exit(0)); });
process.on("SIGINT",()=>{ clearInterval(ticker); for (const ws of wss.clients) ws.close(1012,"Server restarting"); server.close(()=>process.exit(0)); });
