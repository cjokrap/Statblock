import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageOn,
  CM_PER_IN,
  KG_PER_LB,
  macroKcal,
  macrosFor,
  mifflinStJeor,
  parseNumber,
  suggestCalories,
  suggestTargets,
  type TargetRules,
} from "./targets.ts";

// The v1 rules_config values (20260922000800_reference_data.sql).
const RULES: TargetRules = {
  styles: {
    balanced: { protein_g_per_lb_goal: 0.8, fat_pct: 30 },
    high_protein: { protein_g_per_lb_goal: 1.0, fat_pct: 25 },
    low_carb: { protein_g_per_lb_goal: 0.8, carbs_g: 100, carbs_are_ceiling: true, count_net_carbs: true },
    keto: { protein_g_per_lb_goal: 0.8, carbs_g: 25, carbs_are_ceiling: true, count_net_carbs: true },
    low_fat: { protein_g_per_lb_goal: 0.8, fat_pct: 20 },
  },
  suggestions: {
    activity_multipliers: { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725 },
    kcal_per_lb_per_week: 500,
    kcal_floor: { male: 1500, female: 1200 },
    water_ml: { male: 2957, female: 2129 },
  },
};

// The mockup's worked example: 5 ft 10 in, 220 lb, 45, male, moderately
// active, 1 lb a week, Balanced, goal 185 lb.
const body = { sex: "male" as const, weightKg: 220 * KG_PER_LB, heightCm: 70 * CM_PER_IN, age: 45 };

test("Mifflin-St Jeor", () => {
  assert.equal(Math.round(mifflinStJeor(body)), 1889);
  assert.equal(Math.round(mifflinStJeor({ ...body, sex: "female" })), 1723);
});

test("the mockup's suggestion: 2,430 kcal, 148 g protein, 277 g carbs, 81 g fat, 100 oz", () => {
  const s = suggestTargets(RULES, {
    body,
    goalWeightKg: 185 * KG_PER_LB,
    activity: "moderate",
    paceLbPerWeek: 1,
    style: "balanced",
  });
  assert.deepEqual(
    [s.calorie_target, s.protein_g, s.carbs_g, s.fat_g, s.water_goal_ml, s.floored],
    [2430, 148, 277, 81, 2957, false],
  );
  assert.ok(Math.abs(macroKcal(s) - 2430) < 10);
});

test("calorie floor", () => {
  const small = { sex: "female" as const, weightKg: 50, heightCm: 155, age: 60 };
  assert.deepEqual(suggestCalories(RULES, small, "sedentary", 1.5), { kcal: 1200, floored: true });
  assert.equal(suggestCalories(RULES, body, "moderate", 0).kcal, 2930);
});

test("carb-ceiling styles fix carbs and let fat fill the rest", () => {
  const keto = macrosFor(RULES, "keto", 2000, 185 * KG_PER_LB);
  assert.deepEqual(keto, { protein_g: 148, carbs_g: 25, fat_g: 145, carbs_are_ceiling: true, count_net_carbs: true });
  const custom = macrosFor(RULES, "custom", 2000, 185 * KG_PER_LB);
  assert.deepEqual([custom.protein_g, custom.fat_g, custom.carbs_are_ceiling], [148, 67, false]);
  // No goal weight: protein stays where it was.
  assert.equal(macrosFor(RULES, "balanced", 2000, null, 180).protein_g, 180);
});

test("age and number parsing", () => {
  assert.equal(ageOn("1981-09-24", "2026-09-23"), 44);
  assert.equal(ageOn("1981-09-23", "2026-09-23"), 45);
  assert.equal(parseNumber("2,000"), 2000);
  assert.equal(parseNumber(" 5.5 "), 5.5);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("abc"), null);
});
