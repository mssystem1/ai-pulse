import assert from "node:assert/strict";
import test from "node:test";
import {
  TerminalApiError, authorizeTerminal, clearTerminalSession, setTerminalSession, terminalExecutionTime,
  terminalReceiptComplete, terminalReceiptRequestId, terminalRequest, terminalSession, terminalUtc, terminalWorkspaceUpdate, terminalSetupReferences, terminalFollowRestriction, type TerminalWorkspace,
  terminalAskBinding, terminalFollowReview, terminalFollowReviewMatches, terminalLabel, terminalPassPrice, type TerminalMarket,
} from "./terminalClient";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
test("a private Terminal session is owner-scoped, expires and cannot adopt a different owner", () => {
  clearTerminalSession();
  setTerminalSession({ owner, token: "private-token", expiresAt: "2030-01-01T00:00:00.000Z" }, owner);
  assert.equal(terminalSession(owner, Date.parse("2029-12-31T23:59:59Z"))?.token, "private-token");
  assert.equal(terminalSession(other, Date.parse("2029-12-31T23:59:59Z")), null);
  assert.equal(terminalSession(owner, Date.parse("2030-01-01T00:00:00Z")), null);
  assert.throws(() => setTerminalSession({ owner: other, token: "wrong", expiresAt: "2030-01-01T00:00:00Z" }, owner), /match/);
  clearTerminalSession(); assert.equal(terminalSession(owner), null);
});

test("Terminal authorization signs the server challenge and retains the token only in the owner session", async t => {
  clearTerminalSession(); const requests: Array<{ url: string; body: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init: RequestInit) => {
    const url = String(input); requests.push({ url, body: JSON.parse(String(init.body)) });
    assert.equal(new URL(url).search, "");
    if (url.endsWith("auth/challenge")) return Response.json({ challengeId: "challenge-id", message: "PULSE owner challenge", expiresAt: "2030-01-01T00:00:00Z" });
    return Response.json({ owner, token: "memory-session", expiresAt: "2030-01-01T00:00:00Z" });
  });
  let signed = "";
  await authorizeTerminal(owner, async message => { signed = message; return "owner-signature"; });
  assert.equal(signed, "PULSE owner challenge");
  assert.deepEqual(requests.map(r => r.body), [{ wallet: owner }, { challengeId: "challenge-id", signature: "owner-signature" }]);
  assert.equal(terminalSession(owner)?.token, "memory-session");
  await authorizeTerminal(owner, async () => { throw Error("A valid in-memory session should not ask for another signature"); });
  assert.equal(requests.length, 2); clearTerminalSession();
});

test("private requests send the bearer header, use the selected paid route, and reject traversal", async () => {
  let called = "", options: RequestInit | undefined;
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => { called = String(url); options = init; return Response.json({ ok: true }); }) as typeof fetch;
  await terminalRequest("pass/24h", { token: "sensitive", networkRoute: "base", method: "POST", body: { requestId: "stable-request-identifier" }, fetcher });
  assert.match(called, /\/base\/v1\/terminal\/pass\/24h$/);
  assert.ok(!called.includes("sensitive"));
  assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer sensitive");
  assert.equal(options?.cache, "no-store"); assert.equal(options?.referrerPolicy, "no-referrer");
  await assert.rejects(terminalRequest("../../private", { fetcher }), /Invalid Terminal request path/);
  await assert.rejects(terminalRequest("pass/24h", { networkRoute: "https://example.com", fetcher }), /Unsupported/);
});

test("an expired server session is cleared, while payment errors retain their status for recovery", async () => {
  setTerminalSession({ owner, token: "expires-on-server", expiresAt: "2030-01-01T00:00:00Z" }, owner);
  const unauthorized = (async () => Response.json({ error: "Sign again" }, { status: 401 })) as typeof fetch;
  await assert.rejects(terminalRequest("workspace", { token: "expires-on-server", fetcher: unauthorized }), error => error instanceof TerminalApiError && error.status === 401);
  assert.equal(terminalSession(owner), null);
  const unavailable = (async () => Response.json({ error: "Activation remains recoverable" }, { status: 503 })) as typeof fetch;
  await assert.rejects(terminalRequest("pass/24h", { fetcher: unavailable }), error => error instanceof TerminalApiError && error.status === 503 && /recoverable/.test(error.message));
});

