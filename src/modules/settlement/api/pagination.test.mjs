import test from "node:test";
import assert from "node:assert/strict";
import { listQuery } from "./pagination.js";

test("bounded financial list pages use the existing limit/offset contract", () => {
  assert.equal(listQuery(), "?limit=50&offset=0");
  assert.equal(listQuery({ limit: 50, offset: 100 }), "?limit=50&offset=100");
  for (const value of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 100001 }, { offset: 1.5 }]) assert.throws(() => listQuery(value));
});
