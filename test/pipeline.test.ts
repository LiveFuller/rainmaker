import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, canTransition, newRecord } from "../src/core/pipeline.js";
import type { Lead } from "../src/core/types.js";

const lead: Lead = { id: "abc123", email: "a@b.cz" };

test("new records start at imported", () => {
  assert.equal(newRecord(lead).stage, "imported");
});

test("happy path moves forward in order", () => {
  let r = newRecord(lead);
  r = advance(r, "qualified");
  r = advance(r, "contacted");
  r = advance(r, "replied");
  r = advance(r, "meeting");
  r = advance(r, "won");
  assert.equal(r.stage, "won");
  assert.ok(r.stageHistory.qualified);
  assert.ok(r.stageHistory.won);
});

test("illegal jumps throw", () => {
  assert.throws(() => advance(newRecord(lead), "won"));
  assert.throws(() => advance(advance(newRecord(lead), "qualified"), "meeting"));
});

test("terminal stages have no outgoing edges", () => {
  for (const terminal of ["won", "lost", "unsubscribed"] as const) {
    assert.equal(canTransition(terminal, "contacted"), false);
  }
});

test("unsubscribe is reachable from early stages", () => {
  assert.equal(canTransition("contacted", "unsubscribed"), true);
  assert.equal(canTransition("won", "unsubscribed"), false);
});