test("execution times labelled UTC are independent of the browser's local timezone and reject impossible dates", () => {
  assert.equal(terminalExecutionTime("2026-11-03T08:20"), "2026-11-03T08:20:00.000Z");
  assert.equal(terminalExecutionTime("2028-02-29T08:20:31"), "2028-02-29T08:20:31.000Z");
  assert.equal(terminalExecutionTime("2026-11-04T08:20:31.529"), "2026-11-04T08:20:31.529Z");
  for (const value of ["2026-02-29T08:20", "2026-11-03T24:00", "2026-11-03T08:20+04:00", "bad"]) assert.throws(() => terminalExecutionTime(value), /valid execution time/);
  assert.equal(terminalUtc("2026-11-03T08:20:00Z"), "2026-11-03 08:20:00 UTC");
  assert.equal(terminalUtc(undefined), "—");
});

test("checkout retries reuse their request ID and a completed purchase creates a new renewal identity", () => {
  const rows = new Map<string, string>(); const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
  const first = terminalReceiptRequestId(owner, "base", "24h", storage);
  assert.equal(terminalReceiptRequestId(owner.toUpperCase(), "base", "24h", storage), first);
  assert.notEqual(terminalReceiptRequestId(owner, "base", "7d", storage), first);
  terminalReceiptComplete(owner, "base", "24h", storage);
  assert.notEqual(terminalReceiptRequestId(owner, "base", "24h", storage), first);
  const blocked = { getItem: () => { throw Error("private mode"); }, setItem: () => { throw Error("private mode"); } };
  assert.equal(terminalReceiptRequestId(other, "arbitrum", "24h", blocked), terminalReceiptRequestId(other, "arbitrum", "24h", blocked));
});

test("a late poll cannot hide a newly saved position or show a different owner's workspace", () => {
  const baseline: TerminalWorkspace = { owner, revision: 4, access: { active: true }, watches: [], radars: [], positions: [], activity: [], telegram: { linked: false, enabled: false, events: [] } };
  const saved = { ...baseline, revision: 5, positions: [{ id: "recorded-fill", instId: "BTC-USDT", timeframe: "1H", side: "long" as const, quantity: 1, createdAt: "2026-11-04T08:20:00Z" }] };
  assert.equal(terminalWorkspaceUpdate(saved, baseline, owner), saved);
  assert.equal(terminalWorkspaceUpdate(saved, { ...baseline, owner: other, revision: 100 }, owner), saved);
  assert.equal(terminalWorkspaceUpdate(null, baseline, null), null);
  assert.equal(terminalWorkspaceUpdate(baseline, saved, owner), saved);
});

test("selected setup keeps its explicit hard SL and reclaim evidence when generic entry eligibility has no stop", () => {
  // Minimal saved-contract fields from the observed failure: generic entry gating
  // is unset while the priced scenario retains its actual immutable protection.
  const report = {
    snapshot: { timeframe: "1H", pricePrecision: 2 }, tradePlan: { referenceStop: null },
    setupSelection: { assessment: "short" }, scenario: { definition: { hardStop: 76321.3421929 } },
    discretionaryPlan: { side: "long", family: "level_retest", stop: 76321.3421929,
      entryBasis: { kind: "reclaimed_level", timeframe: "1H", knownAt: Date.parse("2026-10-30T00:00:00Z"), price: 76602.7 },
      stopBasis: { timeframe: "1H", price: 76425.9, anchorTs: Date.parse("2026-11-04T03:00:00Z") },
      evidence: { kind: "primary_reclaim", timeframe: "15m", level: 76602.7, testTs: Date.parse("2026-11-04T03:30:00Z"), completedAt: Date.parse("2026-11-04T04:00:00Z") },
    },
  } as unknown as Parameters<typeof terminalSetupReferences>[0];
  const actual = terminalSetupReferences(report);
  assert.equal(actual.hardStop, 76321.3421929);
  assert.match(actual.lines.join(" "), /Primary Reclaim: 15m test at 76,602\.7/);
  assert.match(actual.lines.join(" "), /completed 2026-11-04 04:00:00 UTC/);
  assert.match(actual.lines.join(" "), /primary 1H bias is short; this long setup is a response against that bias/);
  assert.equal(terminalSetupReferences({ ...report, scenario: undefined }).hardStop, actual.hardStop);
  assert.equal(terminalSetupReferences({ ...report, scenario: undefined, discretionaryPlan: undefined }).hardStop, null);
});

test("locking a request scope rejects a private response whose headers arrived before its body", async () => {
  const controller = new AbortController(); let finish!: (value: unknown) => void;
  const fetcher = (async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { finish = resolve; }) })) as unknown as typeof fetch;
  const request = terminalRequest("workspace", { signal: controller.signal, fetcher });
  await Promise.resolve(); await Promise.resolve();
  controller.abort(); finish({ privateJournal: "late response" });
  await assert.rejects(request, error => error instanceof DOMException && error.name === "AbortError");
});

