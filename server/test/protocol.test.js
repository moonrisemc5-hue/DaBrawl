import test from "node:test";
import assert from "node:assert/strict";
import { cleanText, validAxes, validRoomCode, validMode, parseClientMessage, isCombatPhase, assignTeams, canConfigureRoom, resolveRoomOwner, shouldCancelCountdown, shouldExpireDisconnectedPlayer, shouldForfeitDisconnectedPlayer } from "../protocol.js";

test("sanitizes names and limits their length", () => {
  assert.equal(cleanText("  Ivor<script>\n  "), "Ivorscript");
  assert.equal(cleanText("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", 28).length, 28);
  assert.equal(cleanText(" \u0000 "), "Player");
});

test("normalizes diagonal movement and rejects invalid axes", () => {
  const axes = validAxes(1, 1);
  assert.ok(Math.abs(axes.x - Math.SQRT1_2) < 1e-10);
  assert.ok(Math.abs(axes.y - Math.SQRT1_2) < 1e-10);
  assert.deepEqual(validAxes(0.5, -0.25), { x: 0.5, y: -0.25 });
  assert.throws(() => validAxes(2, 0), /Invalid movement axes/);
  assert.throws(() => validAxes("bad", 0), /Invalid movement axes/);
});

test("accepts only safe room codes", () => {
  assert.equal(validRoomCode("party_123-A"), true);
  assert.equal(validRoomCode(""), false);
  assert.equal(validRoomCode("room?x=1"), false);
  assert.equal(validRoomCode("x".repeat(65)), false);
});

test("falls back to a supported mode", () => {
  assert.equal(validMode("duel"), "duel");
  assert.equal(validMode("made-up-mode"), "knockout");
});

test("rejects malformed client messages", () => {
  assert.deepEqual(parseClientMessage('{"type":"ping"}'), { type: "ping" });
  assert.throws(() => parseClientMessage("{"), /Invalid JSON message/);
  assert.throws(() => parseClientMessage("[]"), /Invalid message/);
  assert.throws(() => parseClientMessage('{"x":1}'), /Invalid message/);
});

test("combat is allowed only after the match enters playing phase", () => {
  assert.equal(isCombatPhase("waiting"), false);
  assert.equal(isCombatPhase("countdown"), false);
  assert.equal(isCombatPhase("playing"), true);
  assert.equal(isCombatPhase("ended"), false);
});

test("teams are balanced for knockout, alternating for duel, and unique for showdown", () => {
  assert.deepEqual(assignTeams(6, "knockout"), [0, 0, 0, 1, 1, 1]);
  assert.deepEqual(assignTeams(2, "knockout"), [0, 1]);
  assert.deepEqual(assignTeams(4, "duel"), [0, 1, 0, 1]);
  assert.deepEqual(assignTeams(3, "showdown"), [0, 1, 2]);
});

test("only the room owner can configure a room before the match starts", () => {
  assert.equal(canConfigureRoom("owner", "owner", "waiting"), true);
  assert.equal(canConfigureRoom("guest", "owner", "waiting"), false);
  assert.equal(canConfigureRoom("owner", "owner", "playing"), false);
  assert.equal(canConfigureRoom("", "owner", "waiting"), false);
});

test("validates client message schemas before game logic sees them", () => {
  assert.deepEqual(parseClientMessage('{"type":"ready","ready":true}'), { type: "ready", ready: true });
  assert.deepEqual(parseClientMessage('{"type":"input","seq":1,"x":0.5,"y":-0.5,"aim":0}'), { type: "input", seq: 1, x: 0.5, y: -0.5, aim: 0 });
  assert.throws(() => parseClientMessage('{"type":"ready","ready":"yes"}'), /Invalid ready flag/);
  assert.throws(() => parseClientMessage('{"type":"input","seq":-1,"x":0,"y":0}'), /Invalid input sequence/);
  assert.throws(() => parseClientMessage('{"type":"input","seq":1,"x":"fast","y":0}'), /Invalid movement axes/);
  assert.throws(() => parseClientMessage('{"type":"action","action":"teleport"}'), /Unsupported action/);
  assert.throws(() => parseClientMessage('{"type":"admin"}'), /Unsupported message type/);
  assert.throws(() => parseClientMessage('{"type":"join","name":"' + "x".repeat(81) + '"}'), /Invalid name/);
});


