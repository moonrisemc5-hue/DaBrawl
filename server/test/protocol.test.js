import test from "node:test";
import assert from "node:assert/strict";
import { cleanText, validAxes, validRoomCode, validMode, parseClientMessage, isCombatPhase } from "../protocol.js";

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