test("an ended or already-observed setup remains readable but cannot offer a new Follow action", () => {
  type FollowReport = Parameters<typeof terminalFollowRestriction>[0];
  for (const state of ["invalidated", "expired", "completed", "entry_observed"] as const) {
    const report = { scenario: { state } } as FollowReport;
    assert.match(terminalFollowRestriction(report)!, /review a separate new setup/);
    assert.equal(report.scenario?.state, state, "The priced scenario state is preserved for review");
  }
  for (const state of ["awaiting_location", "awaiting_event", "confirmed_awaiting_fill"] as const) {
    assert.equal(terminalFollowRestriction({ scenario: { state } } as FollowReport), null);
  }
  assert.equal(terminalFollowRestriction({}), null);
});

test("a Follow dialog retains reviewed version A across poll B and rejects a changed owner, market or frame", () => {
  const original = { instId: "BTC-USDT", timeframe: "1H", setupVersionId: "version-A", observedAt: 1000, report: { discretionaryPlan: { entry: 100, stop: 95 }, snapshot: { instId: "BTC-USDT", timeframe: "1H" } } } as unknown as TerminalMarket;
  const reviewed = terminalFollowReview(original, owner);
  const refreshed = structuredClone(original); refreshed.setupVersionId = "version-B"; refreshed.report.discretionaryPlan!.entry = 102;
  original.report.discretionaryPlan!.entry = 103;
  assert.equal(reviewed.setupVersionId, "version-A"); assert.equal(reviewed.report.discretionaryPlan!.entry, 100);
  assert.notEqual(reviewed.setupVersionId, refreshed.setupVersionId);
  assert.equal(terminalFollowReviewMatches(reviewed, owner.toUpperCase(), "BTC-USDT", "1H"), true);
  assert.equal(terminalFollowReviewMatches(reviewed, other, "BTC-USDT", "1H"), false);
  assert.equal(terminalFollowReviewMatches(reviewed, owner, "ETH-USDT", "1H"), false);
  assert.equal(terminalFollowReviewMatches(reviewed, owner, "BTC-USDT", "4H"), false);
  assert.equal(terminalFollowReviewMatches(reviewed, null, "BTC-USDT", "1H"), false);
});

test("tool questions preserve the opened setup, selected flow stream and exact footprint bucket across refreshes", () => {
  const original = { instId: "BTC-USDT", timeframe: "4H", setupVersionId: "version-A", evidenceSnapshotId: "tes_original_capture" } as TerminalMarket;
  const selected = { tool: "flow" as const, stream: "perpetual" as const };
  const bound = terminalAskBinding(original, { inspection: selected });
  original.setupVersionId = "version-B"; original.evidenceSnapshotId = "tes_later_capture";
  assert.deepEqual(bound, { instId: "BTC-USDT", timeframe: "4H", setupVersionId: "version-A", evidenceSnapshotId: "tes_original_capture", inspection: selected });
  const footprint = terminalAskBinding(original, { inspection: { tool: "footprint", footprintStart: 1793764800000 } });
  assert.equal(footprint.inspection?.footprintStart, 1793764800000);
  assert.deepEqual(terminalAskBinding(original, { positionId: "position-ETH" }), { positionId: "position-ETH" }, "A private position question must not inherit another chart's setup");
});

test("published pass displays preserve six-decimal prices and event confirmation does not imply full eligibility", () => {
  assert.equal(terminalPassPrice("1.50"), "1.50"); assert.equal(terminalPassPrice("1.500001"), "1.500001");
  assert.equal(terminalPassPrice("0.000001"), "0.000001"); assert.equal(terminalPassPrice("1000.123456"), "1,000.123456");
  assert.throws(() => terminalPassPrice("0")); assert.throws(() => terminalPassPrice("1.0000001"));
  assert.equal(terminalLabel("conditions_satisfied"), "Price policy confirmed");
});


test("Ask PULSE preserves the retained-session evidence instead of replacing it with the parent assessment", () => {
  const assessment = { instId:"BTC-USDT", timeframe:"1H", setupVersionId:"setup-parent", evidenceSnapshotId:"assessment-parent" } as TerminalMarket;
  const selected = { instId:"BTC-USDT", timeframe:"1H", setupVersionId:"setup-retained", evidenceSnapshotId:"retained-session", inspection:{tool:"flow" as const,stream:"spot" as const} };
  assert.deepEqual(terminalAskBinding(assessment,selected), selected);
});
