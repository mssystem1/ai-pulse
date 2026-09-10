import test from "node:test";
import assert from "node:assert/strict";
import { selectPulseRecords } from "./rdb-scope.mjs";

test("recovery includes only the exact PULSE namespace, without modifying source records", () => {
  const keys = ["pulse:jobs:1", "arcforge:jobs:1", "mantle-payment:1", "pulse-other:1", "other:pulse:1", "PULSE:1", "pulse", "pulse:pass:1"];
  const records = keys.map(key => ({ key: Buffer.from(key), value: Buffer.from("unchanged"), expiresAt: 1800000000000 }));
  const selected = selectPulseRecords(records);
  assert.deepEqual(selected.map(record => record.key.toString()), ["pulse:jobs:1", "pulse:pass:1"]);
  assert.equal(selected[0], records[0]);
  assert.equal(selected[1], records[7]);
  assert.equal(records.length, 8);
  assert.ok(records.every(record => record.value.toString() === "unchanged" && record.expiresAt === 1800000000000));
});

test("unrelated binary keys and values are excluded before UTF-8 decoding", () => {
  const unrelated = { key: Buffer.from([255, 254]), value: Buffer.from([255]) };
  assert.deepEqual(selectPulseRecords([unrelated]), []);
});
