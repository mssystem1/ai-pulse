import test from "node:test";
import assert from "node:assert/strict";
import { persistJournalRow, readJournal, type JournalState, type JournalRow } from "./autopilotJournal.js";
const row = (i: number) => ({ id: String(i), evaluatedAt: new Date(i * 1000).toISOString() });

test("retains more than 100 decisions during an outage and flushes all on recovery", async () => {
  const state: JournalState<JournalRow> = { id: "test", evaluationJournalInitialized: true };
  for (let i = 0; i < 321; i++) await persistJournalRow(state, row(i), async () => { throw new Error("offline"); });
  assert.equal(state.evaluations?.length, 100);
  assert.equal(state.evaluationPending?.length, 321);
  assert.equal((await readJournal(state)).rows.length, 321);
  const stored = new Map<string, string>();
  await persistJournalRow(state, row(321), async args => {
    for (let i = 2; i < args.length; i += 2) stored.set(String(args[i]), String(args[i + 1]));
  });
  assert.equal(stored.size, 322);
  assert.equal(state.evaluationPending?.length, 0);
  assert.equal(state.evaluationJournalError, undefined);
});

test("reads every archive page, deduplicates scan overlap and keeps oldest rows", async () => {
  const state = { id: "test", evaluations: [row(320)] };
  const pages = [Array.from({ length: 250 }, (_, i) => row(i)), Array.from({ length: 72 }, (_, i) => row(i + 249))];
  let calls = 0;
  const result = await readJournal(state, async args => {
    assert.equal(args[0], "HSCAN");
    const page = pages[calls++];
    return [calls === 1 ? "12" : "0", page.flatMap(r => [r.id, JSON.stringify(r)])];
  });
  assert.equal(result.rows.length, 321);
  assert.equal(result.rows[0].id, "0");
  assert.equal(result.storage, "synced");
});

test("failed history reads are explicitly unavailable, not falsely complete", async () => {
  const result = await readJournal({ id: "test", evaluations: [row(2)] }, async () => { throw new Error("offline"); });
  assert.equal(result.rows.length, 1);
  assert.equal(result.storage, "unavailable");
});

test("first migration includes embedded legacy rows without inventing discarded history", async () => {
  const state: JournalState<JournalRow> = { id: "legacy", evaluations: [row(7), row(8)] };
  const stored: string[] = [];
  await persistJournalRow(state, row(9), async args => { for (let i = 2; i < args.length; i += 2) stored.push(String(args[i])); });
  assert.deepEqual(stored, ["7", "8", "9"]);
});

test("partial flush retains only unacknowledged rows and safely retries the rest", async () => {
  const state: JournalState<JournalRow> = { id: "test", evaluationJournalInitialized: true, evaluationPending: Array.from({ length: 220 }, (_, i) => row(i)) };
  let calls = 0;
  await persistJournalRow(state, row(220), async () => { if (++calls === 2) throw new Error("interrupted"); });
  assert.equal(state.evaluationPending?.length, 121);
  assert.equal(state.evaluationPending?.[0].id, "100");
  const sent: string[] = [];
  await persistJournalRow(state, row(221), async args => { for (let i = 2; i < args.length; i += 2) sent.push(String(args[i])); });
  assert.equal(sent.length, 122);
  assert.equal(sent[0], "100");
  assert.equal(sent.at(-1), "221");
});
