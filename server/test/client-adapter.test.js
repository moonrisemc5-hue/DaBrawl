import test from "node:test";
import assert from "node:assert/strict";
import { adaptServerPlayer, adaptServerPacket } from "../client-adapter.js";

test("maps a valid authoritative player to the browser-facing field names", () => {
  assert.deepEqual(adaptServerPlayer({
    id: "user-1", name: "Ivor", brawler: "kuku", team: 1, slot: 3,
    ramuMode: "ice", fireEnergy: 1, fireLockMs: 0, ramuFlameHeld: false, ramuDiveUntil: 0, ramuDiveMoveMs: 0, ramuShieldMs: 0, freezeMeter: 0, frozenMs: 0, burnMs: 0, smokeMs: 0,
    gadgetCharges: 1, gadgetCooldownMs: 450, kameCooldownMs: 2500, muiCharging: true,
    x: 123, y: 234, aim: 1.25, hp: 4500, maxHp: 7000, alive: true,
    meter: 48, form: 2, transforming: true, connected: true, ready: false
  }), {
    id: "user-1", name: "Ivor", x: 123, y: 234, a: 1.25, hp: 4500, mh: 7000, alive: true,
    sc: 48, form: 2, tfn: 2, tf: 1, brawler: "kuku", ramuMode: "ice", fireEnergy: 1, fireLockMs: 0, ramuFlameHeld: false, ramuDiveUntil: 0, ramuDiveMoveMs: 0, ramuShieldMs: 0,
    freezeMeter: 0, frozenMs: 0, burnMs: 0, smokeMs: 0, team: 1, slot: 3,
    gadgetCharges: 1, gadgetCooldownMs: 450, kameCooldownMs: 2500, muiCharging: true, connected: true, ready: false
  });
});

test("rejects incomplete or malformed player snapshots instead of fabricating coordinates", () => {
  assert.equal(adaptServerPlayer(null), null);
  assert.equal(adaptServerPlayer({ id: "x", x: "1", y: 2, hp: 1, maxHp: 2 }), null);
  assert.equal(adaptServerPlayer({ id: "", x: 1, y: 2, hp: 1, maxHp: 2 }), null);
});

test("adapts a state packet while filtering malformed projectiles", () => {
  const adapted = adaptServerPacket({
    type: "state", room: "ROOM1", tick: 42, serverTime: 1234,
    state: {
      mode: "knockout", phase: "playing", startedAt: 1000, endsAt: 181000,
      winner: null, ownerId: "host", destroyedWalls: [{ row: 2, col: 4 }, { row: "bad", col: 1 }],
      players: [{ id:"p1", x:10, y:20, hp:90, maxHp:100, aim:0.5, meter:12 }],
      projectiles: [
        { id:1, ownerId:"p1", x:20, y:20, angle:0, super:false },
        { id:2, ownerId:"p1", x:"bad", y:20, angle:0, super:false }
      ]
    }
  });
  assert.equal(adapted.kind, "state");
  assert.equal(adapted.state.players[0].mh, 100);
  assert.equal(adapted.state.players[0].a, 0.5);
  assert.equal(adapted.state.projectiles.length, 1);
  assert.equal(adapted.tick, 42);
});

test("rejects a state packet if any player cannot be safely mapped", () => {
  assert.equal(adaptServerPacket({ type:"state", state:{ players:[{id:"p",x:1,y:2}] } }), null);
});

test("normalizes server events without turning confirmed hits into duplicate client damage", () => {
  const hit = adaptServerPacket({
    type:"event", room:"ROOM1", tick:8, event:"hit",
    attackerId:"a", targetId:"b", damage:250, hp:750
  });
  assert.equal(hit.kind, "event");
  assert.equal(hit.name, "hit-confirmed");
  assert.equal(hit.data.targetId, "b");
  assert.equal(hit.data.damage, 250);
  assert.notEqual(hit.name, "damage");
});

test("maps lifecycle events and handles unknown event names explicitly", () => {
  assert.equal(adaptServerPacket({type:"event",event:"match-started"}).name, "match-started");
  assert.equal(adaptServerPacket({type:"event",event:"unlisted-event"}).name, "unknown");
  assert.equal(adaptServerPacket({type:"state",state:{players:"no"}}), null);
  assert.equal(adaptServerPacket({type:"made-up"}), null);
});

test("normalizes acknowledgements and errors", () => {
  assert.deepEqual(adaptServerPacket({type:"ack",seq:9,serverTime:500}), {
    kind:"ack", seq:9, clientSentAt:null, serverTime:500
  });
  assert.deepEqual(adaptServerPacket({type:"error",message:"nope"}), {kind:"error",message:"nope"});
});


