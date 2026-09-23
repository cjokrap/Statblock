import { test } from "node:test";
import assert from "node:assert/strict";
import { liftosaurKeyProblem } from "./liftosaurKey.ts";

test("key format", () => {
  assert.equal(liftosaurKeyProblem("  lftsk_AbC-12_x  "), null);
  assert.match(liftosaurKeyProblem("") ?? "", /Paste/);
  assert.match(liftosaurKeyProblem("sk_live_123") ?? "", /start with lftsk_/);
  assert.match(liftosaurKeyProblem("lftsk_abc def") ?? "", /characters/);
});
