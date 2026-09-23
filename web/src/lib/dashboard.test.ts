import { test } from "node:test";
import assert from "node:assert/strict";
import { hitPoints, questView, shortExercise, summarizeSets, type QuestRow } from "./dashboard.ts";
import { KG_PER_LB } from "./targets.ts";

test("hit points: under, in and over the window", () => {
  const under = hitPoints(1338, 2000, 10);
  assert.equal(under.state, "under");
  assert.equal(under.message, "462 kcal to reach your window");
  assert.deepEqual([Math.round(under.low), Math.round(under.high)], [1800, 2200]);
  assert.equal(Math.round(under.fillPct), 55); // 1338 / (2200 × 1.1)
  assert.equal(hitPoints(2000, 2000, 10).message, "In your window · 200 kcal of room");
  assert.equal(hitPoints(2500, 2000, 10).message, "300 kcal over your window");
  assert.equal(hitPoints(9000, 2000, 10).fillPct, 100);
});

const q = (over: Partial<QuestRow>): QuestRow => ({
  code: "hit_protein",
  name: "Hit protein",
  cadence: "daily",
  xp: 10,
  track: "alchemist",
  progress: 116,
  target: 180,
  completedAt: null,
  ...over,
});
const opts = { waterUnit: "oz" as const, timeZone: "America/Chicago", windowPct: 10 };

test("quest text", () => {
  assert.deepEqual(questView(q({}), opts), { done: false, badge: "64%", detail: "64 g to go", xp: "+10 ALC" });
  assert.equal(questView(q({ code: "drink_water", progress: 1893, target: 2957 }), opts).detail, "36 oz to go");
  assert.equal(
    questView(q({ code: "drink_water", progress: 500, target: 2000 }), { ...opts, waterUnit: "ml" }).detail,
    "1,500 mL to go",
  );
  const meals = questView(q({ code: "log_every_meal", progress: 2, target: 3, xp: 20, track: "quartermaster" }), opts);
  assert.deepEqual([meals.badge, meals.xp], ["2/3", "+20 QM"]);
  const done = questView(q({ completedAt: "2026-09-23T13:40:00Z" }), opts);
  assert.deepEqual([done.done, done.detail], [true, "Hit at 8:40 AM"]);
  assert.equal(
    questView(q({ code: "calorie_window", progress: 1200, target: 2000 }), opts).detail,
    "Checked at end of day · 1,800–2,200 kcal",
  );
  assert.equal(questView(q({ code: "train", xp: 0, track: null }), opts).xp, "");
});

test("set summaries skip warm-ups and show PRs", () => {
  const lb = (n: number) => n * KG_PER_LB;
  const sets = [
    { exercise: "Squat, Barbell", tier: "T1", setIndex: 0, reps: 5, weightKg: lb(135), isWarmup: true, isPr: false, est1rmKg: null },
    ...[1, 2, 3, 4, 5].map((i) => ({
      exercise: "Squat, Barbell", tier: "T1", setIndex: i, reps: 3, weightKg: lb(275), isWarmup: false,
      isPr: i === 5, est1rmKg: lb(302.5),
    })),
    { exercise: "Leg Curl", tier: "T3", setIndex: 6, reps: 15, weightKg: lb(90), isWarmup: false, isPr: false, est1rmKg: null },
    { exercise: "Leg Curl", tier: "T3", setIndex: 7, reps: 12, weightKg: lb(90), isWarmup: false, isPr: false, est1rmKg: null },
  ];
  assert.deepEqual(summarizeSets(sets, "lb"), [
    { exercise: "Squat, Barbell", tier: "T1", text: "5×3 @ 275 lb", pr: true, best1rm: 303 },
    { exercise: "Leg Curl", tier: "T3", text: "15, 12 @ 90 lb", pr: false, best1rm: null },
  ]);
  assert.equal(shortExercise("Squat, Barbell"), "Squat");
});
