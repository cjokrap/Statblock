import { test } from "node:test";
import assert from "node:assert/strict";
import { levelProgress, modifier, progressForScore, progressTrend, scoreProgress, trend } from "./game.ts";

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

const LADDER = { baseline: 10, min: 3, max: 20, days_per_week: 7, first_step_weeks: 2, step_increase_weeks: 1 };

test("ability score ladder", () => {
  assert.equal(progressForScore(11, LADDER), 14); // 2 perfect weeks
  assert.equal(progressForScore(12, LADDER), 35); // then 3 more
  assert.equal(progressForScore(20, LADDER), 455); // 65 weeks from 10 to 20
  assert.equal(progressForScore(9, LADDER), -14);
  assert.deepEqual(scoreProgress(0, LADDER), { score: 10, pct: 0, next: 11, daysToNext: 14 });
  assert.deepEqual(scoreProgress(7, LADDER), { score: 10, pct: 50, next: 11, daysToNext: 7 });
  assert.equal(scoreProgress(14, LADDER).score, 11);
  assert.deepEqual(scoreProgress(24.5, LADDER), { score: 11, pct: 50, next: 12, daysToNext: 10.5 });
  assert.deepEqual(scoreProgress(455, LADDER), { score: 20, pct: 100, next: null, daysToNext: null });
  // Below baseline: -20 is a 9 (-35 < p <= -14), 6 good days from 10 again.
  const low = scoreProgress(-20, LADDER);
  assert.deepEqual([low.score, low.next, low.daysToNext], [9, 10, 6]);
  assert.equal(scoreProgress(-2, LADDER).score, 10);
  assert.equal(progressTrend(10.625, 8), "Up");
  assert.equal(progressTrend(-4, -2), "Down");
  assert.equal(progressTrend(3, undefined), "Steady");
});
