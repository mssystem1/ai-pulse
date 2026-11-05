import assert from "node:assert/strict";
import test from "node:test";
import { terminalClockAnchor, terminalPassTime } from "./terminalAccessClock";
import { terminalWorkspaceUpdate, type TerminalDuration, type TerminalWorkspace } from "./terminalClient";

const start = Date.parse("2026-11-05T10:00:00.000Z"), hour = 3_600_000;
const durations: Record<TerminalDuration, number> = { "24h": 24 * hour, "7d": 7 * 24 * hour, "30d": 30 * 24 * hour };
function workspace(duration: TerminalDuration = "24h"): TerminalWorkspace {
  const expiresAt = new Date(start + durations[duration]).toISOString();
  return { owner: "owner-a", revision: 3, serverNow: start, access: { active: true, expiresAt, grants: [{ duration, startsAt: new Date(start).toISOString(), expiresAt }] }, watches: [], radars: [], positions: [], activity: [], telegram: { linked: false, enabled: false, events: [] } };
}

for (const duration of ["24h", "7d", "30d"] as const) test(`${duration} countdown uses recorded expiry and server time, independently of browser clock`, () => {
  const value = workspace(duration), anchor = terminalClockAnchor(null, value, 100, start + 5 * 365 * 24 * hour);
  const first = terminalPassTime(value, anchor, 100), elapsed = terminalPassTime(value, anchor, 100 + hour + 61_000);
  assert.equal(first.active, true); assert.equal(first.remainingMs, durations[duration]); assert.equal(first.runningDuration, duration);
  assert.equal(elapsed.remainingMs, durations[duration] - hour - 61_000);
  assert.equal(elapsed.text, duration === "24h" ? "0d 22h 58m 59s" : duration === "7d" ? "6d 22h 58m 59s" : "29d 22h 58m 59s");
});

test("stacked renewals count continuous access and identify the currently running grant", () => {
  const value = workspace(), combinedExpiry = start + durations["24h"] + durations["7d"];
  value.access.expiresAt = new Date(combinedExpiry).toISOString();
  value.access.grants!.push({ duration: "7d", startsAt: new Date(start + durations["24h"]).toISOString(), expiresAt: value.access.expiresAt });
  const anchor = terminalClockAnchor(null, value, 0, 0);
  const initial = terminalPassTime(value, anchor, 0), nextGrant = terminalPassTime(value, anchor, durations["24h"]);
  assert.equal(initial.text, "8d 00h 00m 00s"); assert.equal(initial.runningDuration, "24h"); assert.equal(initial.queuedRenewals, 1);
  assert.equal(nextGrant.text, "7d 00h 00m 00s"); assert.equal(nextGrant.runningDuration, "7d"); assert.equal(nextGrant.queuedRenewals, 0);
});

test("reopening uses the original expiry with a new server anchor, rather than restarting duration", () => {
  const value = workspace("30d"); value.serverNow = start + 6 * 24 * hour;
  const anchor = terminalClockAnchor(null, value, 40, start - 10 * hour);
  assert.equal(terminalPassTime(value, anchor, 40).text, "24d 00h 00m 00s");
  assert.equal(terminalPassTime(value, anchor, 40).runningDuration, "30d");
});

test("same-revision metadata refresh advances the anchor; stale revisions and delayed clocks cannot rewind it", () => {
  const value = workspace(), first = terminalClockAnchor(null, value, 100, 0);
  const advanced = { ...value, serverNow: start + 20_000 }, second = terminalClockAnchor(first, advanced, 10_100, 0);
  assert.equal(second.serverNow, start + 20_000); assert.equal(second.revision, first.revision);
  const delayed = terminalClockAnchor(second, value, 20_100, 0);
  assert.equal(delayed.serverNow, start + 30_000);
  const staleWorkspace = { ...value, revision: 2, serverNow: start + 100_000 };
  assert.equal(terminalWorkspaceUpdate(advanced, staleWorkspace, "owner-a"), advanced);
  assert.equal(terminalClockAnchor(second, staleWorkspace, 30_100, 0), second);
});

test("mutation payload without clock metadata retains the established server clock", () => {
  const value = workspace(), initial = terminalClockAnchor(null, value, 100, 0);
  const mutation = { ...value, revision: 4, serverNow: undefined };
  const next = terminalClockAnchor(initial, mutation, 1100.25, start + 100 * hour);
  assert.equal(next.source, "server"); assert.equal(next.serverNow, start + 1000.25);
  assert.equal(terminalPassTime(mutation, next, 1100.25).remainingMs, durations["24h"] - 1000.25);
});

test("exact expiry ends parent access even when the last server response still says active", () => {
  const value = workspace(), anchor = terminalClockAnchor(null, value, 0, 0);
  const last = terminalPassTime(value, anchor, durations["24h"] - 1), ended = terminalPassTime(value, anchor, durations["24h"]);
  assert.equal(last.active, true); assert.equal(last.seconds, 1);
  assert.equal(ended.active, false); assert.equal(ended.text, "0d 00h 00m 00s"); assert.equal(ended.remainingMs, 0);
  assert.equal(terminalPassTime(value, anchor, durations["24h"] + 60_000).active, false);
  value.access.active = false;
  assert.equal(terminalPassTime(value, anchor, 0).active, false, "a future expiry does not override server denial");
});

test("invalid clocks and expiry fail closed; only a missing legacy server clock uses browser time", () => {
  const value = workspace();
  for (const invalid of [NaN, Infinity, -1, 0, 1.5]) {
    const anchor = terminalClockAnchor(null, { ...value, serverNow: invalid }, 0, start);
    const result = terminalPassTime(value, anchor, 0);
    assert.equal(result.active, false); assert.equal(result.seconds, null);
  }
  const legacy = { ...value, serverNow: undefined }, anchor = terminalClockAnchor(null, legacy, 0, start + hour);
  assert.equal(anchor.source, "browser"); assert.equal(terminalPassTime(legacy, anchor, 0).text, "0d 23h 00m 00s");
  assert.equal(terminalPassTime(value, terminalClockAnchor(null, value, 100, 0), 99).active, false);
  assert.equal(terminalPassTime({ ...value, access: { active: true, expiresAt: "invalid" } }, anchor, 0).seconds, null);
  assert.equal(terminalPassTime({ ...value, owner: "owner-b" }, anchor, 0).active, false);
});
