import { test } from "node:test";
import assert from "node:assert/strict";
import { forGrams, isMeal, localNow, mealForHour } from "./meals.ts";

test("meal from hour", () => {
  assert.equal(mealForHour(7), "breakfast");
  assert.equal(mealForHour(10.4), "breakfast");
  assert.equal(mealForHour(12), "lunch");
  assert.equal(mealForHour(18.5), "dinner");
  assert.equal(mealForHour(22), "snack");
});

test("isMeal", () => {
  assert.ok(isMeal("dinner"));
  assert.ok(!isMeal("brunch"));
  assert.ok(!isMeal(undefined));
});

test("local date in Chicago crosses midnight UTC correctly", () => {
  // 03:30 UTC on Sep 17 is 22:30 on Sep 16 in Chicago (CDT, UTC-5).
  const n = localNow("America/Chicago", new Date("2026-09-17T03:30:00Z"));
  assert.equal(n.date, "2026-09-16");
  assert.equal(n.hour, 22.5);
});

test("nutrition scales from per 100 g", () => {
  const n = forGrams({ kcal_100g: 152, protein_100g: 21, carbs_100g: 0, fat_100g: null }, 200);
  assert.equal(n.kcal, 304);
  assert.equal(n.protein, 42);
  assert.equal(n.fat, 0);
});
