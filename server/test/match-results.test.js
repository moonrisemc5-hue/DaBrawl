import test from "node:test";
import assert from "node:assert/strict";
import { selectWinnerByHealth } from "../match-results.js";

test("selects the team with the most remaining health at time limit", () => {
  assert.equal(selectWinnerByHealth([
    { team: 0, hp: 40, alive: true },
    { team: 0, hp: 20, alive: true },
    { team: 1, hp: 45, alive: true }
  ]), 0);
});

test("returns a draw when teams have equal remaining health", () => {
  assert.equal(selectWinnerByHealth([
    { team: 0, hp: 30, alive: true },
    { team: 1, hp: 30, alive: true }
  ]), null);
});

test("ignores eliminated players and invalid score entries", () => {
  assert.equal(selectWinnerByHealth([
    { team: 0, hp: 100, alive: false },
    { team: 1, hp: 25, alive: true },
    { team: 1, hp: 10, alive: true },
    { team: 2, hp: NaN, alive: true },
    null
  ]), 1);
  assert.equal(selectWinnerByHealth([]), null);
});
