import http from "node:http";
import { URL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, WebSocket } from "ws";
import { clamp, finite, cleanText, validAxes, validRoomCode, validMode, parseClientMessage, isCombatPhase, assignTeams, canConfigureRoom, shouldCloseForProtocolViolations, shouldCancelCountdown, shouldExpireDisconnectedPlayer, shouldForfeitDisconnectedPlayer, markPlayerDisconnected, resolveRoomOwner, canStartMatch, nextAvailableSlot } from "./protocol.js";

const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
// Run authoritative simulation at ~60 Hz for smoother movement and combat.
const TICK_MS = 1000 / 60;
const INPUT_TIMEOUT_MS = 250;
const ROOM_TTL_MS = 120_000;
const DISCONNECT_GRACE_MS = 10_000;
const MAX_PLAYERS = 6;
const MAX_ROOMS = 100;

import { BRAWLERS, getBrawlerStats, getNextSaiyanForm } from "./brawlers.js";
import { advanceProjectile, findProjectileContact, findProjectileObstacleHit, projectileStillInRange, isTargetDamageable, advanceRamuFireEnergy, consumeRamuModeSuper } from "./combat.js";
import { gadgetCharges, tryConsumeGadget, startRamuDiveCooldown } from "./abilities.js";
import { beginKameCharge, finishKameCharge, cancelKameCharge, kameChargePower } from "./charge.js";
import { movementDelta, movePlayerWithObstacles, resolvePlayerCollisions, clampPlayerPosition, PLAYER_RADIUS } from "./world.js";
import { selectWinnerByHealth } from "./match-results.js";
import { decideBotAction } from "./bot-ai.js";
import { createArena, applyRoomMode, removeArenaWall, registerArenaIceWallHit, advanceArenaWallFire, coolArenaWallStates, snapshotArenaWallStates, findArenaWallAlongRay, traceKameBeam, traceMasteredBeam } from "./maps.js";
const auth = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const rooms = new Map();
let nextProjectileId = 1;

const now = () => Date.now();

