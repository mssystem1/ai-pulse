import test from "node:test";
import assert from "node:assert/strict";
import { decodeActivityHash, mergeActivityRecords } from "./v6Store.js";

const activity = JSON.stringify({
  id: "one",
  owner: "0x0000000000000000000000000000000000000001",
  network: "xlayer",
  source: "autopilot",
  kind: "buy_filled",
  status: "confirmed",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
});

test("decodes atomic activity hashes from both Upstash response shapes", () => {
  assert.equal(decodeActivityHash(["one", activity]).length, 1);
  assert.equal(decodeActivityHash({ one: activity })[0]?.kind, "buy_filled");
  assert.deepEqual(decodeActivityHash(["broken", "not-json"]), []);
});

test("the newest activity update wins across API workers", () => {
  const older = { ...JSON.parse(activity), updatedAt: "2026-08-26T00:00:00.000Z", account: undefined };
  const newer = { ...older, updatedAt: "2026-08-26T00:01:00.000Z", account: "0x0000000000000000000000000000000000000002" };
  assert.equal(mergeActivityRecords([newer], [older])[0]?.account, newer.account);
  assert.equal(mergeActivityRecords([older], [newer])[0]?.account, newer.account);
});

test("the activity ledger does not discard rows after the former 500-row window", () => {
  const rows = Array.from({ length: 501 }, (_value, index) => ({
    ...JSON.parse(activity),
    id: `activity-${index}`,
    createdAt: new Date(Date.parse("2026-08-26T00:00:00.000Z") + index).toISOString(),
    updatedAt: new Date(Date.parse("2026-08-26T00:00:00.000Z") + index).toISOString(),
  }));
  assert.equal(mergeActivityRecords(rows, []).length, 501);
});
