import { test } from "node:test";
import assert from "node:assert/strict";
import { levelProgress, modifier, trend } from "./game.ts";

// rules v1 levels.thresholds
const T = [0, 30, 90, 270, 650, 1400, 2300, 3400, 4800, 6400, 8500, 10000, 12000, 14000, 16500, 19500, 22500, 26500, 30500, 35500];

test("levels follow the thresholds", () => {
  assert.equal(levelProgress(0, T).level, 1);
  assert.equal(levelProgress(29, T).level, 1);
  assert.equal(levelProgress(30, T).level, 2);
  assert.equal(levelProgress(2604, T).level, 7);
  assert.equal(levelProgress(1749, T).level, 6);
  assert.equal(levelProgress(35500, T).level, 20);
});

test("progress through a level", () => {
  const p = levelProgress(2604, T); // level 7: 2300 to 3400
  assert.equal(p.levelFloor, 2300);
  assert.equal(p.nextAt, 3400);
  assert.equal(p.toNext, 796);
  assert.ok(Math.abs(p.pct - (304 / 1100) * 100) < 1e-9);
});

test("max level has no next level", () => {
  const p = levelProgress(40000, T);
  assert.equal(p.nextAt, null);
  assert.equal(p.toNext, null);
  assert.equal(p.pct, 100);
});

test("ability modifiers", () => {
  assert.equal(modifier(10), "+0");
  assert.equal(modifier(11), "+0");
  assert.equal(modifier(12), "+1");
  assert.equal(modifier(20), "+5");
  assert.equal(modifier(9), "−1");
  assert.equal(modifier(3), "−4");
});

test("trend", () => {
  assert.equal(trend(12, 10), "Up");
  assert.equal(trend(9, 10), "Down");
  assert.equal(trend(10, 10), "Steady");
  assert.equal(trend(10, undefined), "Steady");
});
