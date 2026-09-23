import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBranded, tidyName } from "./fdcParse.ts";

test("search-result shape", () => {
  const f = parseBranded({
    fdcId: 2110226,
    description: "GREEK YOGURT, PLAIN NONFAT",
    dataType: "Branded",
    brandOwner: "Chobani, Inc.",
    brandName: "CHOBANI",
    gtinUpc: "818290014108",
    servingSize: 150,
    servingSizeUnit: "g",
    householdServingFullText: "1 container",
    publishedDate: "2021-10-28",
    foodNutrients: [
      { nutrientId: 1008, unitName: "KCAL", value: 53 },
      { nutrientId: 1003, unitName: "G", value: 10 },
      { nutrientId: 1005, unitName: "G", value: 4 },
      { nutrientId: 1004, unitName: "G", value: 0 },
      { nutrientId: 1087, unitName: "MG", value: 110 },
    ],
  });
  assert.equal(f.name, "Greek Yogurt, Plain Nonfat");
  assert.equal(f.brand, "Chobani");
  assert.equal(f.barcode, "818290014108");
  assert.equal(f.publishedAt, "2021-10-28");
  assert.deepEqual([f.kcal, f.protein, f.carbs, f.fat, f.fiber], [53, 10, 4, 0, null]);
  assert.equal(f.nutrients.get(1087), 110);
  assert.deepEqual(f.serving, { label: "1 container", grams: 150 });
});

test("details shape, Atwater fallback, typo filter, drinks", () => {
  const f = parseBranded({
    fdcId: 1,
    description: "Cold Brew Coffee",
    brandOwner: "BREW CO",
    servingSize: 240,
    servingSizeUnit: "MLT",
    publicationDate: "4/1/2024",
    foodNutrients: [
      { nutrient: { id: 2047, unitName: "kcal" }, amount: 2 },
      { nutrient: { id: 1004, unitName: "g" }, amount: 250 }, // label typo: dropped
      { nutrient: { id: 1085, unitName: "g" }, amount: 0.1 },
    ],
  });
  assert.equal(f.name, "Cold Brew Coffee", "mixed case left alone");
  assert.equal(f.brand, "Brew Co");
  assert.equal(f.kcal, 2);
  assert.equal(f.fat, 0.1, "NLEA fat fills in after the typo is dropped");
  assert.equal(f.publishedAt, "2024-04-01");
  assert.deepEqual(f.serving, { label: "240 mL", grams: 240 });
});

test("no usable serving", () => {
  const f = parseBranded({ fdcId: 2, description: "X", servingSize: 1, servingSizeUnit: "ONZ" });
  assert.equal(f.serving, null);
  assert.equal(f.kcal, null);
});

test("tidyName", () => {
  assert.equal(tidyName("PEANUT BUTTER (CREAMY)"), "Peanut Butter (Creamy)");
  assert.equal(tidyName("Kind bar"), "Kind bar");
});
