import assert from "node:assert/strict";
import test from "node:test";
import { beginLatestRequest, isLatestRequest, supersedeRequests } from "./latestRequest.js";

test("a Premium request supersedes an unresolved Base report response", () => {
  const ref = { current: 0 };
  const base = beginLatestRequest(ref);
  const premium = beginLatestRequest(ref);

  assert.equal(isLatestRequest(ref, base), false);
  assert.equal(isLatestRequest(ref, premium), true);
});

test("changing execution context invalidates the current paid report request", () => {
  const ref = { current: 7 };
  const current = ref.current;
  supersedeRequests(ref);

  assert.equal(isLatestRequest(ref, current), false);
});