test("protocol violation threshold closes abusive sockets without closing on one typo", async () => {
  const { shouldCloseForProtocolViolations, PROTOCOL_VIOLATION_LIMIT } = await import("../protocol.js");
  assert.equal(PROTOCOL_VIOLATION_LIMIT, 8);
  assert.equal(shouldCloseForProtocolViolations(1), false);
  assert.equal(shouldCloseForProtocolViolations(7), false);
  assert.equal(shouldCloseForProtocolViolations(8), true);
  assert.equal(shouldCloseForProtocolViolations(100), true);
  assert.equal(shouldCloseForProtocolViolations(8.5), false);
});


test("cancels a countdown if any player becomes unready", () => {
  assert.equal(shouldCancelCountdown("countdown", false), true);
  assert.equal(shouldCancelCountdown("countdown", true), false);
  assert.equal(shouldCancelCountdown("waiting", false), false);
  assert.equal(shouldCancelCountdown("playing", false), false);
});


test("expires only disconnected players after the room retention window", () => {
  const ttl = 120_000;
  assert.equal(shouldExpireDisconnectedPlayer(false, 1_000, 120_999, ttl), false);
  assert.equal(shouldExpireDisconnectedPlayer(false, 1_000, 121_000, ttl), true);
  assert.equal(shouldExpireDisconnectedPlayer(true, 1_000, 500_000, ttl), false);
  assert.equal(shouldExpireDisconnectedPlayer(false, NaN, 500_000, ttl), false);
  assert.equal(shouldExpireDisconnectedPlayer(false, 1_000, 500_000, -1), false);
});

 
test("forfeits a disconnected player only after the in-match reconnect grace window", () => {
  const grace = 10_000;
  assert.equal(shouldForfeitDisconnectedPlayer(false, 5_000, 14_999, grace), false);
  assert.equal(shouldForfeitDisconnectedPlayer(false, 5_000, 15_000, grace), true);
  assert.equal(shouldForfeitDisconnectedPlayer(true, 5_000, 50_000, grace), false);
  assert.equal(shouldForfeitDisconnectedPlayer(false, NaN, 50_000, grace), false);
  assert.equal(shouldForfeitDisconnectedPlayer(false, 5_000, 50_000, -1), false);
});

test("retains the room owner or promotes the earliest remaining player", () => {
  const players = [{ id: "second", slot: 1 }, { id: "first", slot: 0 }];
  assert.equal(resolveRoomOwner("second", players), "second");
  assert.equal(resolveRoomOwner("departed", players), "first");
  assert.equal(resolveRoomOwner("departed", []), null);
  assert.throws(() => resolveRoomOwner("departed", null), /array/);
});

test("accepts valid Saiyan Kame actions and rejects out-of-range charge", () => {
  assert.doesNotThrow(() => parseClientMessage(JSON.stringify({ type: "action", action: "kame", charge: 0.8, angle: 1.2 })));
  assert.throws(() => parseClientMessage(JSON.stringify({ type: "action", action: "kame", charge: 1.1 })), /Invalid charge/);
  assert.throws(() => parseClientMessage(JSON.stringify({ type: "action", action: "kame", angle: "east" })), /Invalid angle/);
});


test("Kame charge actions do not accept client-authored charge values", () => {
  assert.deepEqual(parseClientMessage('{"type":"action","action":"kame-start"}'), { type:"action", action:"kame-start" });
  assert.deepEqual(parseClientMessage('{"type":"action","action":"kame-release","angle":1.2}'), { type:"action", action:"kame-release", angle:1.2 });
  assert.throws(() => parseClientMessage('{"type":"action","action":"kame"}'), /Unsupported action/);
});
