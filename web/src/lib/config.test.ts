import { test } from "node:test";
import assert from "node:assert/strict";
import { supabaseConfigProblem as check } from "./config.ts";

const URL_OK = "https://abcdefghijkl.supabase.co";
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, "")}.sig`;

test("good settings pass", () => {
  assert.equal(check(URL_OK, "sb_publishable_abc123"), null);
  assert.equal(check(URL_OK + "/", "sb_publishable_abc123"), null);
  assert.equal(check(URL_OK, jwt("anon")), null);
});

test("missing or malformed URL", () => {
  assert.match(check(undefined, "sb_publishable_x")!, /URL isn't set/);
  assert.match(check("abcdefghijkl.supabase.co", "sb_publishable_x")!, /valid URL/);
  assert.match(check(URL_OK + "/rest/v1", "sb_publishable_x")!, /remove "\/rest\/v1"/);
  assert.match(check(URL_OK + " ", "sb_publishable_x")!, /spaces/);
});

test("wrong or malformed key", () => {
  assert.match(check(URL_OK, "")!, /ANON_KEY isn't set/);
  assert.match(check(URL_OK, '"sb_publishable_x"')!, /quote marks/);
  assert.match(check(URL_OK, "sb_secret_abc")!, /Secret key/);
  assert.match(check(URL_OK, jwt("service_role"))!, /service_role key/);
  assert.match(check(URL_OK, "hello")!, /doesn't look like a Supabase key/);
});