function makeRoom(code, mode = "knockout") {
  const normalizedMode = validMode(mode);
  return { code, mode: normalizedMode, world: createArena(normalizedMode),
    phase: "waiting", createdAt: now(), updatedAt: now(), emptySince: 0, startedAt: 0, endsAt: 0, tick: 0,
    players: new Map(), projectiles: [], splashZones: [], beams: [], events: [], winner: null };
}
function makePlayer(user, msg, slot) {
  const brawler = BRAWLERS[msg.brawler] ? msg.brawler : "default";
  return { id: user.id, name: cleanText(msg.name), brawler, team: slot % 2, slot,
    x: slot % 2 ? 620 : 180, y: 150 + Math.floor(slot / 2) * 70, aim: slot % 2 ? Math.PI : 0,
    hackerDroneX:(slot % 2 ? 620 : 180)+44,hackerDroneY:126,hackerDroneControl:false,hackerUpgrades:0,
    hp: BRAWLERS[brawler].hp, maxHp: BRAWLERS[brawler].hp, alive: true, meter: 0,
    form: 0, ramuMode: "ice", fireEnergy: 1, fireLockUntil: 0, ramuFlameHeld: false, ramuFlameStartedAt: 0, ramuFlameLength: 0, ramuFlameNextHitAt: 0, ramuDiveUntil: 0, ramuDiveMoveAt: 0, ramuShieldUntil: 0, freezeMeter: 0, frozenUntil: 0,
    burnUntil: 0, burnNextAt: 0, burnOwnerId: null, smokeUntil: 0,
    transformUntil: 0, gadgetReadyAt: 0, input: { x: 0, y: 0 }, seq: -1, lastFire: 0, lastSuper: 0, kameReadyAt: 0, kameChargeStartedAt: 0,
    connected: true, socket: null, lastSeen: now(), disconnectedAt: 0, invulnerableUntil: 0, ready: false, isBot: Boolean(user.isBot), botThinkAt: 0 };
}
function emit(room, type, data = {}) {
  const packet = JSON.stringify({ type, room: room.code, tick: room.tick, serverTime: now(), ...data });
  for (const p of room.players.values()) if (p.socket?.readyState === WebSocket.OPEN) p.socket.send(packet);
}
function snapshot(room) {
  return { mode: room.mode, phase: room.phase, startedAt: room.startedAt, endsAt: room.endsAt,
    winner: room.winner, ownerId: room.ownerId, tick: room.tick, destroyedWalls: room.world.destroyedWalls, wallStates: snapshotArenaWallStates(room.world), beams: room.beams.map(b => ({ id:b.id, ownerId:b.ownerId, x:b.x, y:b.y, aim:b.aim, length:b.length, width:b.width, expiresAt:b.expiresAt })), players: [...room.players.values()].map(p => ({
      id:p.id,name:p.name,brawler:p.brawler,team:p.team,slot:p.slot,x:p.x,y:p.y,aim:p.aim,hackerDroneX:p.hackerDroneX,hackerDroneY:p.hackerDroneY,hackerDroneControl:!!p.hackerDroneControl,hackerUpgrades:p.hackerUpgrades||0,
      hp:p.hp,maxHp:p.maxHp,alive:p.alive,meter:p.meter,form:p.form,ramuMode:p.ramuMode,fireEnergy:p.fireEnergy,hackTargetId:p.hackTargetId||null,hackedById:p.hackedById||null,hackUntil:p.hackUntil||0,fireLockMs:Math.max(0,(p.fireLockUntil||0)-now()),
      ramuDiveUntil:p.ramuDiveUntil||0,ramuDiveMoveMs:Math.max(0,(p.ramuDiveMoveAt||0)-now()),ramuFlameHeld:!!p.ramuFlameHeld,ramuShieldMs:Math.max(0,(p.ramuShieldUntil||0)-now()),freezeMeter:p.freezeMeter||0,frozenMs:Math.max(0,(p.frozenUntil||0)-now()),burnMs:Math.max(0,(p.burnUntil||0)-now()),smokeMs:Math.max(0,(p.smokeUntil||0)-now()),
      gadgetCharges:gadgetCharges(p),gadgetCooldownMs:Math.max(0,p.gadgetReadyAt-now()),
      kameCooldownMs:Math.max(0,(p.kameReadyAt||0)-now()),kameCharging:Boolean(p.kameChargeStartedAt),kameCharge:kameChargePower(p.kameChargeStartedAt,now()),muiCharging:Boolean(p.pendingMuiBeam),
      transforming:p.transformUntil>now(),connected:p.connected,ready:p.ready
    })), projectiles: room.projectiles.map(b => ({ id:b.id,ownerId:b.ownerId,x:b.x,y:b.y,angle:b.angle,super:b.super,iceBall:!!b.iceBall,fireBall:!!b.fireBall,activateAt:b.activateAt||0,beer:!!b.friendlySupport,flightTime:b.flightTime||0,flightDuration:b.flightDuration||0,arcHeight:b.arcHeight||58,range:b.range||300,damage:b.damage||0,splashRadius:b.splashRadius||0,heal:b.heal||0 })) };
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
  if (!canStartMatch(room.phase, room.players.values())) return;
  const roster = [...room.players.values()].sort((a, b) => a.slot - b.slot);
  assignTeams(roster.length, room.mode).forEach((team, index) => { roster[index].team = team; });
  room.phase = "countdown"; room.startedAt = now() + 2500; room.endsAt = room.startedAt + 180_000;
  event(room, "match-countdown", { startAt: room.startedAt });
}
function updateReady(room, player, ready) {
  player.ready = ready === true;
  if (shouldCancelCountdown(room.phase, player.ready)) {
    cancelCountdown(room, "player-unready");
    return;
  }
  if (player.ready) startMatch(room);
}
function joinRoom(room, user, msg, socket) {
  let player = room.players.get(user.id);
  if (!player) {
    if (room.players.size >= MAX_PLAYERS) throw new Error("Room is full");
    if (room.phase !== "waiting") throw new Error("Match already started");
    const slot = nextAvailableSlot(room.players.values(), MAX_PLAYERS);
    if (slot < 0) throw new Error("Room is full");
    player = makePlayer(user, msg, slot);
    room.players.set(user.id, player);
  }
  if (player.socket && player.socket !== socket) player.socket.close(4001, "Reconnected from another session");
  player.name = cleanText(msg.name || player.name);
  if (BRAWLERS[msg.brawler]) player.brawler = msg.brawler;
  room.emptySince = 0;
  player.socket = socket; player.connected = true; player.lastSeen = now(); player.disconnectedAt = 0; room.updatedAt = now();
  return player;
}
function doFire(room, p, isSuper = false, options = {}) {
  if (!isCombatPhase(room.phase)) return;
  const stats = getBrawlerStats(p);
  const t = now();
  if (!p.alive || p.transformUntil > t || p.kameChargeStartedAt > 0 || p.smokeUntil > t || p.frozenUntil > t || p.ramuDiveUntil > t || p.ramuShieldUntil > t) return;
  if(!isSuper&&p.brawler==="hacker"&&p.hackTargetId&&p.hackUntil>t){const controlled=room.players.get(p.hackTargetId);if(controlled?.alive){controlled.aim=p.aim;return doFire(room,controlled,false);}p.hackTargetId=null;p.hackUntil=0;}
  if(!isSuper&&p.brawler==="hacker"){
    if(t-p.lastFire<stats.cooldown)return;
    const target=room.players.get(options.targetId||"");if(!target||!isTargetDamageable(target,p,t)||target===p)return;
    const ox=Number.isFinite(options.droneX)?options.droneX:p.hackerDroneX,oy=Number.isFinite(options.droneY)?options.droneY:p.hackerDroneY;
    if(Math.hypot(target.x-ox,target.y-oy)>stats.range)return;
    p.lastFire=t;const level=Math.min(10,p.hackerUpgrades||0),damage=Math.max(1,Math.round((stats.damage+level*85)*(.88+Math.random()*.24))),types=["MALWARE DETECTED","RANSOMWARE","SPYWARE","CORRUPTED DATA"],malwareType=types[Math.floor(Math.random()*types.length)];p.hackerUpgrades=Math.min(10,level+1);
    target.lastHitAt=t;target.hp=Math.max(0,target.hp-damage);target.meter=clamp(target.meter+12,0,100);p.meter=clamp(p.meter+8,0,100);
    event(room,"hit",{attackerId:p.id,targetId:target.id,damage,hp:target.hp,malware:true,malwareType,upgrade:p.hackerUpgrades});
    if(target.hp<=0){target.alive=false;cancelKameCharge(target);target.input={x:0,y:0};event(room,"knockout",{playerId:target.id,by:p.id});}
    event(room,"attack-fired",{playerId:p.id,aim:p.aim,kind:"malware-install",upgrade:p.hackerUpgrades});sendState(room);return;
  }
  if(isSuper&&p.brawler==="hacker"){
    const target=room.players.get(options.targetId||"");
    if(p.meter<100||t-p.lastSuper<1200||!target||!isTargetDamageable(target,p,t)||Math.hypot(target.x-p.x,target.y-p.y)>stats.superRange)return;
    p.meter=0;p.lastSuper=t;p.hackerDroneControl=false;p.hackTargetId=target.id;p.hackUntil=t+4000;target.hackedById=p.id;target.input={x:0,y:0};
    event(room,"system-takeover-start",{playerId:p.id,targetId:target.id,durationMs:4000});sendState(room);return;
  }
  if (p.brawler === "ramu" && isSuper) {
    const wasFlaming=p.ramuFlameHeld===true,transition=consumeRamuModeSuper(p,t,1200);
    if(!transition)return;
    if(wasFlaming)event(room,"ramu-flame-stop",{playerId:p.id,aim:p.aim,fireEnergy:p.fireEnergy});
    event(room,"transform",{playerId:p.id,brawler:"ramu",mode:transition.mode,durationMs:transition.durationMs});sendState(room);return;
  }
  if (p.brawler === "ramu" && !isSuper && p.ramuMode === "fire") {
    if (p.fireEnergy <= 0 || (p.fireLockUntil||0) > t) return;
    setRamuFlameHeld(room,p,true,t);return;
  }
  if (isSuper && p.brawler === "saiyan" && stats.superKind === "transform" && getNextSaiyanForm(p) === null && !(p.form >= 5)) return;
  if (isSuper) {
    if (p.meter < 100 || t - p.lastSuper < 1200) return;
    p.meter = 0; p.lastSuper = t;
  } else {
    if (t - p.lastFire < stats.cooldown) return;
    p.lastFire = t;
  }
  if (isSuper && stats.superKind === "transform" && getNextSaiyanForm(p) !== null) {
    const nextForm = getNextSaiyanForm(p);
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
  if (isSuper && stats.superKind === "transform" && p.form >= 5) {
    p.pendingMuiBeam = { at: t + 1200, x: p.x, y: p.y, aim: p.aim };
    event(room, "mui-charging", { playerId: p.id, durationMs: 1200 });
    sendState(room);
    return;
  }
  if (isSuper && stats.superKind === "slam") {
    let hits = 0;
    for (const target of room.players.values()) {
      if (!isTargetDamageable(target, p, t)) continue;
      if (Math.hypot(target.x-p.x,target.y-p.y) > stats.superRange) continue;
      target.lastHitAt=t;target.hp = Math.max(0,target.hp-stats.superDamage);
      target.meter = clamp(target.meter+12,0,100);
      hits++;
      event(room,"hit",{attackerId:p.id,targetId:target.id,damage:stats.superDamage,hp:target.hp,super:true});
      if (target.hp<=0) { target.alive=false; cancelKameCharge(target); target.input={x:0,y:0}; event(room,"knockout",{playerId:target.id,by:p.id}); }
    }
    event(room,"super-slam",{playerId:p.id,hits});
    return;
  }
  if (p.brawler === "ramu") {
    const shotCount=stats.iceBurstShots||3,spacing=stats.iceBurstIntervalMs||170,angle=p.aim,dx=Math.cos(angle),dy=Math.sin(angle),px=-dy,py=dx;
    for(let i=0;i<shotCount;i++){
      const side=(i-(shotCount-1)/2)*7;
      room.projectiles.push({id:nextProjectileId++,ownerId:p.id,team:p.team,x:p.x+dx*23+px*side,y:p.y+dy*23+py*side,angle,
        speed:stats.bulletSpeed,damage:stats.damage,range:stats.range,traveled:0,super:false,iceBall:true,activateAt:t+i*spacing});
    }
    p.meter=clamp(p.meter+8,0,100);event(room,"attack-fired",{playerId:p.id,aim:p.aim,kind:"ice-burst",shots:shotCount,intervalMs:spacing});return;
  }
  if (p.brawler === "deges") {
    const angle = p.aim;
    room.projectiles.push({ id: nextProjectileId++, ownerId: p.id, team: p.team,
      x: p.x + Math.cos(angle) * 18, y: p.y + Math.sin(angle) * 18, angle,
      speed: isSuper ? stats.superBulletSpeed : stats.bulletSpeed, damage: isSuper ? stats.superDamage : stats.damage,
      heal: isSuper ? (stats.superHeal || 3750) : (stats.heal || 2250), friendlySupport: true, splashRadius: isSuper ? 110 : 72, superBeer: isSuper, range: isSuper ? stats.superRange : stats.range,
      flightTime: 0, flightDuration: (isSuper ? stats.superRange : stats.range) / (isSuper ? stats.superBulletSpeed : stats.bulletSpeed), arcHeight: isSuper ? 78 : 58, traveled: 0, super: isSuper });
    p.meter = clamp(p.meter + (isSuper ? 0 : 8), 0, 100);
    event(room, isSuper ? "super-fired" : "attack-fired", { playerId:p.id, aim:p.aim, kind:"beer-bottle" });
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
function setRamuFlameHeld(room,player,held,at=now()){
  if(!player||player.brawler!=="ramu"||player.ramuMode!=="fire")return false;
  const next=held===true&&player.alive&&player.fireEnergy>0&&(player.fireLockUntil||0)<=at;
  if(player.ramuFlameHeld===next)return false;
  player.ramuFlameHeld=next;
  if(next){const stats=getBrawlerStats(player);player.ramuFlameStartedAt=at;player.ramuFlameLength=0;player.ramuFlameNextHitAt=at+(stats.fireInitialReachMs||400);}
  else{player.ramuFlameStartedAt=0;player.ramuFlameNextHitAt=0;}
  event(room,next?"ramu-flame-start":"ramu-flame-stop",{playerId:player.id,aim:player.aim,fireEnergy:player.fireEnergy});
  return true;
}
function tickRamuFlame(room,player,at){
  if(!player.alive||!player.ramuFlameHeld||player.ramuMode!=="fire"||player.fireEnergy<=0||player.fireLockUntil>at||at<(player.ramuFlameNextHitAt||0))return;
  const stats=getBrawlerStats(player),dx=Math.cos(player.aim),dy=Math.sin(player.aim),sx=player.x+dx*25,sy=player.y+dy*25;
  const elapsed=Math.max(0,at-(player.ramuFlameStartedAt||at)),travel=Math.min(stats.fireRange,elapsed*(stats.fireReachSpeed||720)/1000);
  const wall=findArenaWallAlongRay(room.world,sx,sy,dx,dy,stats.fireRange),wallRange=wall?wall.distance:stats.fireRange,range=Math.min(travel,wallRange);
  player.ramuFlameLength=range;player.ramuFlameNextHitAt=at+stats.fireTickMs;
  if(range<8)return;
  for(const target of room.players.values()){
    if(!isTargetDamageable(target,player,at))continue;
    const rx=target.x-sx,ry=target.y-sy,along=rx*dx+ry*dy,side=Math.abs(-rx*dy+ry*dx),halfWidth=9+Math.min(7,Math.max(0,along)*.02);
    if(along<0||along>range||side>halfWidth+19)continue;
    target.lastHitAt=at;target.hp=Math.max(0,target.hp-stats.fireDamage);target.meter=clamp(target.meter+12,0,100);
    player.meter=clamp(player.meter+(stats.fireSuperCharge||6.6),0,100);
    event(room,"hit",{attackerId:player.id,targetId:target.id,damage:stats.fireDamage,hp:target.hp,fireStream:true,fireBall:false,burnMs:0});
    if(target.hp<=0){target.alive=false;cancelKameCharge(target);target.input={x:0,y:0};event(room,"knockout",{playerId:target.id,by:player.id});}
  }
}
function advanceRamuFlameWall(room,player,dt,at,activeWallKeys){
  if(!player.alive||!player.ramuFlameHeld||player.ramuMode!=="fire"||player.fireEnergy<=0||player.fireLockUntil>at)return;
  const stats=getBrawlerStats(player),dx=Math.cos(player.aim),dy=Math.sin(player.aim),sx=player.x+dx*25,sy=player.y+dy*25;
  const wall=findArenaWallAlongRay(room.world,sx,sy,dx,dy,stats.fireRange);
  if(!wall)return;
  const wallDistance=wall.distance;
  const elapsed=Math.max(0,at-(player.ramuFlameStartedAt||at)),travel=Math.min(stats.fireRange,elapsed*(stats.fireReachSpeed||720)/1000);
  if(travel+1<wallDistance)return;
  // A player in front of the wall absorbs the flame instead of heating terrain behind them.
  for(const other of room.players.values()){
    if(!isTargetDamageable(other,player,at))continue;
    const rx=other.x-sx,ry=other.y-sy,along=rx*dx+ry*dy,side=Math.abs(-rx*dy+ry*dx),halfWidth=10+Math.min(8,Math.max(0,along)*.02);
    if(along>0&&along<wallDistance&&side<=halfWidth+PLAYER_RADIUS)return;
  }
  const row=wall.row,col=wall.col,key=`${row}:${col}`;activeWallKeys.add(key);
  const result=advanceArenaWallFire(room.world,row,col,dt);
  if(result.type==="broken"){
    event(room,"wall-break",{playerId:player.id,row,col,heated:true});
    event(room,"wall-state",{row,col,heat:result.state.heat,iceHits:0,iced:false,melt:0,broken:true});
    return;
  }
  if(!result.changed)return;
  const state=room.world.wallStates.find(w=>w.row===row&&w.col===col),previous=state?.lastNetworkSyncAt||0;
  if(result.type==="melted"||at-previous>=200){
    if(state)state.lastNetworkSyncAt=at;
    event(room,"wall-state",{row,col,heat:result.state.heat,iceHits:result.state.iceHits,iced:result.state.iced,melt:result.state.melt,melted:result.type==="melted"});
  }
}

function startSmokeChannel(room,player,at){
  const stats=getBrawlerStats(player);player.smokeUntil=at+stats.gadgetChannelMs;player.input={x:0,y:0};
  event(room,"gadget",{playerId:player.id,kind:"smoke-heal",channelMs:stats.gadgetChannelMs,cooldownMs:Math.max(0,player.gadgetReadyAt-at),charges:gadgetCharges(player,at)});
}
function useGadget(room,player,at){
  if(!isCombatPhase(room.phase)||!player.alive||player.transformUntil>at||player.smokeUntil>at||player.frozenUntil>at||player.ramuDiveUntil>at||player.ramuShieldUntil>at||player.kameChargeStartedAt>0||!tryConsumeGadget(player,at))return false;
  const a=player.aim;
  if(player.brawler==="hacker"){player.hackerDroneControl=!player.hackerDroneControl;player.input={x:0,y:0};event(room,"gadget",{playerId:player.id,kind:"remote-link",droneControl:player.hackerDroneControl,cooldownMs:Math.max(0,player.gadgetReadyAt-at)});return true;}
  if(player.brawler==="deges"){startSmokeChannel(room,player,at);return true;}
  if(player.brawler==="ramu"){
    setRamuFlameHeld(room,player,false,at);
    if(player.ramuMode==="fire"){
      const stats=getBrawlerStats(player);player.ramuDiveUntil=at+stats.gadgetDiveMs;player.ramuDiveMoveAt=at+stats.gadgetDiveLiftMs;player.input={x:0,y:0};
      event(room,"gadget",{playerId:player.id,kind:"flame-dive",durationMs:stats.gadgetDiveMs,launchMs:stats.gadgetDiveLiftMs,moveMs:stats.gadgetDiveMs-stats.gadgetDiveLiftMs,warningMs:1000,cooldownMs:Math.max(0,player.gadgetReadyAt-at),charges:gadgetCharges(player,at)});
    }else{
      player.input={x:0,y:0};player.ramuShieldUntil=at+getBrawlerStats(player).gadgetShieldMs;
      event(room,"gadget",{playerId:player.id,kind:"crystal-shield",durationMs:getBrawlerStats(player).gadgetShieldMs,cooldownMs:Math.max(0,player.gadgetReadyAt-at),charges:gadgetCharges(player,at)});
    }
    return true;
  }
  const dashPosition=movePlayerWithObstacles(player.x,player.y,Math.cos(a)*70,Math.sin(a)*70,room.world,PLAYER_RADIUS);player.x=dashPosition.x;player.y=dashPosition.y;
  event(room,"gadget",{playerId:player.id,kind:"dash",cooldownMs:Math.max(0,player.gadgetReadyAt-at),charges:gadgetCharges(player,at)});return true;
}
function applyRamuBurn(target,ownerId,at){target.burnUntil=Math.max(target.burnUntil||0,at+2200);target.burnNextAt=Math.min(target.burnNextAt||at+500,at+500);target.burnOwnerId=ownerId||target.burnOwnerId||null;}
function landRamuDive(room,player,at){
  const fromX=player.x,fromY=player.y,fromWater=room.world.obstacles.some(o=>o.tile==="~"&&fromX>=o.x-PLAYER_RADIUS&&fromX<=o.x+o.width+PLAYER_RADIUS&&fromY>=o.y-PLAYER_RADIUS&&fromY<=o.y+o.height+PLAYER_RADIUS),[landing]=resolvePlayerCollisions([{x:fromX,y:fromY}],room.world,PLAYER_RADIUS);
  player.x=landing.x;player.y=landing.y;
  startRamuDiveCooldown(player,at,getBrawlerStats(player).gadgetDiveCooldownMs);
  const landingHop=Math.hypot(player.x-fromX,player.y-fromY)>2,waterHop=landingHop&&fromWater;
  const x=player.x,y=player.y,radius=82,destroyedWalls=[];
  for(const target of room.players.values()){
    if(!isTargetDamageable(target,player,at)||Math.hypot(target.x-x,target.y-y)>radius)continue;
    const dx=target.x-x,dy=target.y-y,d=Math.hypot(dx,dy)||1;target.lastHitAt=at;target.hp=Math.max(0,target.hp-2000);target.meter=clamp(target.meter+12,0,100);applyRamuBurn(target,player.id,at);
    const push=movePlayerWithObstacles(target.x,target.y,dx/d*42,dy/d*42,room.world,PLAYER_RADIUS);target.x=push.x;target.y=push.y;
    event(room,"hit",{attackerId:player.id,targetId:target.id,damage:2000,hp:target.hp,fireBall:true,knockback:42,super:true});
    if(target.hp<=0){target.alive=false;cancelKameCharge(target);target.input={x:0,y:0};event(room,"knockout",{playerId:target.id,by:player.id});}
  }
  for(const obstacle of [...room.world.obstacles]){
    if(obstacle.tile!=="#"||Math.hypot(obstacle.x+obstacle.width/2-x,obstacle.y+obstacle.height/2-y)>radius)continue;
    if(removeArenaWall(room.world,obstacle.row,obstacle.col))destroyedWalls.push({row:obstacle.row,col:obstacle.col});
  }
  event(room,"ramu-impact",{playerId:player.id,x,y,fromX,fromY,waterHop,landingHop,radius,damage:2000,destroyedWalls,gadgetCooldownMs:Math.max(0,player.gadgetReadyAt-at),gadgetCharges:gadgetCharges(player,at)});
}
function doKame(room, player, angle) {
  const at = now();
  const power = finishKameCharge(player, at);
  if (power === null || !isCombatPhase(room.phase) || !player.alive || player.brawler !== "saiyan" || player.transformUntil > at || (player.kameReadyAt || 0) > at) return;
  const stats = getBrawlerStats(player);
  const aim = clamp(finite(angle, player.aim), -Math.PI * 2, Math.PI * 2);
  player.aim = aim; player.kameReadyAt = at + (player.form <= 1 ? 3000 : 5000);
  const traced = traceKameBeam(room.world, player.x, player.y, aim, power);
  const dx = Math.cos(aim), dy = Math.sin(aim), width = 14 + power * 40;
  const startDamage = stats.beamDamageStart ?? 700, maxDamage = stats.beamDamageMax ?? 2200;
  const damage = (startDamage + power * (maxDamage - startDamage)) / 6;
  let hits = 0;
  for (const target of room.players.values()) {
    if (!isTargetDamageable(target, player, at)) continue;
    const rx = target.x - player.x, ry = target.y - player.y;
    const along = rx * dx + ry * dy, perpendicular = Math.abs(-rx * dy + ry * dx);
    if (along <= 0 || along >= traced.length || perpendicular >= width + PLAYER_RADIUS) continue;
    target.lastHitAt=at;target.hp = Math.max(0, target.hp - damage); target.meter = clamp(target.meter + 12, 0, 100); hits++;
    event(room, "hit", { attackerId: player.id, targetId: target.id, damage, hp: target.hp, kame: true });
    if (target.hp <= 0) { target.alive = false; cancelKameCharge(target); target.input = { x: 0, y: 0 }; event(room, "knockout", { playerId: target.id, by: player.id }); }
  }
  if (power >= 0.95 && hits > 0) player.meter = clamp(player.meter + 20, 0, 100);
  event(room, "kame-fired", { playerId: player.id, charge: power, length: traced.length, hits, destroyedWalls: room.world.destroyedWalls });
}
function stepRoom(room, dt) {
  const t = now(); room.tick++; room.updatedAt = t;
  if (room.phase === "countdown" && t >= room.startedAt) { room.phase = "playing"; event(room, "match-started"); }
  if (room.phase === "playing") {
    for(const hacker of room.players.values())if(hacker.brawler==="hacker"&&hacker.hackTargetId){const target=room.players.get(hacker.hackTargetId);if(hacker.hackUntil>t&&target?.alive){target.input={...hacker.input};target.aim=hacker.aim;target.hackedById=hacker.id;}else{if(target?.hackedById===hacker.id)target.hackedById=null;hacker.hackTargetId=null;hacker.hackUntil=0;event(room,"system-takeover-end",{playerId:hacker.id,targetId:target?.id||null});}}
    for (const p of room.players.values()) {
      if (p.isBot && p.alive && p.connected && t >= p.botThinkAt) {
        const decision = decideBotAction(p, [...room.players.values()], room.world, t, room.projectiles);
        p.input = decision.input; p.aim = decision.aim; p.lastSeen = t; p.botThinkAt = t + 180;
        if(p.brawler==="ramu"&&p.ramuMode==="fire")setRamuFlameHeld(room,p,decision.action==="fire",t);
        if (decision.action === "fire") doFire(room, p, false);
        else if (decision.action === "super") doFire(room, p, true);
        else if (decision.action === "gadget") useGadget(room,p,t);
        else if (decision.action === "transform") {
          const nextForm=getNextSaiyanForm(p);
          if (p.meter>=50 && p.transformUntil<=t && nextForm!==null) {
            p.meter-=50; const stats=BRAWLERS.saiyan.forms[nextForm]; const delta=stats.hp-p.maxHp;
            p.maxHp=stats.hp; p.hp=clamp(p.hp+delta,0,p.maxHp); p.form=nextForm; p.transformUntil=t+1800;
            event(room,"transform",{playerId:p.id,form:p.form});
          }
        }
      }

      if(p.alive&&p.smokeUntil>0&&t>=p.smokeUntil){p.smokeUntil=0;const healed=p.maxHp-p.hp;p.hp=p.maxHp;event(room,"heal",{playerId:p.id,targetId:p.id,amount:healed,hp:p.hp,smokeChannel:true});}
      if(p.brawler==="ramu"&&p.ramuMode==="fire"){
        if(!p.alive)p.ramuFlameHeld=false;
        const energyState=advanceRamuFireEnergy(p,dt,t,getBrawlerStats(p));
        if(energyState.depleted)event(room,"ramu-flame-empty",{playerId:p.id,lockMs:getBrawlerStats(p).fireLockMs,fireEnergy:p.fireEnergy});
      }
      if(p.freezeMeter>0&&p.frozenUntil<=t)p.freezeMeter=Math.max(0,p.freezeMeter-dt*.035);
      if(p.alive&&p.burnUntil>t&&t>=(p.burnNextAt||0)){
        p.burnNextAt=t+500;p.hp=Math.max(0,p.hp-100);p.lastHitAt=t;event(room,"burn-tick",{playerId:p.id,by:p.burnOwnerId,damage:100,hp:p.hp});
        if(p.hp<=0){p.alive=false;cancelKameCharge(p);p.input={x:0,y:0};event(room,"knockout",{playerId:p.id,by:p.burnOwnerId});}
      }else if(p.burnUntil<=t){p.burnUntil=0;p.burnNextAt=0;p.burnOwnerId=null;}
      if(p.alive&&p.ramuDiveUntil>0&&t>=p.ramuDiveUntil){p.ramuDiveUntil=0;landRamuDive(room,p,t);}
      if (p.alive && shouldForfeitDisconnectedPlayer(p.connected, p.disconnectedAt, t, DISCONNECT_GRACE_MS)) {
        p.alive = false;
        cancelKameCharge(p);
        p.input = { x: 0, y: 0 };
        p.disconnectedAt = 0;
        event(room, "player-forfeit", { playerId: p.id, reason: "disconnect" });
      }
      if (!p.connected || !p.alive) continue;
      if (t - p.lastSeen > INPUT_TIMEOUT_MS) p.input = { x: 0, y: 0 };
      const stats=getBrawlerStats(p),oldX=p.x,oldY=p.y;
      if(p.smokeUntil>t||p.frozenUntil>t||p.ramuShieldUntil>t||(p.ramuDiveUntil>t&&t<(p.ramuDiveMoveAt||0)))p.input={x:0,y:0};
      const droneMoving=p.brawler==="hacker"&&p.hackerDroneControl&&!(p.hackTargetId&&p.hackUntil>t);
      const movementInput=(p.brawler==="hacker")||(p.hackTargetId&&p.hackUntil>t)?{x:0,y:0}:p.input;
      if(droneMoving){const d=movementDelta(p.input.x,p.input.y,220,dt);p.hackerDroneX=clamp(p.hackerDroneX+d.x,room.world.margin+PLAYER_RADIUS,room.world.width-room.world.margin-PLAYER_RADIUS);p.hackerDroneY=clamp(p.hackerDroneY+d.y,room.world.margin+PLAYER_RADIUS,room.world.height-room.world.margin-PLAYER_RADIUS);}
      const {x:dx,y:dy}=movementDelta(movementInput.x,movementInput.y,stats.speed,dt);
      if(p.ramuDiveUntil>t&&t>=(p.ramuDiveMoveAt||0)){const divePosition=clampPlayerPosition(p.x+dx,p.y+dy,room.world,PLAYER_RADIUS);p.x=divePosition.x;p.y=divePosition.y;}
      else{const nextPosition=movePlayerWithObstacles(p.x,p.y,dx,dy,room.world,PLAYER_RADIUS);p.x=nextPosition.x;p.y=nextPosition.y;}
      if(dt>0){let vx=(p.x-oldX)/dt,vy=(p.y-oldY)/dt,cap=stats.speed*1.8,v=Math.hypot(vx,vy);if(v>cap){vx*=cap/v;vy*=cap/v;}p.aiVx=(p.aiVx||0)*.35+vx*.65;p.aiVy=(p.aiVy||0)*.35+vy*.65;}
      if (p.transformUntil && t >= p.transformUntil) p.transformUntil = 0;
    }
    for (const p of room.players.values()) {
      if (!p.pendingMuiBeam || t < p.pendingMuiBeam.at) continue;
      const beam = p.pendingMuiBeam;
      p.pendingMuiBeam = null;
      if (!p.alive) continue;
      const traced = traceMasteredBeam(room.world, beam.x, beam.y, beam.aim);
      const beamId = nextProjectileId++;
      room.beams.push({ id: beamId, ownerId: p.id, team: p.team, x: beam.x, y: beam.y, aim: beam.aim,
        length: traced.length, width: 100, damage: 7000 / 6, nextHitAt: t, expiresAt: t + 800 });
      event(room, "mui-beam-fired", { playerId: p.id, beamId, x: beam.x, y: beam.y, aim: beam.aim, length: traced.length, width: 100, durationMs: 800, destroyedWalls: traced.destroyedWalls });
    }
    const movers = [...room.players.values()].filter(p => p.connected && p.alive);
    const separated = resolvePlayerCollisions(movers, room.world, PLAYER_RADIUS);
    movers.forEach((p, index) => { p.x = separated[index].x; p.y = separated[index].y; });
  }
  if (!isCombatPhase(room.phase)) { room.projectiles = []; room.splashZones = []; room.beams = []; }
  const keep = [];
  for (const b of room.projectiles) {
    advanceProjectile(b, dt);
    if (b.flightDuration > 0 && b.speed > 0) b.flightTime = Math.min(b.flightDuration, (b.traveled || 0) / b.speed);
    const splashProjectile = () => {
      if (!b.friendlySupport && !b.cigar) return;
      const radius = b.splashRadius || 0, owner = room.players.get(b.ownerId);
      if (b.greenBeer) {
        if (owner) owner.gadgetReadyAt = t + (b.durationMs || 3000) + 15_000;
        room.splashZones.push({ id:b.id, ownerId:b.ownerId, team:b.team, x:b.x, y:b.y, radius,
          damage:0, heal:b.heal || 1000, greenBeer:true, tickMs:1000, expiresAt:t+(b.durationMs || 3000), nextTickAt:t,
          nextTargetAt:new Map() });
      } else if (b.friendlySupport && !b.cigar) {
        room.splashZones.push({ id:b.id, ownerId:b.ownerId, team:b.team, x:b.x, y:b.y, radius,
          damage:b.damage, heal:b.heal || 2250, superBeer:!!b.superBeer, expiresAt:t+1800, nextTickAt:t,
          nextTargetAt:new Map() });
      } else {
        for (const target of room.players.values()) {
          if (!target.alive || target.id === b.ownerId || Math.hypot(target.x-b.x,target.y-b.y) > radius) continue;
          if (target.team === b.team) continue;
          target.lastHitAt=t;target.hp = Math.max(0,target.hp-b.damage);
          target.meter = clamp(target.meter+12,0,100);
          event(room,"hit",{projectileId:b.id,attackerId:b.ownerId,targetId:target.id,damage:b.damage,hp:target.hp,splash:true});
          if(target.hp<=0){target.alive=false;cancelKameCharge(target);target.input={x:0,y:0};event(room,"knockout",{playerId:target.id,by:b.ownerId});}
        }
      }
      event(room,"projectile-splash",{projectileId:b.id,ownerId:b.ownerId,x:b.x,y:b.y,radius,kind:b.greenBeer?"green-beer":b.cigar?"cigar":"beer",super:!!b.superBeer,durationMs:b.greenBeer?(b.durationMs||3000):b.cigar?0:1800,healPerSecond:b.greenBeer?(b.heal||1000):undefined});
      if(owner && b.superBeer) owner.meter=0;
    };
    const wallHit = (b.friendlySupport || b.cigar || b.greenBeer) ? null : findProjectileObstacleHit(b, room.world.obstacles, 2);
    let contact = findProjectileContact(b, room.players.values(), t, 19);
    if (b.friendlySupport && !b.cigar) contact = null; // Beer passes over players and splashes only when it lands.
    if (b.greenBeer) contact = null; // Lobbed support cigar lands at its range instead of colliding with players.
    if (b.friendlySupport && b.cigar && !b.greenBeer) {
      const x1 = Number.isFinite(b.previousX) ? b.previousX : b.x, y1 = Number.isFinite(b.previousY) ? b.previousY : b.y;
      const dx = b.x - x1, dy = b.y - y1, length2 = dx*dx + dy*dy;
      let allyContact = null, firstT = Infinity;
      for (const ally of room.players.values()) {
        if (ally.id === b.ownerId || ally.team !== b.team || !ally.alive || ally.hp >= ally.maxHp) continue;
        const u = length2 ? clamp(((ally.x-x1)*dx + (ally.y-y1)*dy)/length2, 0, 1) : 0;
        const distance2 = (ally.x-(x1+u*dx))**2 + (ally.y-(y1+u*dy))**2;
        if (distance2 <= 19*19 && u < firstT) { allyContact = { player: ally, t: u }; firstT = u; }
      }
      if (allyContact && (!contact || allyContact.t < contact.t)) contact = { ...allyContact, friendly: true };
    }
    if (wallHit && (!contact || wallHit.t <= contact.t)) {
      splashProjectile();
      const wall = wallHit.obstacle;
      if (b.super && wall.tile === "#" && removeArenaWall(room.world, wall.row, wall.col)) {
        event(room, "wall-break", { playerId: b.ownerId, row: wall.row, col: wall.col });
      }
    } else if (contact) {
      if (b.friendlySupport || b.cigar) { splashProjectile(); continue; }
      const hit = contact.player;
      if (contact.friendly && b.friendlySupport) {
        const healed = Math.min(hit.maxHp - hit.hp, b.heal || 900);
        hit.hp += healed;
        event(room, "heal", { projectileId:b.id, playerId:b.ownerId, targetId:hit.id, amount:healed, hp:hit.hp });
      } else {
        hit.lastHitAt=t;hit.hp = Math.max(0, hit.hp-b.damage); hit.meter = clamp(hit.meter+12,0,100);
        const owner = room.players.get(b.ownerId); if (owner) owner.meter = clamp(owner.meter+18,0,100);
        event(room, "hit", { projectileId:b.id, attackerId:b.ownerId, targetId:hit.id, damage:b.damage, hp:hit.hp });
        if (hit.hp <= 0) { hit.alive=false; cancelKameCharge(hit); hit.input={x:0,y:0}; event(room,"knockout",{playerId:hit.id,by:b.ownerId}); }
      }
    } else if (projectileStillInRange(b, room.world.width, room.world.height)) keep.push(b);
    else splashProjectile();
  }
  room.projectiles = keep;
  const activeZones = [];
  for (const zone of room.splashZones) {
    if (t >= zone.expiresAt) continue;
    if (t >= zone.nextTickAt) {
      zone.nextTickAt = t + (zone.tickMs || 600);
      for (const target of room.players.values()) {
        if (!target.alive || Math.hypot(target.x-zone.x,target.y-zone.y) > zone.radius) continue;
        const isOwner = target.id === zone.ownerId;
        const sameTeam = isOwner || ((room.mode !== "showdown") && target.team === zone.team);
        if (sameTeam) {
          const healed = Math.min(target.maxHp-target.hp, zone.heal);
          if (healed > 0) { target.hp += healed; event(room,"heal",{projectileId:zone.id,playerId:zone.ownerId,targetId:target.id,amount:healed,hp:target.hp,splash:true,beerZone:true}); }
        } else {
          const previous = zone.nextTargetAt.get(target.id) || 0;
          if (t < previous) continue;
          zone.nextTargetAt.set(target.id,t+600);
          target.lastHitAt=t;target.hp = Math.max(0,target.hp-zone.damage);
          target.meter = clamp(target.meter+12,0,100);
          event(room,"hit",{projectileId:zone.id,attackerId:zone.ownerId,targetId:target.id,damage:zone.damage,hp:target.hp,splash:true,super:zone.superBeer,beerZone:true});
          if(target.hp<=0){target.alive=false;cancelKameCharge(target);target.input={x:0,y:0};event(room,"knockout",{playerId:target.id,by:zone.ownerId});}
        }
      }
    }
    activeZones.push(zone);
  }
  room.splashZones = activeZones;
  if (room.phase !== "playing") room.beams = [];
  else {
    const activeBeams = [];
    for (const beam of room.beams) {
      if (t >= beam.expiresAt) continue;
      if (t >= beam.nextHitAt) {
        const owner = room.players.get(beam.ownerId);
        const dx = Math.cos(beam.aim), dy = Math.sin(beam.aim);
        if (owner?.alive) for (const target of room.players.values()) {
          if (!isTargetDamageable(target, { id: beam.ownerId, team: beam.team }, t)) continue;
          const rx = target.x - beam.x, ry = target.y - beam.y;
          const along = rx * dx + ry * dy, perpendicular = Math.abs(-rx * dy + ry * dx);
          if (along <= 0 || along >= beam.length || perpendicular >= beam.width + 14) continue;
          target.lastHitAt=t;target.hp = Math.max(0, target.hp - beam.damage);
          target.meter = clamp(target.meter + 12, 0, 100);
          event(room, "hit", { attackerId: beam.ownerId, targetId: target.id, damage: beam.damage, hp: target.hp, mui: true });
          if (target.hp <= 0) { target.alive = false; cancelKameCharge(target); target.input = { x: 0, y: 0 }; event(room, "knockout", { playerId: target.id, by: beam.ownerId }); }
        }
        beam.nextHitAt = t + 100;
      }
      activeBeams.push(beam);
    }
    room.beams = activeBeams;
  }
  // Resolve the outcome after this tick's projectile and beam damage, so a final-frame
  // hit is counted before a timer winner is selected or the match is closed.
  if (room.phase === "playing") {
    const survivors = [...room.players.values()].filter(p => p.alive);
    const survivingTeams = new Set(survivors.map(p => p.team));
    if (survivors.length === 0) {
      room.phase = "ended"; room.winner = null; event(room, "match-ended", { winner: null, reason: "draw" });
    } else if (survivingTeams.size === 1) {
      room.phase = "ended"; room.winner = survivors[0].team; event(room, "match-ended", { winner: room.winner, reason: "elimination" });
    } else if (t >= room.endsAt) {
      room.phase = "ended";
      room.winner = selectWinnerByHealth(survivors);
      event(room, "match-ended", { winner: room.winner, reason: room.winner === null ? "draw" : "timer" });
    }
  }
  if (room.phase === "ended") { room.projectiles = []; room.beams = []; }
}
function cleanupRoom(room) {
  const currentTime = now();
  for (const [id,p] of room.players) {
    if (!shouldExpireDisconnectedPlayer(p.connected, p.lastSeen, currentTime, ROOM_TTL_MS)) continue;
    cancelKameCharge(p);
    room.players.delete(id);
  }
  room.ownerId = resolveRoomOwner(room.ownerId, [...room.players.values()]);
  if (!room.players.size) {
    if (!room.emptySince) room.emptySince = now();
    if (now() - room.emptySince > ROOM_TTL_MS) rooms.delete(room.code);
  } else {
    room.emptySince = 0;
  }
}
const server = http.createServer((req,res) => {
  const path = new URL(req.url || "/", "http://localhost").pathname;
  const headers = {"content-type":"application/json","cache-control":"no-store"};
  if (path === "/health") {
    // Liveness only; useful before deployment secrets are configured.
    res.writeHead(200,headers);
    res.end(JSON.stringify({ok:true,service:"dabrawl-authoritative-server",uptimeSeconds:Math.floor(process.uptime()),rooms:rooms.size,authConfigured:Boolean(auth)}));
    return;
  }
  if (path === "/ready") {
    // Readiness means authenticated match connections can be accepted.
    const ready = Boolean(auth);
    res.writeHead(ready ? 200 : 503,headers);
    res.end(JSON.stringify({ready,service:"dabrawl-authoritative-server",reason:ready ? undefined : "Missing SUPABASE_URL or SUPABASE_ANON_KEY"}));
    return;
  }
  res.writeHead(404,headers); res.end(JSON.stringify({error:"not found"}));
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
        if (canConfigureRoom(player.id, room.ownerId, room.phase) && m.mode !== undefined) {
          applyRoomMode(room, m.mode);
        }
        if (typeof m.ready === "boolean") updateReady(room, player, m.ready);
        emit(room,"player-joined",{playerId:player.id}); sendState(room);
      } else if (m.type==="ready") { updateReady(room, player, m.ready); sendState(room); }
      else if (m.type==="input") {
        const seq=Math.floor(finite(m.seq,-1)); if (seq<=player.seq) return;
        player.seq=seq;if(player.hackedById){const controller=room.players.get(player.hackedById);if(controller&&controller.hackUntil>now()){player.lastSeen=now();ws.send(JSON.stringify({type:"ack",seq,serverTime:now()}));return;}player.hackedById=null;}player.input=validAxes(m.x,m.y);if(player.smokeUntil<=now()&&player.frozenUntil<=now()&&player.ramuShieldUntil<=now())player.aim=clamp(finite(m.aim,player.aim),-Math.PI*2,Math.PI*2);
        player.lastSeen=now(); ws.send(JSON.stringify({type:"ack",seq,serverTime:now()}));
      } else if (m.type==="action") {
        if (m.action==="fire") {if(m.angle!==undefined)player.aim=clamp(finite(m.angle,player.aim),-Math.PI*2,Math.PI*2);doFire(room,player,false,{droneX:m.droneX,droneY:m.droneY,targetId:m.targetId});}
        else if(m.action==="ramu-flame-start"){
          const at=now();player.aim=clamp(finite(m.angle,player.aim),-Math.PI*2,Math.PI*2);
          if(isCombatPhase(room.phase)&&player.alive&&player.brawler==="ramu"&&player.ramuMode==="fire"&&player.transformUntil<=at&&player.smokeUntil<=at&&player.frozenUntil<=at&&player.ramuDiveUntil<=at&&player.ramuShieldUntil<=at)setRamuFlameHeld(room,player,true,at);
          sendState(room);
        } else if(m.action==="ramu-flame-stop"){
          const at=now();if(player.brawler==="ramu")setRamuFlameHeld(room,player,false,at);sendState(room);
        }
        else if (m.action==="super") {if(m.angle!==undefined)player.aim=clamp(finite(m.angle,player.aim),-Math.PI*2,Math.PI*2);doFire(room,player,true,{targetId:m.targetId});}
        else if (m.action==="transform") {
          const nextForm = getNextSaiyanForm(player);
          if (isCombatPhase(room.phase) && player.alive && player.meter>=50 && player.transformUntil<=now() && !(player.kameChargeStartedAt>0) && nextForm !== null) {
            player.meter-=50;
            const nextStats=BRAWLERS.saiyan.forms[nextForm];
            const healthDelta=nextStats.hp-player.maxHp;
            player.maxHp=nextStats.hp;
            player.hp=clamp(player.hp+healthDelta,0,player.maxHp);
            player.form=nextForm;
            player.transformUntil=now()+1800;
            event(room,"transform",{playerId:player.id,form:player.form});
          }
        } else if (m.action==="kame-start") {
          const at=now();
          if (isCombatPhase(room.phase) && player.alive && player.brawler==="saiyan" && player.transformUntil<=at && (player.kameReadyAt||0)<=at && player.gadgetReadyAt<=at) beginKameCharge(player,at);
          sendState(room);
        } else if (m.action==="kame-release") { player.aim=clamp(finite(m.angle,player.aim),-Math.PI*2,Math.PI*2); doKame(room, player, player.aim); sendState(room);
        } else if (m.action==="gadget") {
          useGadget(room,player,now());sendState(room);
        } else if (m.action==="add-bot") {
          if (!canConfigureRoom(player.id,room.ownerId,room.phase)) throw new Error("Only the room owner can add bots before the match starts");
          if (room.players.size>=MAX_PLAYERS) throw new Error("Room is full");
          const slot=nextAvailableSlot(room.players.values(), MAX_PLAYERS);
          if (slot < 0) throw new Error("Room is full");
          const id=`bot:${room.code}:${slot}`;
          const choices=["kuku","shachi","saiyan","deges","ramu"];const brawler=choices[slot%choices.length];
          const bot=makePlayer({id},{name:`Bot ${slot+1}`,brawler},slot); bot.isBot=true; bot.connected=true; bot.socket=null; bot.ready=true; room.players.set(id,bot);
          startMatch(room); event(room,"bot-joined",{playerId:id,brawler}); sendState(room);
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
  ws.on("close",()=>{ if (player.socket !== ws) return; const disconnectedAt=now(); cancelKameCharge(player); markPlayerDisconnected(player,disconnectedAt); room.updatedAt=disconnectedAt; cancelCountdown(room, "player-disconnected"); event(room,"player-disconnected",{playerId:player.id}); });
  ws.on("error",()=>{ if (player.socket !== ws) return; const disconnectedAt=now(); cancelKameCharge(player); markPlayerDisconnected(player,disconnectedAt); room.updatedAt=disconnectedAt; cancelCountdown(room, "connection-error"); event(room,"player-disconnected",{playerId:player.id,reason:"connection-error"}); });
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