test("preserves player display names and authoritative gadget timing without inventing missing values", () => {
  const player = adaptServerPlayer({
    id: "p2", name: "Teno", x: 1, y: 2, hp: 80, maxHp: 100,
    gadgetCharges: 2, gadgetCooldownMs: 0
  });
  assert.equal(player.name, "Teno");
  assert.equal(player.gadgetCharges, 2);
  assert.equal(player.gadgetCooldownMs, 0);

  const olderSnapshot = adaptServerPlayer({ id: "p3", x: 1, y: 2, hp: 80, maxHp: 100 });
  assert.equal(olderSnapshot.name, "");
  assert.equal(olderSnapshot.gadgetCharges, null);
  assert.equal(olderSnapshot.gadgetCooldownMs, null);
});

test("clamps malformed negative gadget timing to zero", () => {
  const player = adaptServerPlayer({
    id: "p4", x: 1, y: 2, hp: 80, maxHp: 100,
    gadgetCharges: -1, gadgetCooldownMs: -500
  });
  assert.equal(player.gadgetCharges, 0);
  assert.equal(player.gadgetCooldownMs, 0);
});

test("maps terrain and charged-beam events for a future browser adapter", () => {
  const event = adaptServerPacket({ type: "event", room: "ROOM1", tick: 8, event: "mui-beam-fired", playerId: "p1", hits: 2 });
  assert.equal(event.name, "mui-beam-fired");
  assert.equal(event.data.playerId, "p1");
  const state = adaptServerPacket({ type: "state", room: "ROOM1", state: {
    players: [{ id:"p1", x:1, y:2, hp:3, maxHp:4 }],
    destroyedWalls: [{ row: 2, col: 4 }, { row: "bad", col: 1 }],
    wallStates: [{row:2,col:4,heat:2.5,iceHits:3,iced:false,melt:0},{row:2,col:5,heat:9,iceHits:14,iced:true,melt:8},{row:"bad",col:1,heat:0,iceHits:0,melt:0}]
  }});
  assert.deepEqual(state.state.destroyedWalls, [{ row: 2, col: 4 }]);
  assert.deepEqual(state.state.wallStates, [
    {row:2,col:4,heat:2.5,iceHits:3,iced:false,melt:0},
    {row:2,col:5,heat:5,iceHits:12,iced:true,melt:5}
  ]);
  const wallEvent=adaptServerPacket({type:"event",event:"wall-state",row:2,col:4,heat:1.5,iceHits:12,iced:true,melt:0});
  assert.equal(wallEvent.name,"wall-state");
  assert.equal(wallEvent.data.iced,true);
  const impact=adaptServerPacket({type:"event",event:"ramu-impact",playerId:"ramu",gadgetCooldownMs:20000,gadgetCharges:0});
  assert.equal(impact.name,"area-impact");
  assert.equal(impact.data.gadgetCooldownMs,20000);
  assert.equal(impact.data.gadgetCharges,0);
});

test("preserves validated active beam snapshots for rendering without applying damage", () => {
  const adapted = adaptServerPacket({ type:"state", state:{
    players: [{ id:"p1", x:1, y:2, hp:100, maxHp:100 }],
    beams: [
      { id:4, ownerId:"p1", x:100, y:120, aim:0.5, length:1000, width:100, expiresAt:5000 },
      { id:"bad", ownerId:"p1", x:0, y:0, aim:0, length:10, width:10, expiresAt:1 }
    ]
  }});
  assert.equal(adapted.state.beams.length, 1);
  assert.equal(adapted.state.beams[0].id, 4);
});


test("preserves Ramu mode, status timers, ice volleys, and fire-stream metadata",()=>{
  const player=adaptServerPlayer({id:"ramu",name:"Ramu",brawler:"ramu",x:1,y:2,hp:4000,maxHp:8000,ramuMode:"fire",fireEnergy:.6,fireLockMs:200,ramuFlameHeld:true,ramuDiveUntil:123456,ramuDiveMoveMs:220,ramuShieldMs:0,freezeMeter:.75,frozenMs:900,burnMs:1200,smokeMs:0});
  assert.equal(player.ramuMode,"fire");assert.equal(player.fireEnergy,.6);assert.equal(player.ramuFlameHeld,true);assert.equal(player.ramuDiveUntil,123456);assert.equal(player.ramuDiveMoveMs,220);assert.equal(player.freezeMeter,.75);assert.equal(player.frozenMs,900);assert.equal(player.burnMs,1200);
  const packet=adaptServerPacket({type:"state",state:{players:[{id:"ramu",x:1,y:2,hp:4000,maxHp:8000}],projectiles:[{id:1,ownerId:"ramu",x:10,y:20,angle:0,super:false,iceBall:true,activateAt:1700,damage:1000}]}});
  assert.equal(packet.state.projectiles[0].iceBall,true);assert.equal(packet.state.projectiles[0].activateAt,1700);assert.equal(packet.state.projectiles[0].damage,1000);
  const flame=adaptServerPacket({type:"event",event:"hit",attackerId:"ramu",targetId:"enemy",damage:125,fireStream:true,fireBall:false});
  assert.equal(flame.data.fireStream,true);assert.equal(flame.data.fireBall,false);
});
