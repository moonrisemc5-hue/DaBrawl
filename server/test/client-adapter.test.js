import test from "node:test";
import assert from "node:assert/strict";
import { adaptServerPlayer, adaptServerPacket } from "../client-adapter.js";

test("maps a valid authoritative player to the browser-facing field names", () => {
  assert.deepEqual(adaptServerPlayer({
    id: "user-1", name: "Ivor", brawler: "kuku", team: 1, slot: 3,
    gadgetCharges: 1, gadgetCooldownMs: 450,
    x: 123, y: 234, aim: 1.25, hp: 4500, maxHp: 7000, alive: true,
    meter: 48, form: 2, transforming: true, connected: true, ready: false
  }), {
    id: "user-1", name: "Ivor", x: 123, y: 234, a: 1.25, hp: 4500, mh: 7000, alive: true,
    sc: 48, form: 2, tfn: 2, tf: 1, brawler: "kuku", team: 1, slot: 3,
    gadgetCharges: 1, gadgetCooldownMs: 450, connected: true, ready: false
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
      winner: null, ownerId: "host",
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
