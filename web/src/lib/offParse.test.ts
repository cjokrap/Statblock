import { test } from "node:test";
import assert from "node:assert/strict";
import { barcodeVariants, parseOff } from "./offParse.ts";

test("an Open Food Facts product", () => {
  const f = parseOff(
    {
      code: "0811620022002",
      product_name: "Core Power Chocolate",
      brands: "fairlife, Coca-Cola",
      serving_size: "1 bottle (414 ml)",
      serving_quantity: "414",
      serving_quantity_unit: "ml",
      nutriments: {
        "energy-kcal_100g": 41,
        proteins_100g: 6.28,
        carbohydrates_100g: 1.93,
        fat_100g: 1.09,
        sodium_100g: 0.063,
        "vitamin-d_100g": 0.0000012,
        calcium_100g: 0.208,
        "vitamin-c_100g": "oops",
      },
    },
    "0811620022002",
  );
  assert.ok(f);
  assert.deepEqual([f.name, f.brand, f.kcal, f.protein, f.carbs, f.fat, f.fiber], [
    "Core Power Chocolate", "fairlife", 41, 6.28, 1.93, 1.09, null,
  ]);
  assert.deepEqual(f.serving, { label: "1 bottle", grams: 414 });
  assert.equal(Math.round(f.nutrients.get("sodium")!), 63); // mg
  assert.equal(Math.round(f.nutrients.get("vitamin_d")! * 10) / 10, 1.2); // mcg
  assert.equal(Math.round(f.nutrients.get("calcium")!), 208);
  assert.equal(f.nutrients.has("vitamin_c"), false);
});

test("energy in kJ, typos, no name", () => {
  const f = parseOff({ product_name: "OAT BAR", nutriments: { energy_100g: 1674, fat_100g: 180 } }, "123");
  assert.deepEqual([f?.name, Math.round(f!.kcal!), f?.fat, f?.serving], ["Oat Bar", 400, null, null]);
  assert.equal(parseOff({ product_name: "X", nutriments: { "energy-kcal_100g": 4000 } }, "1")?.kcal, null);
  assert.equal(parseOff({ nutriments: {} }, "1"), null);
});

test("barcode forms", () => {
  assert.deepEqual(barcodeVariants("811620022002"), [
    "811620022002", "0811620022002", "00811620022002",
  ]);
  assert.ok(barcodeVariants("0 811620 02200 2").includes("811620022002"));
  assert.deepEqual(barcodeVariants("12ab"), []);
});
